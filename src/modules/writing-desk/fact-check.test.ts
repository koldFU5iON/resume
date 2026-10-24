import { describe, expect, it } from 'vitest'
import { checkFacts } from './fact-check'
import { toMarkdown } from '@/modules/cv/export'
import type { CVDocumentContent } from '@/modules/cv/schema'
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
  it('is silent when employer and dates match (entries under an Experience heading)', () => {
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

  describe('real toMarkdown output (no Experience parent heading)', () => {
    const exp = (company: string, titles: string[], duration: string, location = 'London') => ({
      id: company, type: 'experience' as const, visible: true,
      data: { company, titles, location, duration, description: 'Did things in 2017 - 2018.', outcomes: ['Ran 2019 - 2021 campaign'] },
    })
    const sections: CVDocumentContent['sections'] = [
      { id: 'h', type: 'header', visible: true, data: { name: 'Ada', headline: 'Engineer', contact: {} } },
      { id: 'p', type: 'profile', visible: true, data: { content: 'Worked 2015 - 2018 across sectors.' } },
    ]
    const tail: CVDocumentContent['sections'] = [
      { id: 'ed', type: 'education', visible: true, data: { institution: 'University of Leeds', qualification: 'BSc', field: 'Computer Science', duration: '2012 – 2015' } },
      { id: 'c', type: 'certification', visible: true, data: { name: 'AWS', issuer: 'Amazon', date: '2019 - 2022' } },
      { id: 's', type: 'skills', visible: true, data: { items: ['Python 2015 - 2018'] } },
    ]
    const md = (...entries: ReturnType<typeof exp>[]) =>
      toMarkdown({ version: 1, sections: [...sections, ...entries, ...tail] } as CVDocumentContent)

    it('warns on dates and invented employers, and is silent on correct entries', () => {
      const out = md(
        exp('Acme Corp', ['Developer', 'Senior Engineer'], 'Mar 2019 – Present'),
        exp('Globex', ['Developer'], '2014 – 2019', 'Remote'),
        exp('Initech', ['Wizard'], '2015 – 2016'),
      )
      const w = checkFacts(out, profile)
      expect(w.map(x => x.kind)).toEqual(['dates', 'employer'])
      expect(w[0].message).toContain('Globex')
      expect(w[1].excerpt).toContain('2015')
    })

    it('is silent when every entry is correct, and for education, certification and skills', () => {
      const out = md(
        exp('Acme Corp', ['Developer', 'Senior Engineer'], 'Mar 2019 – Present'),
        exp('Globex', ['Developer'], '2016 – 2019', 'Remote'),
      )
      expect(checkFacts(out, profile)).toEqual([])
      expect(checkFacts(toMarkdown({ version: 1, sections: [...sections, ...tail] } as CVDocumentContent), profile)).toEqual([])
    })

    it('recognises an entry with a subtitle line', () => {
      const e = exp('Globex', ['Developer'], '2014 – 2019')
      ;(e.data as Record<string, unknown>).subtitle = 'Promoted twice'
      expect(checkFacts(md(e), profile).map(x => x.kind)).toEqual(['dates'])
    })

    it('does not treat a ### entry without a titles line as experience', () => {
      expect(checkFacts('## Projects\n\n### Side thing\n2018 - 2020', profile)).toEqual([])
      expect(checkFacts('### Side thing\n_Hobby_\nsome prose\n2018 - 2020', profile)).toEqual([])
    })
  })

  it('handles multi-segment date lines under both shapes', () => {
    const lines = ['**Developer** · Lyon, France · 2014 - 2019', 'Lyon, France · Remote · 2014 - 2019']
    for (const l of lines) {
      expect(checkFacts(`## Experience\n### Globex\n${l}`, profile).map(x => x.kind)).toEqual(['dates'])
      expect(checkFacts(`### Globex\n_Developer_\n${l}`, profile).map(x => x.kind)).toEqual(['dates'])
    }
    expect(checkFacts('## Experience\n### Globex\nLyon · Remote · 2016 - 2019', profile)).toEqual([])
    expect(checkFacts('## Experience\n### Globex\nI was in Lyon, France, and then moved on · 2014 - 2019 and more', profile)).toEqual([])
  })
})
