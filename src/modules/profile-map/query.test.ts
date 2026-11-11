import { describe, expect, it } from 'vitest'
import { vaultSource } from './__fixtures__/source'
import { buildVault } from './build'
import { getBacklinks, getMap, getNote, listNotes, searchVault } from './query'
import { PROFILE_TOOLS } from './tools'

const vault = buildVault(vaultSource())
const CONTACT = /robin@example\.test|\+33 6|linkedin\.com\/in\/robin|github\.com\/robin/

describe('getMap', () => {
  const result = getMap(vault)

  it('lists every note once, nesting evidence and projects under their role', () => {
    const lines = result.map.split('\n')
    const role = lines.findIndex((l) => l.startsWith('- e1 · '))
    expect(lines[role + 1]).toBe('  - pr1 · [project] Release train — Quarterly release train.')
    expect(lines.slice(role + 1, role + 4).some((l) => l.startsWith('  - a1 · [achievement] '))).toBe(true)
    expect(lines[role]).toBe('- e1 · Program Manager — Fictional Freight — Mar 2021 – present · 1 achievement, 1 responsibility')
    expect(result.map).not.toContain('## Projects')
    expect(result.map).toContain('## Capabilities')
  })

  it('carries counts, completeness and gaps', () => {
    expect(result.counts.evidence).toBe(2)
    expect(result.completeness).toBeGreaterThan(0)
    expect(result.gaps.length).toBeGreaterThan(0)
  })

  it('never contains contact details', () => {
    expect(result.map).not.toMatch(CONTACT)
  })
})

describe('getNote', () => {
  it('returns the self-contained render with followable links', () => {
    const note = getNote(vault, 'a1')!
    expect(note.markdown).toContain('Program Manager at Fictional Freight')
    expect(note.links).toEqual([{ type: 'demonstrates', id: 's1', noteType: 'capability', title: 'Release management' }])
    expect(note.backlinks).toEqual([{ type: 'has', id: 'e1', noteType: 'experience', title: expect.any(String) }])
  })

  it('scrubs contact details from the identity note and bodies', () => {
    expect(getNote(vault, 'p1')!.markdown).not.toMatch(CONTACT)
    expect(getNote(vault, 'e1')!.markdown).not.toMatch(CONTACT)
  })

  it('returns null for an unknown id', () => {
    expect(getNote(vault, 'nope')).toBeNull()
  })
})

describe('listNotes', () => {
  it('filters capabilities by kind and status', () => {
    expect(listNotes(vault, { type: 'capability', kind: 'tool' }).notes.map((n) => n.title)).toEqual(['Confluence'])
    expect(listNotes(vault, { type: 'capability', status: 'proven' }).notes.map((n) => n.id)).toEqual(['s1', 's2'])
  })

  it('filters evidence by kind and gives each its context', () => {
    const achievements = listNotes(vault, { type: 'evidence', evidenceKind: 'achievement' }).notes
    expect(achievements).toEqual([expect.objectContaining({ id: 'a1', context: 'Program Manager at Fictional Freight, Mar 2021 – present' })])
  })

  it('pages results, reporting the total', () => {
    const page = listNotes(vault, { type: 'capability' }, { offset: 1, limit: 2 })
    expect(page.total).toBe(5)
    expect(page.notes.map((n) => n.id)).toEqual(['s2', 's3'])
  })
})

describe('contact details in titles', () => {
  // Names that hold a contact value (here the LinkedIn URL) must not leak
  // through link titles, evidence context, rendered notes or gaps.
  const leaky = buildVault(vaultSource({
    projects: [{ ...vaultSource().projects[0], name: 'linkedin.com/in/robin' }],
    experiences: [{ ...vaultSource().experiences[0], company: 'linkedin.com/in/robin' }],
  }))
  const site = /linkedin\.com\/in\/robin/

  it('scrubs link titles, context and gap messages', () => {
    expect(JSON.stringify(getNote(leaky, 'e1'))).not.toMatch(site)
    expect(JSON.stringify(listNotes(leaky, { type: 'evidence' }))).not.toMatch(site)
    expect(JSON.stringify(getMap(leaky))).not.toMatch(site)
  })
})

describe('getBacklinks', () => {
  it('returns the evidence behind a capability', () => {
    expect(getBacklinks(vault, 's1')!.backlinks).toEqual([expect.objectContaining({ link: 'demonstrates', id: 'a1' })])
  })
})

describe('searchVault', () => {
  it('finds notes by any term, ranking title matches first', () => {
    const hits = searchVault(vault, 'release train')
    expect(hits[0].id).toBe('pr1')
    expect(hits.map((h) => h.id)).toEqual(expect.arrayContaining(['a1', 's1']))
  })

  it('restricts to the given types', () => {
    expect(searchVault(vault, 'release', { types: ['capability'] }).map((h) => h.id)).toEqual(['s1'])
  })

  it('never matches or returns contact details', () => {
    expect(JSON.stringify(searchVault(vault, 'robin@example.test +33 linkedin'))).not.toMatch(CONTACT)
    expect(JSON.stringify(searchVault(vault, 'delivery program'))).not.toMatch(CONTACT)
  })

  it('returns nothing for a query with no usable terms', () => {
    expect(searchVault(vault, ' a ')).toEqual([])
  })
})

describe('PROFILE_TOOLS', () => {
  const tool = (name: string) => PROFILE_TOOLS.find((t) => t.name === name)!

  it('exposes the six profile tools', () => {
    expect(PROFILE_TOOLS.map((t) => t.name)).toEqual([
      'profile_map', 'profile_get_note', 'profile_list', 'profile_backlinks', 'profile_search', 'profile_gaps',
    ])
  })

  it('answers an unknown id with a hint instead of throwing', () => {
    expect(tool('profile_get_note').run(vault, { id: 'nope' })).toEqual({ error: expect.stringContaining('profile_map') })
  })

  it('validates arguments with its schema', () => {
    expect(tool('profile_list').inputSchema.safeParse({ type: 'capability', kind: 'tool' }).success).toBe(true)
    expect(tool('profile_list').inputSchema.safeParse({ type: 'secrets' }).success).toBe(false)
  })
})
