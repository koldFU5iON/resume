import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/llm/complete-json', () => ({ completeJSON: vi.fn() }))

import { z } from 'zod'
import { completeJSON } from '@/modules/llm/complete-json'
import { completeValidated } from './call'
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
  it('are brief 4000/8000 and select 8000/16000', () => {
    expect(MAX_OUTPUT_TOKENS).toEqual({ brief: 4_000, briefRetry: 8_000, select: 8_000, selectRetry: 16_000 })
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
