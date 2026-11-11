import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    userSettings: { findUnique: vi.fn() },
    llmUsageLog: { create: vi.fn() },
    jobApplication: { findFirst: vi.fn() },
    cVDocument: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/encryption', () => ({ decrypt: vi.fn().mockReturnValue('sk-test') }))
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return { ...actual, generateText: vi.fn(), Output: { object: vi.fn().mockReturnValue({}) } }
})
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: vi.fn().mockReturnValue(() => 'mock-model') }))
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: vi.fn().mockReturnValue(() => 'mock-model') }))
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: vi.fn().mockReturnValue(() => 'mock-model') }))
vi.mock('next/server', () => ({ after: vi.fn((cb: () => unknown) => cb()) }))

import { APICallError, generateText, NoObjectGeneratedError } from 'ai'
import type { LanguageModelResponseMetadata } from 'ai'
import * as z from 'zod'
import { prisma } from '@/lib/db'
import { complete, completeStructured, countServerToolCalls, usageColumns } from './client'
import { completeJSON } from './complete-json'

const mockGenerate = vi.mocked(generateText)
const mockCreate = vi.mocked(prisma.llmUsageLog.create)
const owned = { jobs: new Set(['job-a', 'job-b']), cvs: new Map([['cv-a1', 'job-a'], ['cv-a2', 'job-a'], ['cv-b1', 'job-b']]) }

const textResult = (text = '{}', extra: Record<string, unknown> = {}) => ({
  text,
  finishReason: 'stop',
  output: { name: 'x' },
  usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, inputTokenDetails: { cacheReadTokens: 60, cacheWriteTokens: 10 } },
  ...extra,
})

const rows = () => mockCreate.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(prisma.userSettings.findUnique).mockResolvedValue({ llmProvider: 'anthropic', llmModel: 'claude-sonnet-5-5', llmApiKey: 'enc' } as never)
  mockCreate.mockResolvedValue({} as never)
  vi.mocked(prisma.jobApplication.findFirst).mockImplementation((async ({ where }: { where: { id: string; profileId: string } }) =>
    where.profileId === 'p1' && owned.jobs.has(where.id) ? { id: where.id } : null) as never)
  vi.mocked(prisma.cVDocument.findFirst).mockImplementation((async ({ where }: { where: { id: string; profileId: string } }) =>
    where.profileId === 'p1' && owned.cvs.has(where.id) ? { jobApplicationId: owned.cvs.get(where.id) } : null) as never)
  mockGenerate.mockResolvedValue(textResult() as never)
})

describe('usage attribution in the BYOK client', () => {
  it('records job, CV, run, cache tokens and server tool calls on the row', async () => {
    mockGenerate.mockResolvedValueOnce(textResult('ok', {
      steps: [
        { content: [{ type: 'tool-call', providerExecuted: true }, { type: 'text' }] },
        { content: [{ type: 'tool-call', providerExecuted: true }, { type: 'tool-call' }] },
      ],
    }) as never)
    await complete('p1', 'hi', { feature: 'cv-generate', attribution: { jobApplicationId: 'job-a', cvDocumentId: 'cv-a1', runId: 'run-1' } })
    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(rows()[0]).toMatchObject({
      profileId: 'p1', feature: 'cv-generate',
      promptTokens: 100, completionTokens: 20, totalTokens: 120,
      cacheReadTokens: 60, cacheWriteTokens: 10, serverToolCalls: 2, usageKnown: true,
      jobApplicationId: 'job-a', cvDocumentId: 'cv-a1', runId: 'run-1',
    })
  })

  it('leaves profile-only calls unattributed', async () => {
    await complete('p1', 'hi', { feature: 'profile-summary' })
    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(rows()[0]).toMatchObject({ jobApplicationId: null, cvDocumentId: null, runId: null })
    expect(prisma.jobApplication.findFirst).not.toHaveBeenCalled()
  })

  it("never writes another profile's job, or a CV from a different job", async () => {
    await complete('p2', 'hi', { feature: 'job-fit', attribution: { jobApplicationId: 'job-a' } })
    await complete('p1', 'hi', { feature: 'cv-generate', attribution: { jobApplicationId: 'job-b', cvDocumentId: 'cv-a1' } })
    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2))
    expect(rows()[0]).toMatchObject({ profileId: 'p2', jobApplicationId: null, cvDocumentId: null })
    expect(rows()[1]).toMatchObject({ jobApplicationId: 'job-b', cvDocumentId: null })
  })

  it('keeps concurrent calls for different jobs apart', async () => {
    mockGenerate.mockImplementation((async () => {
      await new Promise((r) => setTimeout(r, Math.random() * 5))
      return textResult()
    }) as never)
    await Promise.all([
      completeStructured('p1', 'a', z.object({ name: z.string() }), { feature: 'job-fit', attribution: { jobApplicationId: 'job-a' } }),
      completeStructured('p1', 'b', z.object({ name: z.string() }), { feature: 'job-fit', attribution: { jobApplicationId: 'job-b' } }),
      complete('p1', 'c', { feature: 'cv-generate', attribution: { cvDocumentId: 'cv-b1', runId: 'run-b' } }),
      complete('p1', 'd', { feature: 'profile-summary' }),
    ])
    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(4))
    const byPrompt = new Map(mockGenerate.mock.calls.map((c, i) => [(c[0] as { prompt: string }).prompt, i]))
    expect(byPrompt.size).toBe(4)
    expect(rows()).toEqual(expect.arrayContaining([
      expect.objectContaining({ feature: 'job-fit', jobApplicationId: 'job-a', runId: null }),
      expect.objectContaining({ feature: 'job-fit', jobApplicationId: 'job-b', runId: null }),
      expect.objectContaining({ feature: 'cv-generate', jobApplicationId: 'job-b', cvDocumentId: 'cv-b1', runId: 'run-b' }),
      expect.objectContaining({ feature: 'profile-summary', jobApplicationId: null }),
    ]))
  })

  it('logs each completeJSON attempt once, both with the same attribution', async () => {
    mockGenerate
      .mockResolvedValueOnce(textResult('```json\n{"name": "trunc', { finishReason: 'length' }) as never)
      .mockResolvedValueOnce(textResult('{"name": "ok"}') as never)
    const attribution = { jobApplicationId: 'job-a', cvDocumentId: 'cv-a2', runId: 'run-2' }
    const res = await completeJSON('p1', 'p', z.object({ name: z.string() }), { feature: 'cv-generate', attribution })
    expect(res.extracted.ok).toBe(true)
    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2))
    for (const row of rows()) expect(row).toMatchObject(attribution)
  })

  it('marks recovered structured output with no usage as unknown, not a measured zero', async () => {
    mockGenerate.mockRejectedValueOnce(new NoObjectGeneratedError({
      message: 'no object', text: '```json\n{"name":"ok"}\n```',
      response: { id: 'r', timestamp: new Date(0), modelId: 'm' } satisfies LanguageModelResponseMetadata,
      usage: undefined as never, finishReason: 'stop',
    }))
    await completeStructured('p1', 'x', z.object({ name: z.string() }), { feature: 'job-fit', attribution: { jobApplicationId: 'job-a' } })
    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(rows()[0]).toMatchObject({ usageKnown: false, promptTokens: 0, serverToolCalls: null, jobApplicationId: 'job-a' })
  })
})

describe('failed calls', () => {
  it('logs a failed provider call as an error row with its kind, keeps attribution, and rethrows', async () => {
    mockGenerate.mockRejectedValueOnce(new APICallError({
      message: 'rate limited', url: 'https://x', requestBodyValues: {}, statusCode: 429,
    }))
    await expect(complete('p1', 'hi', { feature: 'cv-generate', attribution: { cvDocumentId: 'cv-a1', runId: 'run-9' } }))
      .rejects.toMatchObject({ name: 'LLMError', kind: 'rate_limit' })
    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(rows()[0]).toMatchObject({
      status: 'error', errorKind: 'rate_limit', usageKnown: false,
      promptTokens: 0, completionTokens: 0, serverToolCalls: null,
      feature: 'cv-generate', jobApplicationId: 'job-a', cvDocumentId: 'cv-a1', runId: 'run-9',
    })
  })

  it('keeps the usage of output that failed validation (it was billed)', async () => {
    mockGenerate.mockRejectedValueOnce(new NoObjectGeneratedError({
      message: 'no object', text: 'not json at all',
      response: { id: 'r', timestamp: new Date(0), modelId: 'm' } satisfies LanguageModelResponseMetadata,
      usage: { inputTokens: 50, outputTokens: 7, totalTokens: 57 } as never, finishReason: 'stop',
    }))
    await expect(completeStructured('p1', 'x', z.object({ name: z.string() }), { feature: 'job-fit', attribution: { jobApplicationId: 'job-b' } }))
      .rejects.toMatchObject({ kind: 'invalid_output' })
    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(rows()[0]).toMatchObject({ status: 'error', errorKind: 'invalid_output', usageKnown: true, promptTokens: 50, completionTokens: 7, jobApplicationId: 'job-b' })
  })

  it('logs successful calls as status ok', async () => {
    await complete('p1', 'hi', { feature: 'job-fit' })
    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(rows()[0]).not.toHaveProperty('status', 'error')
  })
})

describe('usageColumns / countServerToolCalls', () => {
  it('keeps unreported cache tokens null', () => {
    expect(usageColumns({ inputTokens: 5, outputTokens: 1, totalTokens: 6 } as never))
      .toMatchObject({ cacheReadTokens: null, cacheWriteTokens: null, usageKnown: true })
    expect(usageColumns(undefined)).toMatchObject({ usageKnown: false, totalTokens: 0 })
  })

  it('returns null when there is nothing to count, 0 when there is', () => {
    expect(countServerToolCalls({})).toBeNull()
    expect(countServerToolCalls({ content: [{ type: 'text' }] })).toBe(0)
  })
})
