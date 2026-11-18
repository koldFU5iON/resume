import { describe, expect, it } from 'vitest'
import { evidenceRefs, mixedSourceNote, normaliseLabel, resolveSources, snippetOf, SNIPPET_MAX_CHARS, toProvenance } from './provenance'

const act = (id: string, text: string, impact: string | null = null) => ({ id, experienceId: 'e', kind: 'achievement' as const, text, impact, highlighted: false })
const refsOf = (activities: ReturnType<typeof act>[], projects: Array<{ id: string; name: string; text: string }> = []) => evidenceRefs({ activities, projects })

const UNITY_AWARDS = act('a1', 'Cut asset collection from 4 weeks to 1 week for the Unity Awards, across 150 customer projects')
const ARM = act('a2', 'Cut asset collection from 3 weeks to under an hour with the ARM workflow, for the whole business')

describe('evidenceRefs', () => {
  it('labels activities E1.. then projects P1.., and keeps the real ids and the text a figure is checked against', () => {
    const refs = refsOf([act('a1', 'Cut release time by 40%', 'saved 2 weeks'), act('a2', 'Ran planning')], [{ id: 'p1', name: 'Demo', text: 'Reached 14,000+' }])
    expect(refs.map((r) => [r.label, r.id, r.kind])).toEqual([['E1', 'a1', 'activity'], ['E2', 'a2', 'activity'], ['P1', 'p1', 'project']])
    expect(refs[0].text).toContain('saved 2 weeks')
    expect(refs[2].snippet).toBe('Demo: Reached 14,000+')
  })
})

describe('snippetOf', () => {
  it('is one plain line of at most 140 characters, with no markup', () => {
    const s = snippetOf(`**Led** [the thing](https://x.test) ${'word '.repeat(60)}`)
    expect(s.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS)
    expect(s.endsWith('…')).toBe(true)
    expect(s).not.toMatch(/\*\*|\]\(|https/)
  })
  it('scrubs an email address or URL that slipped through, and keeps the figures', () => {
    expect(snippetOf('Reached 14,000+ people, mail robin@example.test or see https://example.test/x and www.example.test')).toBe('Reached 14,000+ people, mail or see and')
  })
})

describe('normaliseLabel / resolveSources', () => {
  it('accepts E1, [e1], " P2 " and E01; rejects anything else', () => {
    expect([normaliseLabel('E1'), normaliseLabel('[e2]'), normaliseLabel(' P2 '), normaliseLabel('E01')]).toEqual(['E1', 'E2', 'P2', 'E1'])
    for (const bad of ['', 'X1', 'E', 'E1,E2', 'activity 1', 'ua1']) expect(normaliseLabel(bad)).toBeNull()
  })
  it('keeps valid labels once each, in the writer order, and counts (and drops) unknown ones', () => {
    const refs = refsOf([act('a1', 'A'), act('a2', 'B')])
    const r = resolveSources(['E2', 'e1', 'E2', 'E9', 'nonsense'], refs)
    expect(r.sources.map((s) => s.id)).toEqual(['a2', 'a1'])
    expect(r.unknown).toBe(2)
  })
})

describe('toProvenance', () => {
  it('stores the real id, the kind and a snippet, never the label', () => {
    const refs = refsOf([act('a1', 'Cut release time by 40%')])
    expect(toProvenance('Cut release time by 40%.', refs)).toEqual({ text: 'Cut release time by 40%.', sources: [{ id: 'a1', kind: 'activity', snippet: 'Cut release time by 40%' }] })
  })
})

describe('mixedSourceNote (related activities with different figures must not be conflated)', () => {
  const refs = refsOf([UNITY_AWARDS, ARM])
  it('fires when one bullet takes figures from two different activities, and names both', () => {
    const note = mixedSourceNote('Cut asset collection from 4 weeks to 1 week across 150 projects, and from 3 weeks to under an hour', refs)
    expect(note).toMatch(/^Bullet combines figures from 2 activities: /)
    expect(note).toContain(refs[0].snippet)
    expect(note).toContain(refs[1].snippet)
    expect(note).toContain(' / ')
  })
  it('does not fire for a single source, or when a second cited item adds no figure of the bullet', () => {
    expect(mixedSourceNote('Cut asset collection from 4 weeks to 1 week across 150 projects', [refs[0]])).toBeNull()
    expect(mixedSourceNote('Cut asset collection from 4 weeks to 1 week across 150 projects', refs)).toBeNull()
  })
  it('does not fire for a bullet with no figures', () => {
    expect(mixedSourceNote('Cut asset collection time', refs)).toBeNull()
  })
  it('allows merging two items that state the same measured result (the same figures in both)', () => {
    const same = refsOf([act('a1', 'Won the Unity Awards with 14,000+ attendees'), act('a2', 'The Unity Awards stream reached 14,000+ people')])
    expect(mixedSourceNote('Won the Unity Awards, reaching 14,000+ people', same)).toBeNull()
  })
  it('counts a figure written as 14k the same as 14,000', () => {
    const same = refsOf([act('a1', 'Reached 14,000 people'), act('a2', 'Reached 14k people on stream')])
    expect(mixedSourceNote('Reached 14k people', same)).toBeNull()
  })
})
