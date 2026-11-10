import { describe, expect, it } from 'vitest'
import {
  CANDIDATE_STATE_CHAR_BUDGET,
  ROLE_DESCRIPTION_MAX_CHARS,
  buildCandidateState,
  candidateStateSize,
  cutAtSentence,
  type CandidateSource,
} from './candidate-state'

const d = (s: string) => new Date(`${s}-01T00:00:00Z`)

type Experience = CandidateSource['experiences'][number]

function exp(role: string, company: string, start: string, end: string | null, summary = '', activities: string[] = []): Experience {
  return {
    role, company, startDate: d(start), endDate: end ? d(end) : null, location: '12 Rue Exemple, Lyon', remote: false, summary,
    activities: activities.map((description) => ({ kind: 'responsibility', description, impact: null, highlighted: false })),
  }
}

function snapshot(overrides: Partial<CandidateSource> = {}): CandidateSource {
  return {
    name: 'Robin Placeholder',
    email: 'robin.placeholder@example.test',
    phone: '+33 6 12 34 56 78',
    website: 'https://robin-placeholder.example.test',
    linkedin: 'https://www.linkedin.com/in/robin-placeholder',
    location: '12 Rue Exemple, 69000 Lyon, France',
    headline: 'Program manager in B2B software',
    summary: 'Robin Placeholder runs cross-functional programs. Contact robin.placeholder@example.test or see https://portfolio.example.test.',
    experiences: [
      exp('Program Manager', 'Fictional Freight', '2021-03', null, 'Runs the delivery program.', ['Planned quarterly roadmaps', 'Wrote https://blog.example.test/post about delivery']),
      exp('Project Coordinator', 'Example Parcels', '2017-01', '2021-02', 'Coordinated integration projects.'),
    ],
    skills: [
      { name: 'Jira', category: 'Tools', level: 'expert', yearsOfExperience: 5 },
      { name: 'Stakeholder management', category: 'Delivery', level: 'expert', yearsOfExperience: null },
    ],
    educations: [{ institution: 'Example University', qualification: 'MSc', field: 'Supply chain', startDate: d('2012-09'), endDate: d('2014-06'), grade: null }],
    certifications: [{ name: 'PMP', issuer: 'PMI', issueDate: d('2018-05'), expiryDate: null }],
    competencies: [{ name: 'Risk management' }],
    languages: [{ name: 'French', proficiency: 'native' }, { name: 'English', proficiency: null }],
    projects: [{ name: 'Side project', description: 'Secret', highlights: [], status: 'active', startDate: null, endDate: null, url: 'https://side.example.test' }],
    ...overrides,
  }
}

const LONG_SENTENCE = 'Coordinated a large cross-functional delivery program across several teams and regions. '

describe('buildCandidateState', () => {
  it('builds the structured state with stable role keys, newest first', () => {
    const unsorted = snapshot()
    unsorted.experiences = [...unsorted.experiences].reverse()
    const { state, timeline } = buildCandidateState(unsorted)
    expect(Object.keys(state.roles)).toEqual(['role_1', 'role_2'])
    expect(state.roles.role_1).toMatchObject({ title: 'Program Manager', company: 'Fictional Freight', dates: 'Mar 2021 – present' })
    expect(state.roles.role_2.dates).toBe('Jan 2017 – Feb 2021')
    expect(timeline).toEqual([
      { key: 'role_1', label: 'Program Manager', start: { y: 2021, m: 3 }, end: 'present' },
      { key: 'role_2', label: 'Project Coordinator', start: { y: 2017, m: 1 }, end: { y: 2021, m: 2 } },
    ])
    expect(state.education).toEqual(['MSc in Supply chain, Example University (2014)'])
    expect(state.certifications).toEqual(['PMP, PMI (2018)'])
    expect(state.languages).toEqual(['French (native)', 'English'])
    expect(state.skills).toEqual({ Tools: ['Jira'], Delivery: ['Stakeholder management'], Competencies: ['Risk management'] })
  })

  it('leaks no name, email, phone, links or address', () => {
    const { state } = buildCandidateState(snapshot())
    const json = JSON.stringify(state)
    for (const leak of [
      'Robin Placeholder', 'robin.placeholder@example.test', '+33 6 12 34 56 78', 'robin-placeholder.example.test',
      'linkedin.com', 'portfolio.example.test', 'blog.example.test', 'Rue Exemple', '69000', 'side.example.test', 'Secret',
    ]) {
      expect(json).not.toContain(leak)
    }
    expect(json).not.toMatch(/https?:\/\//)
    expect(json).not.toMatch(/@/)
    expect(Object.keys(state)).toEqual(['summary', 'roles', 'education', 'certifications', 'languages', 'skills'])
    expect(state.summary).toContain('runs cross-functional programs')
  })

  it('keeps every role and its dates when one role is very long', () => {
    const s = snapshot({
      experiences: [
        exp('Head of Delivery', 'Long Corp', '2022-01', null, LONG_SENTENCE.repeat(300)),
        ...Array.from({ length: 7 }, (_, i) => exp(`Role ${i}`, `Company ${i}`, `${2014 - i * 2}-01`, `${2015 - i * 2}-12`, 'Short role.')),
      ],
    })
    const { state, timeline } = buildCandidateState(s)
    expect(Object.keys(state.roles)).toHaveLength(8)
    expect(timeline).toHaveLength(8)
    const long = state.roles.role_1.description
    expect(long.length).toBeLessThanOrEqual(ROLE_DESCRIPTION_MAX_CHARS)
    expect(long.endsWith('regions.')).toBe(true)
    expect(state.roles.role_8).toMatchObject({ title: 'Role 6', dates: 'Jan 2002 – Dec 2003', description: 'Short role.' })
  })

  it('stays under the size budget for a large profile without dropping roles or dates', () => {
    const s = snapshot({
      experiences: Array.from({ length: 20 }, (_, i) =>
        exp(`Role ${i}`, `Company ${i}`, `${2025 - i}-01`, i === 0 ? null : `${2025 - i}-12`, LONG_SENTENCE.repeat(40), Array.from({ length: 10 }, (_, n) => `Activity ${n} with a fairly long description of what was done and why it mattered`)),
      ),
      skills: Array.from({ length: 300 }, (_, i) => ({ name: `Skill number ${i}`, category: `Category ${i % 6}`, level: 'expert', yearsOfExperience: null })),
    })
    const { state } = buildCandidateState(s)
    expect(candidateStateSize(state)).toBeLessThanOrEqual(CANDIDATE_STATE_CHAR_BUDGET)
    expect(Object.keys(state.roles)).toHaveLength(20)
    for (const r of Object.values(state.roles)) expect(r.dates).toMatch(/^[A-Z][a-z]{2} \d{4} – /)
  })

  it('leaves a normal profile untouched by the budget', () => {
    const { state } = buildCandidateState(snapshot())
    expect(state.roles.role_1.description).toBe('Runs the delivery program.\nPlanned quarterly roadmaps.\nWrote about delivery.')
  })
})

describe('cutAtSentence', () => {
  it('returns short text unchanged', () => {
    expect(cutAtSentence('One. Two.', 100)).toBe('One. Two.')
  })

  it('cuts at the last sentence end inside the limit', () => {
    expect(cutAtSentence('First sentence here. Second sentence here. Third one.', 45)).toBe('First sentence here. Second sentence here.')
  })

  it('falls back to a word boundary with an ellipsis when no sentence ends late enough', () => {
    const out = cutAtSentence('word '.repeat(50), 40)
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out.endsWith('…')).toBe(true)
  })
})
