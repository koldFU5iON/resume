import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/llm/complete-json', () => ({ completeJSON: vi.fn() }))
vi.mock('@/modules/llm/prompt-context', () => ({
  composeSystem: (...parts: string[]) => parts.join('\n'),
  loadCVSelectPrompt: vi.fn(async () => 'SELECT INSTRUCTIONS'),
}))

import { LLMError } from '@/modules/llm/errors'
import { buildVault } from '@/modules/profile-map/build'
import { vaultSource } from '@/modules/profile-map/__fixtures__/source'
import { buildKnowledgeGraph } from '@/modules/knowledge-graph/graph'
import { completeJSON } from '@/modules/llm/complete-json'
import { extractJSON } from '@/modules/llm/extract-json'
import { bigCandidates } from './__fixtures__/candidates'
import { buildBriefFor, gathered } from './__fixtures__/gathered'
import { scripted } from './__fixtures__/write'
import { buildCandidates, selectionHandles } from './candidates'
import { parseSelection } from './schema'
import { runSelect, SelectOutputSchema } from './select'

const mockJSON = vi.mocked(completeJSON)
const context = () => ({ profileId: 'profile', jobApplicationId: 'job', runId: 'run', deadline: Date.now() + 60_000 })
const brief = buildBriefFor({ leadWith: [], emphasise: [] })
const answer = (responses: Array<object | 'junk'>) => {
  const llm = scripted((raw, schema) => extractJSON(raw, schema as never), responses)
  mockJSON.mockImplementation(llm.impl as never)
  return llm
}

beforeEach(() => vi.clearAllMocks())

describe('Select short handles through the model boundary', () => {
  it('passes graph evidence through the real Select boundary and records retrieval on model and fallback paths', async () => {
    const vault = buildVault(vaultSource())
    const candidates = buildCandidates(vault)
    const handles = selectionHandles(candidates)
    const g = gathered({ candidates, knowledgeGraph: buildKnowledgeGraph(vault), strategy: {
      ...gathered().strategy, mustHave: ['Release management'], niceToHave: [],
    } })
    const llm = answer([{ employers: ['EMP1'], activities: [handles.activities.byId.get('a1')] }])
    const selected = await runSelect(g, brief, context())
    expect(llm.calls).toHaveLength(1)
    expect(llm.calls[0].prompt).toContain('# Related profile evidence')
    expect(llm.calls[0].prompt).toContain('demonstrates')
    expect(selected.selection.mode).toBe('model')
    expect(selected.selection.employers.flatMap((e) => e.bullets).some((a) => a.id === 'a1')).toBe(true)
    expect(selected.notes.join(' ')).toContain('Graph retrieval')

    mockJSON.mockRejectedValue(new LLMError('unavailable', 'unavailable'))
    const fallback = await runSelect(g, brief, context())
    expect(fallback.selection.mode).toBe('fallback')
    expect(fallback.notes.join(' ')).toContain('Graph retrieval')
    expect(fallback.selection.employers.flatMap((e) => e.bullets).some((a) => a.id === 'a1')).toBe(true)
  })
  it('indexes every section deterministically and stores real IDs for all successful picks', async () => {
    const candidates = bigCandidates(3, 3, 3)
    candidates.skills[0].label = 'S3 Assembly'
    for (const section of ['skills', 'tools', 'competencies', 'certifications', 'education', 'projects'] as const) {
      candidates[section].forEach((row) => { row.id = `opaque-${row.id}` })
    }
    const handles = selectionHandles(candidates)
    expect(handles).toEqual(selectionHandles(structuredClone(candidates)))
    const llm = answer([{
      employers: [{ id: ' [ emp1 ] ', relevance: 4 }],
      activities: ['A1', 'A2'], skills: ['S1', ' [ s2 ] '], tools: ['T2', 'T3'], competencies: ['C1', 'C3'],
      certifications: ['CERT2'], education: ['EDU2'], projects: ['P2'],
    }])
    const result = await runSelect(gathered({ candidates }), brief, context())
    expect(llm.calls).toHaveLength(1)
    const [{ prompt, opts }] = llm.calls
    expect(prompt).toContain('[EMP1] Role 0 — Co 0')
    expect(prompt).toContain('[S1] S3 Assembly')
    for (const [section, map] of Object.entries(handles)) {
      for (const [id, handle] of map.byId) {
        expect(map.byHandle.get(handle), section).toBe(id)
        expect(prompt).toContain(`[${handle}]`)
        expect(prompt).not.toContain(`[${id}]`)
        expect(opts.system).not.toContain(id)
      }
    }
    expect(prompt).not.toContain('[e0]')
    expect(opts).toMatchObject({ role: 'fast', feature: 'cv-gen-select' })
    const stored = parseSelection(JSON.parse(JSON.stringify(result.selection)))
    expect(stored).toMatchObject({
      mode: 'model', employers: [{ key: 'co-0', relevance: 4 }, { key: 'co-1' }, { key: 'co-2' }],
      skills: [{ id: 'opaque-s0' }, { id: 'opaque-s1' }],
      tools: [{ id: 'opaque-t1' }, { id: 'opaque-t2' }],
      competencies: [{ id: 'opaque-c0' }, { id: 'opaque-c2' }],
      certifications: [{ id: 'opaque-ce1' }], education: [{ id: 'opaque-ed1' }], projects: [{ id: 'opaque-p1' }],
    })
    expect(stored?.employers[0].bullets.map((a) => a.id)).toEqual(expect.arrayContaining(['e0a0', 'e0a1']))
  })

  it('rejects wrong sections, raw IDs and broken tokens independently, then enforces duplicate, relevance and current-employer rules', async () => {
    const candidates = bigCandidates()
    candidates.skills[0].id = 'T1'
    candidates.skills[1].id = 'shared-db-id'
    candidates.tools[1].id = 'shared-db-id'
    const llm = answer([{
      employers: [{ id: 'EMP2', relevance: 99 }, { id: 'EMP3', relevance: 3 }, 'EMP4', 'EMP5', 'e0'],
      skills: ['S2', ' [ s2 ] ', 'T1', 'S99', 's2 please', '[S2', '[[S2]]', 'S 2', 'ſ2', 's02', 'shared-db-id', null, { id: 2 }],
      tools: ['T2'], competencies: ['CERT1'],
    }])
    const result = await runSelect(gathered({ candidates }), brief, context())
    expect(llm.calls).toHaveLength(1)
    expect(result.selection.mode).toBe('model')
    expect(result.selection.skills).toEqual([{ id: 'shared-db-id', reason: '', label: 'Skill 1' }])
    expect(result.selection.tools).toEqual([{ id: 'shared-db-id', reason: '', label: 'Tool 1' }])
    expect(result.selection.competencies).toEqual([])
    expect(result.selection.employers.filter((e) => !e.headerOnly).map((e) => e.key)).toEqual(['co-0', 'co-1', 'co-2', 'co-3'])
    expect(result.selection.employers[1].relevance).toBe(5)
    expect(result.selection.dropped).toContainEqual(expect.objectContaining({ section: 'skills', id: 'shared-db-id', label: 'Skill 1', why: 'duplicate' }))
    expect(result.notes).toEqual(expect.arrayContaining([
      'Rejected 11 invalid selection references in skills.',
      'Rejected 1 invalid selection reference in employers.',
      'Rejected 1 invalid selection reference in competencies.',
    ]))
  })

  it('only credits exact emphasise names with activity or project handles picked and kept', async () => {
    const names = ['Acquisition', 'Retention', 'Reliability', 'Forecasting', 'Equity', 'Liquidity']
    const b = buildBriefFor({
      leadWith: [], emphasise: names.map((name) => ({ name, framing: `Support ${name}`, why: '' })),
      budgets: { ...brief.budgets, projects: 1 },
    })
    answer([{
      employers: ['EMP1'], activities: ['A1'], projects: ['P1', 'P2'], skills: ['S1'],
      emphasise: [
        { item: 'Acquisition', evidence: [' [ a1 ] ', 'A1'] },
        { item: 'Retention', evidence: ['p1'] },
        { item: 'Reliability', evidence: ['P2'] },
        { item: 'Forecasting', evidence: ['S1', 'e0a0', null] },
        { item: 'Equity', evidence: ['A2'] },
        { item: 'Support Liquidity', evidence: ['A1'] },
      ],
    }])
    const result = await runSelect(gathered(), b, context())
    expect(result.selection.uncovered).toEqual(names.slice(2))
    expect(result.notes).toContain('Rejected 4 invalid selection references in emphasise evidence (use picked activities or projects).')
    expect(result.notes).toContain('Ignored emphasise claims whose item name did not exactly match the brief.')
  })

  it('uses the deterministic rules when all references fail and keeps the diagnostics and usage', async () => {
    const candidates = bigCandidates(2, 3, 3)
    candidates.skills[0].id = 'T1'
    candidates.skills[1].id = 'opaque-skill'
    const llm = answer([{ skills: ['T1', 'opaque-skill'], employers: ['co-1'], activities: ['A99'] }])
    const result = await runSelect(gathered({ candidates }), brief, context())
    expect(llm.calls).toHaveLength(1)
    expect(result).toMatchObject({ model: null, retries: 0, usage: { calls: 1 }, selection: { mode: 'fallback', skills: [] } })
    expect(result.notes).toContain('Rejected 2 invalid selection references in skills.')
    expect(result.notes[0]).toContain('no valid candidate handles')
  })

  it.each([
    { selection: { employers: ['EMP1'], skills: ['S1'] } },
    { type: 'object', properties: { employers: { type: 'array' } } },
    { explanation: 'No relevant evidence' },
    {},
  ])('rejects an unrelated root and recovers on the existing schema retry: %j', async (bad) => {
    expect(SelectOutputSchema.safeParse(bad).success).toBe(false)
    const llm = answer([bad, { employers: ['EMP1'], skills: ['S1', 'S2'], tools: ['T1', 'T2'] }])
    const result = await runSelect(gathered(), brief, context())
    expect(llm.calls).toHaveLength(2)
    expect(llm.calls[1].prompt).toContain('these fields were missing or the wrong type: employers')
    expect(result).toMatchObject({ retries: 1, selection: { mode: 'model' }, usage: { calls: 2 } })
    expect(result.selection.skills.map((s) => s.id)).toEqual(['s0', 's1'])
    expect(result.selection.tools.map((s) => s.id)).toEqual(['t0', 't1'])
  })

  it('retains partial answers and metadata but reports an explicitly empty selection separately', async () => {
    expect(SelectOutputSchema.safeParse({ skills: ['S1'], explanation: 'Relevant' }).success).toBe(true)
    const llm = answer([{ employers: [], skills: [] }])
    const result = await runSelect(gathered(), brief, context())
    expect(llm.calls).toHaveLength(1)
    expect(result.selection.mode).toBe('fallback')
    expect(result.notes[0]).toContain('empty lists for every selection section')
  })

  it('retains paid usage and retry count when both response shapes are rejected', async () => {
    const llm = answer([{ selection: { employers: ['EMP1'] } }, { type: 'object', properties: {} }])
    const result = await runSelect(gathered(), brief, context())
    expect(llm.calls).toHaveLength(2)
    expect(result).toMatchObject({ model: null, retries: 1, selection: { mode: 'fallback' }, usage: { calls: 2 } })
    expect(result.notes[0]).toContain('invalid_output')
  })

  it('records an attempted retry even if the provider throws before returning usage', async () => {
    const llm = answer([{ selection: { employers: ['EMP1'] } }])
    mockJSON.mockImplementationOnce(llm.impl as never).mockRejectedValueOnce(new LLMError('timed out', 'timeout'))
    const result = await runSelect(gathered(), brief, context())
    expect(mockJSON).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ model: null, retries: 1, selection: { mode: 'fallback' }, usage: { calls: 1 } })
    expect(result.retryReasons).toEqual([expect.stringContaining('fields were missing or the wrong type: employers')])
  })

  it('records zero retries when the schema fails with too little time left', async () => {
    const llm = answer([{ selection: { employers: ['EMP1'] } }])
    const result = await runSelect(gathered(), brief, { ...context(), deadline: Date.now() + 1_000 })
    expect(llm.calls).toHaveLength(1)
    expect(result).toMatchObject({ retries: 0, retryReasons: [], selection: { mode: 'fallback' }, usage: { calls: 1 } })
  })

  it('uses the existing schema retry on a bad JSON shape and falls back if it remains unreadable', async () => {
    const llm = answer([{ skills: {} }, { tools: 'T1' }])
    const result = await runSelect(gathered(), brief, context())
    expect(llm.calls).toHaveLength(2)
    expect(result.selection.mode).toBe('fallback')
    expect(result.notes[0]).toContain('invalid_output')
  })
})
