import { describe, expect, it } from 'vitest'
import { buildVault } from '@/modules/profile-map/build'
import { vaultSource } from '@/modules/profile-map/__fixtures__/source'
import { BLIZZARD, OLD_CO, UNITY, projectRow, writeSelection, writeVault, writeVaultSource } from '../__fixtures__/write'
import { evidenceFromVault, evidenceTexts } from './evidence'

describe('evidenceFromVault', () => {
  const vault = writeVault()
  const selection = writeSelection(vault)
  const ev = evidenceFromVault(vault, selection)

  it('resolves the selected activities to their FULL text, impact and kind', () => {
    const unity = ev.employers.find((e) => e.employer.key === UNITY)!
    expect(unity.activities.map((a) => a.id)).toEqual(['ua1', 'ua2', 'ua3'])
    expect(unity.activities[0]).toMatchObject({ kind: 'achievement', text: 'Cut platform release time by 40% across 8 teams', impact: 'saved 2 weeks per release' })
    expect(evidenceTexts(unity)).toContain('saved 2 weeks per release')
  })

  it('gives a header-only employer no activities', () => {
    expect(ev.employers.find((e) => e.employer.key === OLD_CO)!.activities).toEqual([])
    expect(ev.employers.map((e) => e.employer.key)).toEqual([UNITY, BLIZZARD, OLD_CO])
  })

  it('marks claimed capabilities and lists every claimed name in the profile', () => {
    expect(ev.tools.map((t) => [t.name, t.claimed])).toEqual([['Jira', false], ['Tableau', true]])
    expect(ev.competencies.map((c) => [c.name, c.claimed])).toEqual([['Cross-functional leadership', false], ['Change management', true]])
    expect(ev.claimedNames.sort()).toEqual(['Change management', 'Tableau'])
  })

  it('collects every title and company of the profile (what a writer must not introduce)', () => {
    expect(ev.profileTitles).toEqual(expect.arrayContaining(['Snr. Program Manager', 'Program Manager', 'Coordinator']))
    expect(ev.profileCompanies).toEqual(expect.arrayContaining(['Unity', 'Blizzard Entertainment', 'Old Co']))
  })

  it('is scoped to the vault it is given: ids that are not in it resolve to nothing', () => {
    // Another profile's vault does not contain this selection's activities, capabilities, certifications or education.
    const other = evidenceFromVault(buildVault(vaultSource()), selection)
    expect(other.employers.every((e) => e.activities.length === 0)).toBe(true)
    expect(other.employers.filter((e) => !e.employer.headerOnly).every((e) => e.missing > 0)).toBe(true)
    expect(other.skills).toEqual([])
    expect(other.tools).toEqual([])
    expect(other.certifications).toEqual([])
    expect(other.education).toEqual([])
  })

  it('counts a selected activity that was removed from the profile since the run, instead of inventing it', () => {
    const src = writeVaultSource()
    src.experiences[0].activities = src.experiences[0].activities.filter((a: { id: string }) => a.id !== 'ua2')
    const e = evidenceFromVault(buildVault(src), selection).employers.find((x) => x.employer.key === UNITY)!
    expect(e.activities.map((a) => a.id)).toEqual(['ua1', 'ua3'])
    expect(e.missing).toBe(1)
  })

  it('scrubs contact details from the activity text', () => {
    const src = writeVaultSource()
    src.experiences[0].activities[0].description = 'Cut release time, ask robin@example.test'
    const unity = evidenceFromVault(buildVault(src), selection).employers.find((x) => x.employer.key === UNITY)!
    expect(unity.activities[0].text).not.toContain('robin@example.test')
  })

  describe('in-progress certifications (the CV view of "certified")', () => {
    const now = new Date('2026-11-18T00:00:00Z')
    const withCertifiedSkill = (certId: string) => {
      const src = writeVaultSource()
      const cap = { id: 'skc', profileId: 'p1', name: 'Programme governance', kind: 'skill', category: null, level: null, order: 0, origin: null, yearsOfExperience: null, tags: '[]', notes: null, createdAt: new Date(0), updatedAt: new Date(0) }
      src.skills = [...(src.skills as never[]), cap] as never
      ;(src.certifications as Array<{ id: string; skills: unknown[] }>).find((c) => c.id === certId)!.skills = [{ skillId: 'skc', status: 'confirmed' }]
      const vault = buildVault(src)
      return { vault, sel: writeSelection(vault, { skills: [...['sk1', 'sk2', 'sk3', 'sk4', 'sk5', 'sk6', 'skc'].map((id) => ({ id, reason: '' }))] }) }
    }

    it('a skill backed only by an in-progress certification is claimed (and in claimedNames), whatever profile-map calls it', () => {
      const { vault, sel } = withCertifiedSkill('wc2') // SAFe: issue date in 2099
      const e = evidenceFromVault(vault, sel, now)
      expect(e.skills.find((s) => s.name === 'Programme governance')!.claimed).toBe(true)
      expect(e.claimedNames).toContain('Programme governance')
      expect(e.claimedNames).not.toContain('Release management')
    })

    it('a skill backed by a held certification is not claimed', () => {
      const { vault, sel } = withCertifiedSkill('wc1') // PMP, issued 2018
      const e = evidenceFromVault(vault, sel, now)
      expect(e.skills.find((s) => s.name === 'Programme governance')!.claimed).toBe(false)
      expect(e.claimedNames).not.toContain('Programme governance')
    })

    it('lists every certification and qualification with whether it is in progress', () => {
      const e = evidenceFromVault(vault, writeSelection(vault), now)
      expect(e.credentials).toEqual(expect.arrayContaining([
        { name: 'PMP', inProgress: false },
        { name: 'SAFe Program Consultant', inProgress: true },
        { name: 'MBA', inProgress: true },
        { name: 'MSc', inProgress: false },
      ]))
    })
  })
})

describe('certification rank (the weak-certification rule)', () => {
  const sel = (vault: ReturnType<typeof writeVault>, ids: string[], over: object = {}) => ({ ...writeSelection(vault, { certifications: ids.map((id) => ({ id, reason: '' })) }), ...over })
  const withCerts = (rows: object[]) => {
    const src = writeVaultSource()
    ;(src.certifications as unknown[]).push(...rows.map((r) => ({ profileId: 'p1', issuer: null, issueDate: null, expiryDate: null, credentialUrl: null, tags: '[]', createdAt: new Date(0), updatedAt: new Date(0), skills: [], ...r })))
    return buildVault(src)
  }
  const now = new Date('2026-11-18T00:00:00Z')

  it('ranks among the certifications that will be rendered: an expired first pick leaves the next one rank 0', () => {
    const vault = withCerts([{ id: 'wx', name: 'ITIL 3', issuer: 'Axelos', issueDate: new Date('2018-01-01T00:00:00Z'), expiryDate: new Date('2021-01-01T00:00:00Z') }, { id: 'ww', name: 'Product Marketing Course' }])
    const ev = evidenceFromVault(vault, sel(vault, ['wx', 'ww', 'wc1']), now)
    expect(ev.certifications.map((c) => [c.name, c.rank])).toEqual([['ITIL 3', undefined], ['Product Marketing Course', 0], ['PMP', 1]])
  })

  it('a removed first pick does not leave the next one at rank 1', () => {
    const vault = withCerts([{ id: 'ww', name: 'Product Marketing Course' }])
    const ev = evidenceFromVault(vault, sel(vault, ['gone', 'ww']), now)
    expect(ev.certifications.map((c) => [c.name, c.rank])).toEqual([['Product Marketing Course', 0]])
  })

  it('carries a rank for a code-chosen (fallback) selection too, so the weak-certification rule applies', () => {
    const vault = withCerts([{ id: 'ww', name: 'Product Marketing Course' }])
    const ev = evidenceFromVault(vault, sel(vault, ['wc1', 'ww'], { mode: 'fallback' }), now)
    expect(ev.certifications.map((c) => c.rank)).toEqual([0, 1])
  })
})

describe('projects ride along as evidence for the employer they belong to', () => {
  const d = (ym: string) => new Date(`${ym}-01T00:00:00Z`)
  const pick = (...ids: string[]) => ids.map((id) => ({ id, reason: '' }))
  const evidenceWith = (projects: object[], ids: string[]) => {
    const vault = writeVault(projects)
    return evidenceFromVault(vault, writeSelection(vault, { projects: pick(...ids) }))
  }
  const projectsOf = (ev: ReturnType<typeof evidenceFromVault>, key: string) => ev.employers.find((e) => e.employer.key === key)!.projects.map((p) => p.id)

  it('routes a project by its own role (experienceId), whichever role of the employer it names', () => {
    const ev = evidenceWith([projectRow('pa', 'Enemies Demo Campaign', 'Ran the demo campaign. 14,000+ players.', { experienceId: 'e-u1' })], ['pa'])
    expect(projectsOf(ev, UNITY)).toEqual(['pa'])
    expect(ev.unroutedProjects).toEqual([])
    expect(ev.employers.find((e) => e.employer.key === UNITY)!.projects[0]).toMatchObject({ name: 'Enemies Demo Campaign', text: 'Ran the demo campaign. 14,000+ players.' })
  })

  it('with no role, routes by the employer whose stint contains the project date', () => {
    const ev = evidenceWith([projectRow('pb', 'Launch', 'Launch work.', { startDate: d('2016-06') })], ['pb'])
    expect(projectsOf(ev, BLIZZARD)).toEqual(['pb'])
    // The last month of a stint still counts (Blizzard's role ends Dec 2018, stored as the 1st).
    const lastMonth = evidenceWith([projectRow('pl', 'Wrap-up', 'Wrap-up work.', { startDate: new Date('2018-12-20T00:00:00Z') })], ['pl'])
    expect(projectsOf(lastMonth, BLIZZARD)).toEqual(['pl'])
    // The end date is used when there is no start.
    const byEnd = evidenceWith([projectRow('pc', 'Launch', 'Launch work.', { endDate: d('2021-02') })], ['pc'])
    expect(projectsOf(byEnd, UNITY)).toEqual(['pc'])
  })

  it('reports a project nothing can carry, with the reason, instead of dropping it silently', () => {
    const rows = [
      projectRow('p1', 'Side project', 'On its own.'),
      projectRow('p2', 'Ancient project', 'Long ago.', { startDate: d('2004-01') }),
      projectRow('p3', 'Old Co project', 'At Old Co.', { experienceId: 'e-o1' }),
      projectRow('p4', 'Orphaned project', 'Role is gone.', { experienceId: 'e-unknown' }),
    ]
    // Select keeps at most two projects, so look at them two at a time.
    const first = evidenceWith(rows, ['p1', 'p2'])
    const second = evidenceWith(rows, ['p3', 'p4'])
    expect([...first.employers, ...second.employers].flatMap((e) => e.projects)).toEqual([])
    expect(first.unroutedProjects.map((p) => p.name)).toEqual(['Side project', 'Ancient project'])
    expect(first.unroutedProjects[0].why).toMatch(/no role and no date/)
    expect(first.unroutedProjects[1].why).toMatch(/outside every employer/)
    expect(second.unroutedProjects.map((p) => p.name)).toEqual(['Old Co project', 'Orphaned project'])
    expect(second.unroutedProjects[0].why).toMatch(/listed without bullets/)
    expect(second.unroutedProjects[1].why).toMatch(/role it belongs to is not on the CV/)
  })

  it('counts a project text as evidence (for the numbers check), highlights included, contact details scrubbed', () => {
    const ev = evidenceWith([projectRow('pa', 'Enemies Demo Campaign', 'Demo for the new title, ask robin@example.test.', { experienceId: 'e-u2', highlights: '["Reached 14,000+ players"]' })], ['pa'])
    const unity = ev.employers.find((e) => e.employer.key === UNITY)!
    const texts = evidenceTexts(unity).join('\n')
    expect(texts).toContain('Enemies Demo Campaign')
    expect(texts).toContain('Reached 14,000+ players')
    expect(texts).not.toContain('robin@example.test')
  })

  it('names a selected item that is no longer in the profile (it is never invented)', () => {
    const vault = writeVault([projectRow('pa', 'Gone', 'x', { experienceId: 'e-u1' })])
    const ev = evidenceFromVault(vault, writeSelection(vault, { projects: pick('pa') }))
    const without = evidenceFromVault(writeVault(), { ...writeSelection(vault, { projects: pick('pa') }) })
    expect(ev.unresolved).toEqual([])
    expect(without.unresolved).toEqual([{ section: 'projects', id: 'pa' }])
  })

  it('caps the role overview it hands the writers', () => {
    const src = writeVaultSource()
    const long = Array.from({ length: 60 }, (_, i) => `Scope fact ${i} about the business.`).join(' ')
    src.experiences = src.experiences.map((e) => ({ ...e, summary: long }))
    const v = buildVault(src as never)
    const e = evidenceFromVault(v, writeSelection(v))
    expect(e.employers.some((emp) => (emp.overview ?? '').length > 100)).toBe(true)
    for (const emp of e.employers) expect((emp.overview ?? '').length).toBeLessThanOrEqual(600)
  })
})
