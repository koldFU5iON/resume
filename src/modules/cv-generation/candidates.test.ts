import { describe, expect, it } from 'vitest'
import { buildVault } from '@/modules/profile-map/build'
import { vaultSource } from '@/modules/profile-map/__fixtures__/source'
import { buildCandidates, candidatesToPrompt, labelIndex, profileOutline } from './candidates'

const vault = buildVault(vaultSource())

describe('buildCandidates', () => {
  const c = buildCandidates(vault)

  it('gives every item its database id', () => {
    expect(c.employers.map((e) => e.key)).toEqual(['fictional-freight'])
    expect(c.employers[0].roles.map((r) => r.experienceId)).toEqual(['e1'])
    expect(c.employers[0].activities.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(c.employers[0].activities.every((a) => a.experienceId === 'e1')).toBe(true)
    expect(c.skills.map((s) => s.id).sort()).toEqual(['s1', 's2', 's3'])
    expect(c.tools.map((s) => s.id)).toEqual(['t2'])
    expect(c.competencies.map((s) => s.id)).toEqual(['c1'])
    expect(c.certifications.map((s) => s.id)).toEqual(['ce1'])
    expect(c.education.map((s) => s.id)).toEqual(['ed1'])
    expect(c.projects.map((s) => s.id)).toEqual(['pr1'])
  })

  it('leaves out archived projects', () => {
    const src = vaultSource()
    src.projects = [{ ...src.projects[0], status: 'archived' }]
    expect(buildCandidates(buildVault(src)).projects).toEqual([])
  })

  it('scrubs contact details from free text', () => {
    const src = vaultSource()
    src.experiences[0].activities[0].description = 'Cut release time, ask robin@example.test'
    const text = buildCandidates(buildVault(src)).employers[0].activities[0].text
    expect(text).not.toContain('robin@example.test')
  })

  it('labels every candidate id', () => {
    const labels = labelIndex(c)
    expect(labels.get('fictional-freight')).toBe('Program Manager — Fictional Freight')
    expect(labels.get('a1')).toContain('Cut release time')
    expect(labels.get('ce1')).toBe('PMP')
  })
})

describe('buildCandidates: employers', () => {
  /** Three roles at Unity (one split by a stint elsewhere) and one at Blizzard. */
  function sprawling() {
    const src = vaultSource()
    const base = src.experiences[0]
    const role = (id: string, company: string, title: string, start: string, end: string | null, acts: string[]) => ({
      ...base, id, company, role: title, startDate: new Date(`${start}-01T00:00:00Z`), endDate: end ? new Date(`${end}-01T00:00:00Z`) : null,
      skills: [], activities: acts.map((a, i) => ({ ...base.activities[0], id: `${id}-a${i}`, experienceId: id, description: a, highlighted: false, order: i, skills: [] })),
    })
    src.experiences = [
      role('u3', 'Unity', 'Snr. Program Manager', '2023-07', null, ['Ran the platform']),
      role('u2', 'unity ', 'Technical Program Manager', '2021-07', '2023-06', ['Shipped a thing', 'Cut cost']),
      role('b1', 'Blizzard Entertainment', 'Program Manager', '2015-01', '2018-12', ['Launched a title']),
      role('u1', 'Unity', 'Program Manager', '2019-01', '2021-06', ['Started here']),
    ]
    src.projects = []
    return buildCandidates(buildVault(src))
  }

  it('groups roles at one employer, newest employer first, with the latest title and the progression line', () => {
    const c = sprawling()
    expect(c.employers.map((e) => e.key)).toEqual(['unity', 'blizzard-entertainment'])
    const unity = c.employers[0]
    expect(unity.latestTitle).toBe('Snr. Program Manager')
    expect(unity.label).toBe('Snr. Program Manager — Unity')
    expect(unity.roles.map((r) => r.title)).toEqual(['Program Manager', 'Technical Program Manager', 'Snr. Program Manager'])
    expect(unity.progression).toBe('Three roles at Unity (2019–present): Program Manager → Technical Program Manager → Snr. Program Manager')
    expect(unity.progression).not.toMatch(/promot/i)
    expect(unity.period).toBe('Jan 2019 – present')
    expect(c.employers[1].progression).toBeNull()
  })

  it('keeps every activity with the role it came from, newest role first', () => {
    const unity = sprawling().employers[0]
    expect(unity.activities.map((a) => [a.id, a.experienceId])).toEqual([
      ['u3-a0', 'u3'], ['u2-a0', 'u2'], ['u2-a1', 'u2'], ['u1-a0', 'u1'],
    ])
  })

  it('shows the employer, progression and each activity’s role in the prompt, and one entry per employer in the outline', () => {
    const c = sprawling()
    const text = candidatesToPrompt(c)
    expect(text).toContain('[unity] Unity: latest title Snr. Program Manager (Jan 2019 – present)')
    expect(text).toContain('Three roles at Unity (2019–present)')
    expect(text).toContain('[u2-a0] (as Technical Program Manager)')
    expect(text).not.toContain('[u1]') // no per-role ids for the model to pick
    const out = profileOutline(null, c)
    expect(out.match(/^- /gm)?.filter(() => true)).toHaveLength(2)
    expect(out).toContain('Three roles at Unity')
    expect(out).toContain('4 activities, 4 achievements')
    expect(out).toContain('1 activity, 1 achievement')
  })

  it('labels the employer key', () => {
    expect(labelIndex(sprawling()).get('unity')).toBe('Snr. Program Manager — Unity')
  })
})

describe('prompt text', () => {
  const c = buildCandidates(vault)

  it('lists every id in square brackets for the Select prompt', () => {
    const text = candidatesToPrompt(c)
    for (const id of ['fictional-freight', 'a1', 'a2', 's1', 't2', 'c1', 'ce1', 'ed1', 'pr1']) expect(text).toContain(`[${id}]`)
  })

  it('outlines roles and names but not each activity', () => {
    const out = profileOutline('Program manager', c)
    expect(out).toContain('Program Manager — Fictional Freight')
    expect(out).toContain('2 activities, 1 achievement')
    expect(out).toContain('Skills:')
    expect(out).not.toContain('Cut release time')
  })
})
