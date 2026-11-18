import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/llm/complete-json', () => ({ completeJSON: vi.fn() }))

import { z } from 'zod'
import { LLMError } from '@/modules/llm/errors'
import { completeJSON } from '@/modules/llm/complete-json'
import { addUsage, CutOffError, completeChecked, completeValidated, NO_USAGE, softIssueNotes, usageOf, usageOfError } from './call'
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
  it('are brief 4000/8000, select 8000/16000, the skills and profile writers 1500/3000 (the experience writer scales: experienceTokenCaps)', () => {
    expect(MAX_OUTPUT_TOKENS).toEqual({
      brief: 4_000, briefRetry: 8_000, select: 8_000, selectRetry: 16_000,
      writeSkills: 1_500, writeSkillsRetry: 3_000, writeProfile: 1_500, writeProfileRetry: 3_000,
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

describe('retry reasons (why a retry happened)', () => {
  it('completeValidated records why: rejected fields, or cut off', async () => {
    mockJSON.mockResolvedValueOnce(bad('stop')).mockResolvedValueOnce(good)
    const rejected = await completeValidated('p1', 'prompt', schema, opts())
    expect(rejected.retryReasons).toEqual([expect.stringMatching(/the answer was rejected: /)])
    mockJSON.mockResolvedValueOnce(bad('length')).mockResolvedValueOnce(good)
    const cut = await completeValidated('p1', 'prompt', schema, opts())
    expect(cut.retryReasons).toEqual(['the answer was cut off'])
  })

  it('completeValidated records none when there was no retry', async () => {
    mockJSON.mockResolvedValue(good)
    expect((await completeValidated('p1', 'prompt', schema, opts())).retryReasons).toEqual([])
  })

  it('completeChecked records the short reasons of the problems that triggered the retry', async () => {
    mockJSON.mockResolvedValue(good)
    let n = 0
    const r = await completeChecked('p1', 'prompt', schema, {
      ...opts({ maxOutputTokens: 1_500, retryMaxOutputTokens: 3_000, label: 'experience section' }),
      check: () => (n++ === 0 ? { hard: [], soft: ['these figures are not in the evidence: 14k', 'bullet 2 contains first person'], why: ['figure 14k not in evidence', 'first person'] } : { hard: [], soft: [] }),
    })
    expect(r.retries).toBe(1)
    expect(r.retryReasons).toEqual(['figure 14k not in evidence', 'first person'])
  })

  it('completeChecked falls back to the problem sentences (shortened to one line) when a check gives no short reasons', async () => {
    mockJSON.mockResolvedValue(good)
    let n = 0
    const long = `too long ${'x'.repeat(300)}`
    const r = await completeChecked('p1', 'prompt', schema, {
      ...opts({ maxOutputTokens: 1_500, retryMaxOutputTokens: 3_000, label: 'experience section' }),
      check: () => (n++ === 0 ? { hard: [], soft: [long] } : { hard: [], soft: [] }),
    })
    expect(r.retryReasons).toHaveLength(1)
    expect(r.retryReasons[0].length).toBeLessThanOrEqual(140)
    expect(r.retryReasons[0]).toMatch(/^too long/)
  })

  it('completeChecked records an unusable first answer as a reason, and none without a retry', async () => {
    mockJSON.mockResolvedValueOnce(bad('stop')).mockResolvedValueOnce(good)
    const r = await completeChecked('p1', 'prompt', schema, { ...opts({ maxOutputTokens: 1_500, retryMaxOutputTokens: 3_000, label: 'x' }), check: () => ({ hard: [], soft: [] }) })
    expect(r.retryReasons).toEqual([expect.stringMatching(/rejected/)])
    mockJSON.mockResolvedValue(good)
    const clean = await completeChecked('p1', 'prompt', schema, { ...opts({ maxOutputTokens: 1_500, retryMaxOutputTokens: 3_000, label: 'x' }), check: () => ({ hard: [], soft: [] }) })
    expect(clean.retryReasons).toEqual([])
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

describe('completeChecked: time for later stages', () => {
  const chk = (hard: string[] = [], soft: string[] = []) => ({ hard, soft })
  const copts = (check: (v: { a: string }) => { hard: string[]; soft: string[] }, over: Record<string, unknown> = {}) => ({
    ...opts({ maxOutputTokens: 1_500, retryMaxOutputTokens: 3_000, label: 'experience section' }), check, ...over,
  })
  const withSlowFirstCall = (firstMs: number, replies: unknown[]) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    let n = 0
    mockJSON.mockImplementation((async () => {
      const reply = replies[Math.min(n, replies.length - 1)]
      if (n++ === 0) vi.setSystemTime(Date.now() + firstMs)
      return reply
    }) as never)
  }
  afterEach(() => vi.useRealTimers())

  it('skips the retry for a SOFT problem when the time left is under twice the first call, and says so', async () => {
    withSlowFirstCall(20_000, [good])
    // 45 s allowed, 20 s used: 25 s left, under 2 x 20 s.
    const r = await completeChecked('p1', 'prompt', schema, copts(() => chk([], ['figure 45%']), { deadline: Date.now() + 45_000 }))
    expect(mockJSON).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ softIssues: ['figure 45%'], retrySkipped: true, retries: 0 })
    expect(softIssueNotes(r)[0]).toMatch(/not enough time for a retry/)
  })

  it('still retries a soft problem when there is plenty of time', async () => {
    withSlowFirstCall(5_000, [good])
    let n = 0
    await completeChecked('p1', 'prompt', schema, copts(() => (n++ === 0 ? chk([], ['figure 45%']) : chk()), { deadline: Date.now() + 45_000 }))
    expect(mockJSON).toHaveBeenCalledTimes(2)
  })

  it('still retries a HARD failure when time is short (the answer is unusable without it)', async () => {
    withSlowFirstCall(20_000, [bad('stop'), good])
    const r = await completeChecked('p1', 'prompt', schema, copts(() => chk(), { deadline: Date.now() + 45_000 }))
    expect(mockJSON).toHaveBeenCalledTimes(2)
    expect(r.value).toEqual({ a: 'x' })
  })
})

describe('usage on failure (tokens of the calls that did answer)', () => {
  const usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: null, cacheWriteTokens: null }
  const answered = (over: object = {}) => ({ ...good, provider: 'anthropic', model: 'claude-sonnet-5-5', usage, ...over })

  it('completeChecked: a hard failure after two answered calls carries their usage', async () => {
    mockJSON.mockResolvedValue(answered())
    const err = await completeChecked('p1', 'prompt', schema, {
      ...opts({ maxOutputTokens: 1_500, retryMaxOutputTokens: 3_000, label: 'x' }), check: () => ({ hard: ['bad'], soft: [] }),
    }).catch((e) => e)
    expect(err).toMatchObject({ kind: 'invalid_output' })
    expect(usageOfError(err)).toMatchObject({ input: 200, output: 40, calls: 2 })
  })

  it('completeChecked: a retry that throws after an unusable first answer carries the first answer\'s usage', async () => {
    mockJSON.mockResolvedValueOnce(answered({ ...bad('stop'), provider: 'anthropic', usage })).mockRejectedValueOnce(new LLMError('down', 'timeout'))
    const err = await completeChecked('p1', 'prompt', schema, {
      ...opts({ maxOutputTokens: 1_500, retryMaxOutputTokens: 3_000, label: 'x' }), check: () => ({ hard: [], soft: [] }),
    }).catch((e) => e)
    expect(err).toMatchObject({ kind: 'timeout' })
    expect(usageOfError(err)).toMatchObject({ input: 100, output: 20, calls: 1 })
  })

  it('completeValidated: the same, for a final invalid_output', async () => {
    mockJSON.mockResolvedValue(answered({ ...bad('stop'), provider: 'anthropic', usage }))
    const err = await completeValidated('p1', 'prompt', schema, opts()).catch((e) => e)
    expect(usageOfError(err)).toMatchObject({ input: 200, output: 40, calls: 2 })
  })

  it('has no usage to report for an error that came from nowhere', () => {
    expect(usageOfError(new Error('x'))).toEqual(NO_USAGE)
    expect(usageOfError(null)).toEqual(NO_USAGE)
  })
})

describe('a cut-off first answer does not spend the retry on the same budget (Phase 3c)', () => {
  const sameCap = { maxOutputTokens: 4_000, retryMaxOutputTokens: 4_000 }
  const chk = () => ({ hard: [], soft: [] })
  const checkedOpts = (over: Record<string, unknown> = {}) => ({ ...opts({ label: 'experience section', ...over }), check: chk })

  it('completeChecked: a cut-off at the largest budget throws CutOffError after ONE call, carrying its usage', async () => {
    mockJSON.mockResolvedValue({ ...bad('length'), usage: { inputTokens: 900, outputTokens: 4_000, cacheReadTokens: null, cacheWriteTokens: null }, provider: 'anthropic' })
    const err = await completeChecked('p1', 'prompt', schema, checkedOpts(sameCap)).catch((e) => e)
    expect(mockJSON).toHaveBeenCalledTimes(1)
    expect(err).toBeInstanceOf(CutOffError)
    expect(err).toMatchObject({ kind: 'invalid_output', tokens: 4_000 })
    expect(err.message).toMatch(/cut off at 4000 output tokens/)
    expect(usageOfError(err)).toMatchObject({ input: 900, output: 4_000, calls: 1 })
  })

  it('completeChecked: a cut-off with a LARGER retry cap is retried once, at that cap', async () => {
    mockJSON.mockResolvedValueOnce(bad('length')).mockResolvedValueOnce(good)
    const r = await completeChecked('p1', 'prompt', schema, checkedOpts({ maxOutputTokens: 2_000, retryMaxOutputTokens: 4_000 }))
    expect(mockJSON).toHaveBeenCalledTimes(2)
    expect(mockJSON.mock.calls[0][3]).toMatchObject({ maxOutputTokens: 2_000 })
    expect(mockJSON.mock.calls[1][3]).toMatchObject({ maxOutputTokens: 4_000 })
    expect(r.retryReasons).toEqual(['the answer was cut off'])
  })

  it('completeChecked: a bad answer that was NOT cut off still retries at the same cap (that is a different problem)', async () => {
    mockJSON.mockResolvedValueOnce(bad('stop')).mockResolvedValueOnce(good)
    await completeChecked('p1', 'prompt', schema, checkedOpts(sameCap))
    expect(mockJSON).toHaveBeenCalledTimes(2)
  })

  it('completeValidated: the same rule', async () => {
    mockJSON.mockResolvedValue(bad('length'))
    await expect(completeValidated('p1', 'prompt', schema, opts(sameCap))).rejects.toBeInstanceOf(CutOffError)
    expect(mockJSON).toHaveBeenCalledTimes(1)
  })
})
