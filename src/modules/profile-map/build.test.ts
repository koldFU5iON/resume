import { describe, expect, it } from 'vitest'
import { toProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { buildVault, notesOf, PREFERENCES_NOTE_ID } from './build'
import { profileMap } from './map'
import { renderNote } from './render'
import { vaultSource } from './__fixtures__/source'
import type { CapabilityNote, EvidenceNote } from './types'

const source = vaultSource

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
