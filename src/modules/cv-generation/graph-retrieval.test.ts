import { describe, expect, it, vi } from 'vitest'
vi.mock('@/modules/llm/prompt-context', () => ({ composeSystem: vi.fn(), loadCVSelectPrompt: vi.fn() }))
import { buildVault } from '@/modules/profile-map/build'
import { vaultSource } from '@/modules/profile-map/__fixtures__/source'
import { buildKnowledgeGraph } from '@/modules/knowledge-graph/graph'
import { bigCandidates } from './__fixtures__/candidates'
import { buildBriefFor } from './__fixtures__/gathered'
import { buildCandidates, selectionHandles } from './candidates'
import { graphEvidencePrompt, graphScores, retrieveCvEvidence } from './graph-retrieval'
import { fallbackPicks, selectPrompt } from './select'

describe('CV graph retrieval boundary', () => {
  it('adds graph paths using only menu handles and preserves the complete menu', () => {
    const vault = buildVault(vaultSource())
    const candidates = buildCandidates(vault)
    const handles = selectionHandles(candidates)
    const brief = buildBriefFor()
    const strategy = { mustHave: ['Release management'], niceToHave: ['Nuclear engineering'] }
    const matches = retrieveCvEvidence(buildKnowledgeGraph(vault), brief, strategy)
    const data = graphEvidencePrompt(matches, handles)
    expect(data).toContain('demonstrates')
    expect(data).toContain('confirmed')
    expect(data).toContain(handles.activities.byId.get('a1'))
    expect(data).not.toContain('"a1"')
    expect(data).not.toContain('robin@example.test')
    const rows = JSON.parse(data.split('\n\n').at(-1)!)
    expect(rows.find((r: { requirement: string }) => r.requirement === 'Nuclear engineering').candidates).toEqual([])
    const prompt = selectPrompt(brief, candidates, strategy, handles, matches)
    expect(prompt).toContain('# Related profile evidence')
    expect(prompt).toContain('Ran standups') // unrelated evidence is still selectable
    expect(prompt).toContain('not proof')
  })

  it('bounds the additional prompt and filters non-selectable graph nodes', () => {
    const c = bigCandidates(1, 1, 1)
    const matches = Array.from({ length: 24 }, (_, i) => ({ requirement: String(i) + 'x'.repeat(600), matches: [
      { nodeId: 'e0a0', seedId: 's0', score: 13, match: 'name' as const, path: [] },
      { nodeId: 'not-in-menu', seedId: 's0', score: 13, match: 'name' as const, path: [] },
    ] }))
    const prompt = graphEvidencePrompt(matches, selectionHandles(c))
    expect(prompt.length).toBeLessThan(18_000)
    const rows = JSON.parse(prompt.split('\n\n').at(-1)!)
    expect(rows.every((r: { candidates: unknown[] }) => r.candidates.length === 1)).toBe(true)
    expect(prompt).not.toContain('not-in-menu')
  })

  it('lets a linked achievement outrank an otherwise identical fallback candidate without inventing picks', () => {
    const c = bigCandidates(1, 2, 0)
    c.employers[0].activities[1].kind = 'achievement'
    const matches = [{ requirement: 'Release management', matches: [{ nodeId: 'e0a1', seedId: 'skill', score: 13, match: 'name' as const, path: [] }] }]
    const brief = buildBriefFor({ leadWith: [], emphasise: [] })
    const before = fallbackPicks(brief, c)
    const after = fallbackPicks(brief, c, { graphScores: graphScores(matches) })
    expect(before.activities[0].id).toBe('e0a0')
    expect(after.activities[0].id).toBe('e0a1')
    expect(after.activities.map((a) => a.id).sort()).toEqual(before.activities.map((a) => a.id).sort())
  })
})
