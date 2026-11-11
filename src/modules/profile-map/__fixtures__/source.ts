import type { VaultSource } from '../source'

export const t = new Date('2026-01-01T00:00:00Z')
export const d = (ym: string) => new Date(`${ym}-01T00:00:00Z`)

export function vaultSource(over: Partial<VaultSource> = {}): VaultSource {
  return {
    id: 'p1', userId: 'u1', name: 'Robin Placeholder',
    email: 'robin@example.test', phone: '+33 6 12 34 56 78', location: 'Lyon',
    website: 'https://robin.example.test', linkedIn: 'linkedin.com/in/robin', github: 'github.com/robin',
    headline: 'Program manager', summary: 'I run programs. Reach me at robin@example.test.',
    createdAt: t, updatedAt: t,
    settings: { searchProfile: { roles: ['Head of Delivery'], remotePreference: 'remote' }, updatedAt: t },
    experiences: [{
      id: 'e1', profileId: 'p1', company: 'Fictional Freight', role: 'Program Manager',
      startDate: d('2021-03'), endDate: null, location: 'Lyon', remote: false,
      summary: '## Overview\nRan the delivery program. Email robin@example.test.', notesUpdatedAt: null, tags: '[]',
      createdAt: t, updatedAt: t,
      skills: [{ skillId: 's2' }],
      activities: [
        { id: 'a1', experienceId: 'e1', kind: 'achievement', description: 'Cut release time', impact: '6 weeks → 2 weeks', highlighted: true, order: 0, tags: '[]', createdAt: t, updatedAt: t, skills: [{ skillId: 's1' }] },
        { id: 'a2', experienceId: 'e1', kind: 'oddity', description: 'Ran standups', impact: null, highlighted: false, order: 1, tags: '[]', createdAt: t, updatedAt: t, skills: [] },
      ],
    }],
    projects: [{
      id: 'pr1', profileId: 'p1', experienceId: 'e1', name: 'Release train', description: 'Quarterly release train.',
      notes: 'Notes about the train.', url: null, repoUrl: null, startDate: d('2022-01'), endDate: null,
      status: 'active', highlights: '["Shipped 4 releases"]', tags: '[]', createdAt: t, updatedAt: t, skills: [],
    }],
    skills: [
      { id: 's1', profileId: 'p1', name: 'Release management', category: 'Delivery', level: 'expert', yearsOfExperience: 5, tags: '[]', notes: null, createdAt: t, updatedAt: t },
      { id: 's2', profileId: 'p1', name: 'Jira', category: 'General', level: 'advanced', yearsOfExperience: null, tags: '[]', notes: null, createdAt: t, updatedAt: t },
      { id: 's3', profileId: 'p1', name: 'Agile', category: 'Delivery', level: 'intermediate', yearsOfExperience: null, tags: '[]', notes: null, createdAt: t, updatedAt: t },
    ],
    tools: [
      { id: 't1', profileId: 'p1', name: 'jira ', category: 'PM', order: 0, createdAt: t, updatedAt: t },
      { id: 't2', profileId: 'p1', name: 'Confluence', category: null, order: 1, createdAt: t, updatedAt: t },
    ],
    competencies: [{ id: 'c1', profileId: 'p1', name: 'Stakeholder management', origin: 'manual', order: 0, createdAt: t, updatedAt: t }],
    educations: [{ id: 'ed1', profileId: 'p1', institution: 'Example University', qualification: 'MSc', field: 'Supply chain', startDate: d('2012-09'), endDate: d('2014-06'), grade: null, notes: null, tags: '[]', createdAt: t, updatedAt: t }],
    certifications: [{ id: 'ce1', profileId: 'p1', name: 'PMP', issuer: 'PMI', issueDate: d('2018-05'), expiryDate: d('2020-05'), credentialUrl: null, tags: '[]', createdAt: t, updatedAt: t, skills: [{ skillId: 's3' }] }],
    languages: [{ id: 'l1', profileId: 'p1', name: 'French', proficiency: 'Native', order: 0, createdAt: t, updatedAt: t }],
    ...over,
  } as VaultSource
}
