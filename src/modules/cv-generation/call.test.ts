import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/llm/complete-json', () => ({ completeJSON: vi.fn() }))

import { z } from 'zod'
import { completeJSON } from '@/modules/llm/complete-json'
import { addUsage, completeChecked, completeValidated, NO_USAGE, usageOf } from './call'
import { MAX_OUTPUT_TOKENS } from './schema'

const mockJSON = vi.mocked(completeJSON)
const schema = z.object({ a: z.string() })
const good = { extracted: { ok: true as const, value: { a: 'x' } }, finishReason: 'stop', rawText: '', model: 'm' }
const bad = (finishReason: string) => ({
  extracted: { ok: false as const, reason: 'parse' as const, error: null },
  finishReason, rawText: 'SECRET', model: 'm',
})
const opts = (over: Record<string, unknown> = {}) => ({
  role: 'fast' as const,
  system: 's',
  maxOutputTokens: MAX_OUTPUT_TOKENS.select,
  retryMaxOutputTokens: MAX_OUTPUT_TOKENS.selectRetry,
  timeoutMs: 60_000,
  deadline: Date.now() + 120_000,
  feature: 'f',
  attribution: { runId: 'r' },
  label: 'selection',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('output caps', () => {
  it('are brief 4000/8000, select 8000/16000 and each writer 1500/3000', () => {
    expect(MAX_OUTPUT_TOKENS).toEqual({
      brief: 4_000, briefRetry: 8_000, select: 8_000, selectRetry: 16_000,
      writeExperience: 1_500, writeExperienceRetry: 3_000, writeSkills: 1_500, writeSkillsRetry: 3_000, writeProfile: 1_500, writeProfileRetry: 3_000,
    })
  })
})

describe('completeValidated', () => {
  it('makes one call at the first-try cap when the answer is good', async () => {
    mockJSON.mockResolvedValue(good)
    await completeValidated('p1', 'prompt', schema, opts())
    expect(mockJSON).toHaveBeenCalledTimes(1)
    expect(mockJSON.mock.calls[0][3]).toMatchObject({ maxOutputTokens: 8_000 })
  })

  it('retries at the LARGER cap after a bad answer, never at the small cap again', async () => {
    mockJSON.mockResolvedValueOnce(bad('stop')).mockResolvedValueOnce(good)
    const r = await completeValidated('p1', 'prompt', schema, opts())
    expect(r.retries).toBe(1)
    expect(mockJSON.mock.calls[0][3]).toMatchObject({ maxOutputTokens: 8_000 })
    expect(mockJSON.mock.calls[1][3]).toMatchObject({ maxOutputTokens: 16_000 })
    expect(mockJSON.mock.calls[1][1]).toContain('rejected')
  })

  it('uses the larger cap, and says the answer was cut off, when the previous finish reason was length', async () => {
    mockJSON.mockResolvedValueOnce(bad('length')).mockResolvedValueOnce(good)
    await completeValidated('p1', 'prompt', schema, opts())
    expect(mockJSON.mock.calls[1][3]).toMatchObject({ maxOutputTokens: 16_000 })
    expect(mockJSON.mock.calls[1][1]).toContain('cut off')
  })

  it('never lets completeJSON run a second call of its own: at most 2 calls per stage', async () => {
    mockJSON.mockResolvedValue(bad('length'))
    await expect(completeValidated('p1', 'prompt', schema, opts())).rejects.toMatchObject({ kind: 'invalid_output' })
    expect(mockJSON).toHaveBeenCalledTimes(2)
    for (const c of mockJSON.mock.calls) {
      // completeJSON retries a cut-off answer unless fewer than minRetryMs are left: Infinity switches that off.
      expect(c[3]).toMatchObject({ minRetryMs: Number.POSITIVE_INFINITY })
    }
  })

  it('skips the retry when there is no time left', async () => {
    mockJSON.mockResolvedValue(bad('stop'))
    await expect(completeValidated('p1', 'prompt', schema, opts({ deadline: Date.now() + 1_000 }))).rejects.toMatchObject({ kind: 'invalid_output' })
    expect(mockJSON).toHaveBeenCalledTimes(1)
  })
})

describe('usage from the call results (not from rows that may not be written yet)', () => {
  const withUsage = (usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number | null; cacheWriteTokens: number | null } | undefined, model = 'claude-haiku-5-5') => ({ ...good, model, provider: 'anthropic', usage })

  it('prices a call from its own token counts', () => {
    const u = usageOf({ model: 'claude-haiku-5-5', provider: 'anthropic', usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: null, cacheWriteTokens: null } })
    expect(u).toEqual({ input: 1_000_000, output: 1_000_000, costUsd: 0.6, calls: 1 })
  })

  it('shows tokens with a null cost for a model with no listed price', () => {
    expect(usageOf({ model: 'some-unlisted-model', provider: 'anthropic', usage: { inputTokens: 500, outputTokens: 50, cacheReadTokens: null, cacheWriteTokens: null } })).toEqual({ input: 500, output: 50, costUsd: null, calls: 1 })
  })

  it('sums the calls of a stage, a retry included, and a null cost stays null', () => {
    const a = { input: 10, output: 1, costUsd: 0.5, calls: 1 }
    expect(addUsage(a, a)).toEqual({ input: 20, output: 2, costUsd: 1, calls: 2 })
    expect(addUsage(a, { ...a, costUsd: null }).costUsd).toBeNull()
    expect(addUsage(NO_USAGE, a)).toEqual(a)
  })

  it('completeValidated returns the usage of every attempt', async () => {
    mockJSON
      .mockResolvedValueOnce({ ...bad('stop'), model: 'claude-haiku-5-5', provider: 'anthropic', usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: null, cacheWriteTokens: null } })
      .mockResolvedValueOnce(withUsage({ inputTokens: 1200, outputTokens: 150, cacheReadTokens: null, cacheWriteTokens: null }))
    const r = await completeValidated('p1', 'prompt', schema, opts())
    expect(r.usage).toMatchObject({ input: 2200, output: 250, calls: 2 })
    expect(r.usage.costUsd).toBeGreaterThan(0)
  })
})

describe('completeChecked', () => {
  const chk = (hard: string[] = [], soft: string[] = []) => ({ hard, soft })
  const copts = (check: (v: { a: string }) => { hard: string[]; soft: string[] }, over: Record<string, unknown> = {}) => ({
    ...opts({ maxOutputTokens: 1_500, retryMaxOutputTokens: 3_000, label: 'experience section' }), check, ...over,
  })

  it('makes one call when the answer parses and passes every check', async () => {
    mockJSON.mockResolvedValue(good)
    const r = await completeChecked('p1', 'prompt', schema, copts(() => chk()))
    expect(mockJSON).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ retries: 0, softIssues: [] })
  })

  it('retries once for a soft problem, with the problem in the prompt and at the larger cap, and returns the corrected answer', async () => {
    mockJSON.mockResolvedValueOnce(good).mockResolvedValueOnce({ ...good, extracted: { ok: true as const, value: { a: 'fixed' } } })
    let n = 0
    const r = await completeChecked('p1', 'prompt', schema, copts(() => (n++ === 0 ? chk([], ['figure 45% is not in the evidence']) : chk())))
    expect(mockJSON).toHaveBeenCalledTimes(2)
    expect(mockJSON.mock.calls[1][1]).toContain('figure 45% is not in the evidence')
    expect(mockJSON.mock.calls[1][3]).toMatchObject({ maxOutputTokens: 3_000 })
    expect(r.value).toEqual({ a: 'fixed' })
    expect(r.softIssues).toEqual([])
  })

  it('accepts after the retry when the soft problem remains, and returns it: never a third call', async () => {
    mockJSON.mockResolvedValue(good)
    const r = await completeChecked('p1', 'prompt', schema, copts(() => chk([], ['still too long'])))
    expect(mockJSON).toHaveBeenCalledTimes(2)
    expect(r.softIssues).toEqual(['still too long'])
  })

  it('throws invalid_output when a hard problem remains after the retry', async () => {
    mockJSON.mockResolvedValue(good)
    await expect(completeChecked('p1', 'prompt', schema, copts(() => chk(['the block is not closed'])))).rejects.toMatchObject({ kind: 'invalid_output' })
    expect(mockJSON).toHaveBeenCalledTimes(2)
  })

  it('shares ONE retry between a parse failure and the checks', async () => {
    mockJSON.mockResolvedValueOnce(bad('stop')).mockResolvedValueOnce(good)
    const r = await completeChecked('p1', 'prompt', schema, copts(() => chk([], ['x'])))
    expect(mockJSON).toHaveBeenCalledTimes(2)
    expect(r.softIssues).toEqual(['x'])
    expect(mockJSON.mock.calls[1][1]).toContain('rejected')
  })

  it('falls back to a first answer with only soft problems when the retry does not parse', async () => {
    mockJSON.mockResolvedValueOnce(good).mockResolvedValueOnce(bad('stop'))
    const r = await completeChecked('p1', 'prompt', schema, copts(() => chk([], ['soft'])))
    expect(r.value).toEqual({ a: 'x' })
    expect(r.softIssues).toEqual(['soft'])
  })

  it('skips the retry when there is no time left, and accepts a soft-only answer', async () => {
    mockJSON.mockResolvedValue(good)
    const r = await completeChecked('p1', 'prompt', schema, copts(() => chk([], ['soft']), { deadline: Date.now() + 1_000 }))
    expect(mockJSON).toHaveBeenCalledTimes(1)
    expect(r.softIssues).toEqual(['soft'])
  })

  it('never lets completeJSON run a second call of its own', async () => {
    mockJSON.mockResolvedValue(good)
    await completeChecked('p1', 'prompt', schema, copts(() => chk([], ['soft'])))
    for (const c of mockJSON.mock.calls) expect(c[3]).toMatchObject({ minRetryMs: Number.POSITIVE_INFINITY })
  })
})
