import { describe, expect, it } from 'vitest'
import { toProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { buildVault, notesOf, PREFERENCES_NOTE_ID } from './build'
import { profileMap } from './map'
import { renderNote } from './render'
import type { VaultSource } from './source'
import type { CapabilityNote, EvidenceNote } from './types'

const t = new Date('2026-01-01T00:00:00Z')
const d = (ym: string) => new Date(`${ym}-01T00:00:00Z`)

function source(over: Partial<VaultSource> = {}): VaultSource {
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

describe('buildVault', () => {
  const vault = buildVault(source())

  it('turns every row into a note, indexed by type', () => {
    expect(vault.byType.experience).toEqual(['e1'])
    expect(vault.byType.evidence).toEqual(['a1', 'a2'])
    expect(vault.byType.project).toEqual(['pr1'])
    expect(vault.byType.preferences).toEqual([PREFERENCES_NOTE_ID])
    expect(vault.identity.body).toContain('I run programs')
  })

  it('merges skills, tools and competencies into one capability set, de-duplicated by name', () => {
    const caps = notesOf(vault, 'capability')
    expect(caps.map((c) => `${c.props.kind}:${c.props.name}`)).toEqual([
      'skill:Release management', 'skill:Jira', 'skill:Agile', 'tool:Confluence', 'competency:Stakeholder management',
    ])
  })

  it('links narratives, evidence and capabilities, with computed backlinks', () => {
    const exp = vault.notes.get('e1')!
    expect(exp.links).toEqual([
      { type: 'contains', id: 'pr1' },
      { type: 'has', id: 'a1' },
      { type: 'has', id: 'a2' },
      { type: 'uses', id: 's2' },
    ])
    expect(vault.notes.get('s1')!.backlinks).toEqual([{ type: 'demonstrates', id: 'a1' }])
  })

  it('derives capability status from links', () => {
    const status = (id: string) => (vault.notes.get(id) as CapabilityNote).props.status
    expect(status('s1')).toBe('proven')
    expect(status('s2')).toBe('proven')
    expect(status('s3')).toBe('certified')
    expect(status('t2')).toBe('claimed')
  })

  it('narrows unknown evidence kinds to responsibility', () => {
    expect((vault.notes.get('a2') as EvidenceNote).props.kind).toBe('responsibility')
  })

  it('collapses project description and notes into one body', () => {
    expect(vault.notes.get('pr1')!.body).toBe('Quarterly release train.\n\nNotes about the train.')
  })
})

describe('renderNote', () => {
  const vault = buildVault(source())

  it('renders evidence self-contained, with its role context', () => {
    expect(renderNote(vault, 'a1')).toBe(
      '**Achievement** (Program Manager at Fictional Freight, Mar 2021 – present): Cut release time\n' +
      'Impact: 6 weeks → 2 weeks\nDemonstrates: Release management',
    )
  })

  it('scrubs contact details by default and includes them only on request', () => {
    const scrubbed = renderNote(vault, 'p1')!
    expect(scrubbed).not.toContain('robin@example.test')
    expect(scrubbed).not.toContain('+33')
    const full = renderNote(vault, 'p1', { pii: 'include' })!
    expect(full).toContain('robin@example.test')
    expect(full).toContain('github.com/robin')
  })

  it('lists a capability with the evidence behind it', () => {
    const md = renderNote(vault, 's1')!
    expect(md).toContain('Evidence:')
    expect(md).toContain('(Program Manager at Fictional Freight, Mar 2021 – present)')
  })

  it('returns null for an unknown id', () => {
    expect(renderNote(vault, 'nope')).toBeNull()
  })
})

describe('profileMap', () => {
  it('indexes every note and reports gaps as questions', () => {
    const map = profileMap(buildVault(source()))
    expect(map.counts.capability).toBe(5)
    expect(map.entries.find((e) => e.id === 'a1')).toMatchObject({ type: 'evidence', parentId: 'e1' })
    expect(map.entries.find((e) => e.id === 'pr1')).toMatchObject({ parentId: 'e1' })
    expect(map.gaps.map((g) => g.message)).toContainEqual(expect.stringContaining('PMP has expired'))
    expect(map.completeness).toBeGreaterThan(0)
    expect(map.completeness).toBeLessThanOrEqual(100)
  })

  it('flags an empty profile', () => {
    const map = profileMap(buildVault(source({
      headline: null, summary: null, experiences: [], projects: [], skills: [], tools: [], competencies: [],
      educations: [], certifications: [], languages: [], settings: null,
    })))
    expect(map.gaps.map((g) => g.area)).toEqual(expect.arrayContaining(['identity', 'experience', 'capability', 'education', 'preferences']))
  })
})

describe('snapshot adapter', () => {
  const snapshot = toProfileSnapshot(buildVault(source()))

  it('keeps the legacy shape, now with summary, github and tools', () => {
    expect(snapshot.summary).toContain('I run programs')
    expect(snapshot.github).toBe('github.com/robin')
    expect(snapshot.tools).toEqual([{ name: 'Confluence', category: null }])
    expect(snapshot.skills.map((s) => s.name)).toEqual(['Release management', 'Jira', 'Agile'])
    expect(snapshot.experiences[0].activities.map((a) => a.description)).toEqual(['Cut release time', 'Ran standups'])
  })

  it('serializes without contact details unless asked', () => {
    const md = serializeProfileForLLM(snapshot)
    expect(md).not.toMatch(/robin@example\.test|\+33 6|linkedin\.com\/in\/robin/)
    expect(md).toContain('## Summary')
    expect(md).toContain('## Tools')
    expect(md).toContain('Mar 2021 – present')
    expect(serializeProfileForLLM(snapshot, { pii: 'include' })).toContain('robin@example.test')
  })
})
