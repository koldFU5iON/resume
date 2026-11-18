import { describe, expect, it } from 'vitest'
import { buildVault } from '@/modules/profile-map/build'
import { vaultSource } from '@/modules/profile-map/__fixtures__/source'
import { BLIZZARD, OLD_CO, UNITY, writeSelection, writeVault, writeVaultSource } from '../__fixtures__/write'
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
