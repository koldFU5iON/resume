import { describe, expect, it } from 'vitest'
import { toProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { buildVault, notesOf, PREFERENCES_NOTE_ID } from './build'
import { profileMap } from './map'
import { renderNote } from './render'
import { d, vaultSource } from './__fixtures__/source'
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
      { type: 'uses', id: 's2', via: 'confirmed' },
    ])
    expect(vault.notes.get('s1')!.backlinks).toEqual([{ type: 'demonstrates', id: 'a1' }])
  })

  it('derives links from exact mentions and [[wikilinks]], unless rejected', () => {
    const base = vaultSource()
    const exp = base.experiences[0]
    const v = buildVault(vaultSource({
      experiences: [{
        ...exp,
        summary: 'Rolled out [[Confluence]] and [[Kubernetes]] across teams.',
        activities: [
          { ...exp.activities[0], description: 'Moved planning into Jira', impact: null, skills: [] },
          { ...exp.activities[1], description: 'Ran agile ceremonies', skills: [{ skillId: 's3', status: 'rejected' }] },
        ],
      }],
    }))
    expect(v.notes.get('a1')!.links).toEqual([{ type: 'demonstrates', id: 's2', via: 'exact' }])
    // "Agile" is mentioned, but the user rejected that link.
    expect(v.notes.get('a2')!.links).toEqual([])
    expect(v.notes.get('e1')!.links).toContainEqual({ type: 'uses', id: 't2', via: 'wikilink' })
    expect(v.unresolved).toEqual([{ noteId: 'e1', name: 'Kubernetes' }])
    expect((v.notes.get('s2') as CapabilityNote).props.status).toBe('proven')
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

  it('flags overlapping roles at one company, duplicated evidence and unmatched wikilinks', () => {
    const base = vaultSource()
    const e1 = base.experiences[0]
    const a1 = e1.activities[0]
    const map = profileMap(buildVault(vaultSource({
      experiences: [
        { ...e1, summary: 'Worked with [[Kubernetes]].',
          activities: [{ ...a1, description: 'Launched the annual awards programme across four regions' }] },
        // Same company, starts a year into e1 (still running): a real overlap.
        { ...e1, id: 'e2', role: 'Senior Program Manager', startDate: d('2022-03'),
          activities: [{ ...a1, id: 'a9', experienceId: 'e2', description: 'Launched the annual awards programme across four regions.' }] },
        // Same company, starts within the three-month handover after e3 ends: fine.
        { ...e1, id: 'e3', company: 'Other Co', startDate: d('2015-01'), endDate: d('2016-01'), activities: [] },
        { ...e1, id: 'e4', company: 'Other Co', startDate: d('2015-11'), endDate: d('2017-01'), activities: [] },
      ],
    })))
    const messages = map.gaps.map((g) => g.message)
    expect(messages).toContainEqual(expect.stringMatching(/Program Manager and Senior Program Manager at Fictional Freight overlap/))
    expect(messages.filter((m) => m.includes('Other Co') && m.includes('overlap'))).toEqual([])
    expect(messages).toContainEqual(expect.stringMatching(/appears under both .* and /))
    expect(messages).toContainEqual(expect.stringContaining("[[Kubernetes]] in Program Manager — Fictional Freight doesn't match"))
  })

  it('flags an empty profile', () => {
    const map = profileMap(buildVault(source({
      headline: null, summary: null, experiences: [], projects: [], skills: [],
      educations: [], certifications: [], languages: [], settings: null,
    })))
    expect(map.gaps.map((g) => g.area)).toEqual(expect.arrayContaining(['identity', 'experience', 'capability', 'education', 'preferences']))
  })
})

describe('snapshot adapter', () => {
  const snapshot = toProfileSnapshot(buildVault(source()))

  it('gives every AI feature plain prose: [[wikilinks]] lose their brackets', () => {
    const base = vaultSource()
    const snap = toProfileSnapshot(buildVault(vaultSource({
      experiences: [{ ...base.experiences[0], summary: 'Moved the team to [[Jira|Jira Cloud]].',
        activities: [{ ...base.experiences[0].activities[0], description: 'Ran [[Agile]] rituals' }] }],
    })))
    expect(snap.experiences[0].summary).toBe('Moved the team to Jira Cloud.')
    expect(snap.experiences[0].activities[0].description).toBe('Ran Agile rituals')
  })

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

describe('contact scrubber', () => {
  it('removes contact values without collapsing other whitespace', async () => {
    const { makeContactScrubber } = await import('./pii')
    const scrub = makeContactScrubber({ email: 'robin@example.test', phone: null, linkedIn: null, github: null, website: null })
    expect(scrub('Line one  \n  - nested item\nMail: robin@example.test today')).toBe('Line one  \n  - nested item\nMail: today')
  })
})

describe('capLines', () => {
  it('keeps whole lines and says how many were dropped', async () => {
    const { capLines } = await import('./format')
    expect(capLines('aaaa\nbbbb\ncccc', 10, 'narrow it')).toBe('aaaa\nbbbb\n[1 more lines omitted; narrow it]')
    expect(capLines('short', 10)).toBe('short')
  })
})
