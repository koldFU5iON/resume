import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

vi.mock('@/modules/llm/client', () => ({ complete: vi.fn() }))

import { completeJSON } from './complete-json'
import { complete } from '@/modules/llm/client'

const mockComplete = vi.mocked(complete)

const SCHEMA = z.object({ name: z.string(), count: z.number() })
const FIXTURE = { name: 'devon', count: 3 }

describe('completeJSON', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the parsed object for a clean response', async () => {
    mockComplete.mockResolvedValueOnce({
      text: JSON.stringify(FIXTURE),
      finishReason: 'stop',
    } as never)
    const res = await completeJSON('p', 'prompt', SCHEMA, { feature: 'cv-generate' })
    expect(res.extracted).toEqual({ ok: true, value: FIXTURE })
    expect(res.finishReason).toBe('stop')
    expect(mockComplete).toHaveBeenCalledTimes(1)
  })

  it('retries with a larger budget when the response is truncated mid-JSON', async () => {
    mockComplete
      .mockResolvedValueOnce({
        text: '```json\n{"name":"devon","count":', // unbalanced — cut off
        finishReason: 'length',
      } as never)
      .mockResolvedValueOnce({
        text: `\`\`\`json\n${JSON.stringify(FIXTURE)}\n\`\`\``,
        finishReason: 'stop',
      } as never)

    const res = await completeJSON('p', 'prompt', SCHEMA, { feature: 'cv-generate' })
    expect(res.extracted).toEqual({ ok: true, value: FIXTURE })
    expect(mockComplete).toHaveBeenCalledTimes(2)

    const [, firstPrompt, firstOpts] = mockComplete.mock.calls[0]
    const [, secondPrompt, secondOpts] = mockComplete.mock.calls[1]
    expect(firstOpts.maxOutputTokens).toBe(8000)
    expect(secondOpts.maxOutputTokens).toBe(16000)
    expect(secondPrompt).toContain('cut off')
    expect(secondPrompt).toContain('COMPLETE JSON document')
    expect(firstPrompt).not.toContain('cut off')
  })

  it('reports the failure without retrying when the response was not truncated', async () => {
    mockComplete.mockResolvedValueOnce({
      text: 'I cannot do that.',
      finishReason: 'stop',
    } as never)
    const res = await completeJSON('p', 'prompt', SCHEMA, { feature: 'cv-generate' })
    expect(res.extracted.ok).toBe(false)
    if (!res.extracted.ok) expect(res.extracted.reason).toBe('no_json')
    expect(res.finishReason).toBe('stop')
    expect(res.rawText).toBe('I cannot do that.')
    expect(mockComplete).toHaveBeenCalledTimes(1)
  })

  it('returns the final failure after a retry that also truncates', async () => {
    mockComplete.mockResolvedValueOnce({
      text: '```json\n{"name":"devon"', // unbalanced
      finishReason: 'length',
    } as never)
    mockComplete.mockResolvedValueOnce({
      text: '```json\n{"name":"devon","count":3', // still unbalanced
      finishReason: 'length',
    } as never)
    const res = await completeJSON('p', 'prompt', SCHEMA, { feature: 'cv-generate' })
    expect(res.extracted.ok).toBe(false)
    if (!res.extracted.ok) expect(res.extracted.reason).toBe('no_json')
    expect(res.finishReason).toBe('length')
    expect(mockComplete).toHaveBeenCalledTimes(2)
  })
  it('caps each call at the time left before the deadline, and skips the retry when too little is left', async () => {
    const cut = { text: '```json\n{"name":', finishReason: 'length' } as never
    mockComplete.mockResolvedValueOnce(cut)
    const res = await completeJSON('p', 'prompt', SCHEMA, {
      feature: 'cv-generate', timeoutMs: 120_000, deadline: Date.now() + 20_000,
    })
    expect(mockComplete).toHaveBeenCalledTimes(1)
    expect(mockComplete.mock.calls[0][2].timeoutMs).toBeLessThanOrEqual(20_000)
    expect(res.finishReason).toBe('length')
  })

  it('keeps the per-call timeout when the deadline is further away', async () => {
    mockComplete.mockResolvedValueOnce({ text: JSON.stringify(FIXTURE), finishReason: 'stop' } as never)
    await completeJSON('p', 'prompt', SCHEMA, { feature: 'cv-generate', timeoutMs: 60_000, deadline: Date.now() + 200_000 })
    expect(mockComplete.mock.calls[0][2].timeoutMs).toBe(60_000)
    expect(mockComplete.mock.calls[0][2]).not.toHaveProperty('deadline')
  })
})
