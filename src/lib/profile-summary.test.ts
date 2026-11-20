import { expect, test } from 'vitest'
import { buildProfileSummary } from './profile-summary'
import type { FullProfile } from '@/app/types/profile'

function makeProfile(overrides: Record<string, unknown> = {}): FullProfile {
  return {
    id: 'p1', userId: 'u1',
    name: 'Devon Stanton', headline: 'Senior Engineer',
    email: null, phone: null, location: null, website: null, linkedIn: null, github: null,
    summary: null, createdAt: new Date(), updatedAt: new Date(),
    experiences: [],
    skills: [],
    educations: [],
    certifications: [],
    competencies: [],
    languages: [],
    tools: [],
    projects: [],
    ...overrides,
  } as unknown as FullProfile
}

test('includes name and headline', () => {
  const result = buildProfileSummary(makeProfile())
  expect(result).toContain('Devon Stanton')
  expect(result).toContain('Senior Engineer')
})

test('includes top 6 skills by yearsOfExperience', () => {
  const skills = Array.from({ length: 8 }, (_, i) => ({
    id: `s${i}`, profileId: 'p1', name: `Skill${i}`, category: 'Tech',
    level: 'Advanced', yearsOfExperience: i, tags: [], createdAt: new Date(), updatedAt: new Date(),
  }))
  const result = buildProfileSummary(makeProfile({ skills }))
  expect(result).toContain('Skill7')
  expect(result).toContain('Skill6')
  expect(result).not.toContain('Skill0')
  expect(result).not.toContain('Skill1')
})

test('formats experience as role @ company (year–year)', () => {
  const experiences = [{
    id: 'e1', profileId: 'p1', company: 'Acme', role: 'Lead Engineer',
    startDate: new Date('2021-01-01'), endDate: null,
    location: null, remote: false, summary: '', tags: [], activities: [],
    notesUpdatedAt: null, createdAt: new Date(), updatedAt: new Date(),
  }]
  const result = buildProfileSummary(makeProfile({ experiences }))
  expect(result).toContain('Lead Engineer @ Acme (2021–present)')
})

test('includes education when present', () => {
  const educations = [{
    id: 'ed1', profileId: 'p1', institution: 'Leeds', qualification: 'BSc Computer Science',
    field: null, startDate: new Date('2008-09-01'), endDate: new Date('2011-06-01'),
    grade: null, tags: [], createdAt: new Date(), updatedAt: new Date(),
  }]
  const result = buildProfileSummary(makeProfile({ educations }))
  expect(result).toContain('BSc Computer Science, Leeds')
})

test('handles empty profile gracefully', () => {
  const result = buildProfileSummary(makeProfile({ name: null }))
  expect(typeof result).toBe('string')
  expect(result.length).toBeGreaterThan(0)
})

test('the independent experience is neither a job in the list nor the start of the career', () => {
  const result = buildProfileSummary(makeProfile({
    experiences: [
      { type: 'employment', role: 'Engineer', company: 'Acme', startDate: new Date('2020-01-01'), endDate: null },
      { type: 'independent', role: 'Independent projects', company: 'Independent projects', startDate: new Date('1970-01-01'), endDate: null },
    ],
  }))
  expect(result).toContain('Engineer @ Acme')
  expect(result).not.toContain('Independent projects')
  expect(result).not.toMatch(/5\d years experience/)
})
