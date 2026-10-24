import { describe, expect, it } from 'vitest'
import { checkFacts } from './fact-check'
import type { ProfileSnapshot } from '@/modules/profile/snapshot'

const d = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1))

const profile = {
  name: 'Ada Lovelace',
  email: null, phone: null, website: null, linkedin: null, location: null, headline: null,
  experiences: [
    { role: 'Senior Engineer', company: 'Acme Corp Ltd', startDate: d(2019, 3), endDate: null, location: null, remote: false, summary: '', activities: [] },
    { role: 'Developer', company: 'Globex', startDate: d(2016, 1), endDate: d(2019, 2), location: null, remote: false, summary: '', activities: [] },
  ],
  skills: [],
  educations: [
    { institution: 'University of Leeds', qualification: 'BSc (Hons)', field: 'Computer Science', startDate: d(2012, 9), endDate: d(2015, 6), grade: null },
  ],
  certifications: [], competencies: [], languages: [], projects: [],
} as ProfileSnapshot

describe('checkFacts', () => {
  it('is silent when employer and dates match (real master CV shape)', () => {
    const md = [
      '## Experience', '',
      '### Acme Corp', '_Developer → Senior Engineer_', 'London · Mar 2019 – Present', '',
      'Led the platform team.', '', '→ Cut costs by 30% - 40%',
      '', '### Globex', '_Developer_', 'Remote · 2016 – 2019',
    ].join('\n')
    expect(checkFacts(md, profile)).toEqual([])
  })

  it('warns on a wrong start year and names the profile dates', () => {
    const w = checkFacts('## Experience\n### Globex\n_Developer_\nRemote · 2014 - 2019', profile)
    expect(w).toHaveLength(1)
    expect(w[0].kind).toBe('dates')
    expect(w[0].message).toContain('Jan 2016')
    expect(w[0].excerpt).toContain('2014')
  })

  it('compares months when the draft gives one', () => {
    const w = checkFacts('## Experience\n### Acme Corp\nLondon · Jun 2019 - Present', profile)
    expect(w.map(x => x.kind)).toEqual(['dates'])
    expect(checkFacts('## Experience\n### Acme Corp\nLondon · 03/2019 - Present', profile)).toEqual([])
  })

  it('warns when Present is claimed for an ended role', () => {
    const w = checkFacts('## Experience\n### Globex\n2016 – Present', profile)
    expect(w.map(x => x.kind)).toEqual(['dates'])
  })

  it('warns when a current role is given an end date', () => {
    expect(checkFacts('## Experience\n### Acme Corp\nMar 2019 - Dec 2022', profile).map(x => x.kind)).toEqual(['dates'])
  })

  it('warns on an invented employer on a date line', () => {
    const w = checkFacts('## Experience\n### Initech\n_Engineer_\nLondon · 2015 - 2016', profile)
    expect(w).toHaveLength(1)
    expect(w[0].kind).toBe('employer')
  })

  it('checks a heading line that itself carries the range', () => {
    expect(checkFacts('## Work History\n### Globex (2016 – 2019)', profile)).toEqual([])
    expect(checkFacts('## Work History\n### Globex (2014 – 2019)', profile).map(x => x.kind)).toEqual(['dates'])
  })

  it('stays silent on ranges in outcome bullets and prose under an experience entry', () => {
    const acme = '## Experience\n### Acme Corp\nLondon · Mar 2019 – Present\n\n'
    expect(checkFacts(`${acme}→ Ran 2019 - 2021 growth campaign`, profile)).toEqual([])
    expect(checkFacts(`${acme}- Ran 2019 - 2021 growth campaign`, profile)).toEqual([])
    expect(checkFacts(`${acme}Revenue FY2020 - 2021 up 5%`, profile)).toEqual([])
    const globex = '## Experience\n### Globex\nRemote · 2016 – 2019\n\n'
    expect(checkFacts(`${globex}Between 2017 - 2018 I led a migration.`, profile)).toEqual([])
  })

  it('stays silent outside experience sections', () => {
    expect(checkFacts('## Profile\n\nI worked from 2015 - 2018 across sectors.', profile)).toEqual([])
    expect(checkFacts('## Certifications\n\n- **AWS** (2019 - 2022)', profile)).toEqual([])
    expect(checkFacts('## Projects\n\n### Side thing\n2018 - 2020', profile)).toEqual([])
    expect(checkFacts('## Skills\n\nPython 2015 - 2018', profile)).toEqual([])
  })

  it('accepts a merged tenure spanning several profile roles', () => {
    const p = { ...profile, experiences: [
      { ...profile.experiences[1], company: 'Globex', startDate: d(2016, 1), endDate: d(2017, 12) },
      { ...profile.experiences[1], company: 'Globex', role: 'Lead', startDate: d(2018, 1), endDate: d(2019, 2) },
    ] } as ProfileSnapshot
    expect(checkFacts('## Experience\n### Globex\n2016 - 2019', p)).toEqual([])
  })

  it('accepts a recognised degree and flags an invented one', () => {
    const ok = '## Education\n\n### University of Leeds\nBSc · Computer Science\n2012 – 2015'
    expect(checkFacts(ok, profile)).toEqual([])
    const bad = '## Education\n\n### Somewhere Else\nMBA · Finance\n2012 – 2015'
    const w = checkFacts(bad, profile)
    expect(w.map(x => x.kind)).toEqual(['qualification'])
    expect(w[0].excerpt).toContain('MBA')
  })

  it('does not treat education date lines as employers', () => {
    expect(checkFacts('## Education\n### University of Leeds\n2012 – 2015', profile)).toEqual([])
    expect(checkFacts('## Education\n### Elsewhere\n2012 – 2015', profile)).toEqual([])
  })

  it('is silent with no date lines, metrics or free text', () => {
    const md = '## Profile\n\nGrew revenue 20% - 35% across 2 markets. Worked at Hooli in 2018.\n\n- Led 12 engineers'
    expect(checkFacts(md, profile)).toEqual([])
    expect(checkFacts('', profile)).toEqual([])
  })

  it('ignores code fences and directive markers', () => {
    const md = '## Experience\n```\nInitech 2015 - 2016\n```\n\n:::hero 2010 - 2011\n:::'
    expect(checkFacts(md, profile)).toEqual([])
  })
})
