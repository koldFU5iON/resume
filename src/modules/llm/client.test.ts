import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    userSettings: { findUnique: vi.fn() },
    llmUsageLog: { create: vi.fn().mockResolvedValue({}) },
  },
}))

vi.mock('@/lib/encryption', () => ({ decrypt: vi.fn().mockReturnValue('sk-test') }))

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    generateText: vi.fn().mockResolvedValue({
      text: 'hello',
      finishReason: 'stop',
      output: { name: 'Test' },
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    }),
    Output: { object: vi.fn().mockReturnValue({}) },
  }
})

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn().mockReturnValue(() => 'mock-model'),
}))
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn().mockReturnValue(() => 'mock-model'),
}))
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn().mockReturnValue(() => 'mock-model'),
}))

vi.mock('next/server', () => ({ after: vi.fn(cb => cb()) }))

import { complete, completeStructured, resolveFastModel, FAST_MODELS } from './client'
import { prisma } from '@/lib/db'
import { generateText, NoObjectGeneratedError } from 'ai'
import type { LanguageModelResponseMetadata, LanguageModelUsage } from 'ai'
import * as z from 'zod'

const mockFindUnique = vi.mocked(prisma.userSettings.findUnique)
const mockLogCreate = vi.mocked(prisma.llmUsageLog.create)
const mockGenerateText = vi.mocked(generateText)

const usage = {
  inputTokens: 1,
  outputTokens: 2,
  totalTokens: 3,
  inputTokenDetails: {
    noCacheTokens: undefined,
    cacheReadTokens: undefined,
    cacheWriteTokens: undefined,
  },
  outputTokenDetails: {
    textTokens: undefined,
    reasoningTokens: undefined,
  },
} satisfies LanguageModelUsage

const response = {
  id: 'response-1',
  timestamp: new Date(0),
  modelId: 'mock-model',
} satisfies LanguageModelResponseMetadata

const fakeSettings = {
  llmProvider: 'anthropic',
  llmModel: 'claude-sonnet-4-6',
  llmApiKey: 'enc-key',
}

describe('LLM client logging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindUnique.mockResolvedValue(fakeSettings as never)
    mockLogCreate.mockResolvedValue({} as never)
  })

  it('calls llmUsageLog.create after a successful complete()', async () => {
    await complete('profile-1', 'hello', { feature: 'test' })
    await vi.waitFor(() => expect(mockLogCreate).toHaveBeenCalled())
    expect(mockLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          profileId: 'profile-1',
          provider: 'anthropic',
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          feature: 'test',
        }),
      }),
    )
  })

  it('passes feature label through to the log', async () => {
    await complete('profile-1', 'hello', { feature: 'job-fit' })
    await vi.waitFor(() => expect(mockLogCreate).toHaveBeenCalled())
    expect(mockLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ feature: 'job-fit' }),
      }),
    )
  })

  it('calls llmUsageLog.create after completeStructured()', async () => {
    const schema = z.object({ name: z.string() })
    await completeStructured('profile-1', 'hello', schema, { feature: 'cv-import' })
    await vi.waitFor(() => expect(mockLogCreate).toHaveBeenCalled())
    expect(mockLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ feature: 'cv-import', totalTokens: 30 }),
      }),
    )
  })

  it('does not throw if log write fails', async () => {
    mockLogCreate.mockRejectedValueOnce(new Error('DB down'))
    await expect(complete('profile-1', 'hello', { feature: 'test' })).resolves.not.toThrow()
  })

  it('omits unsupported sampling parameters for Claude v5 models', async () => {
    mockFindUnique.mockResolvedValueOnce({
      ...fakeSettings,
      llmModel: 'claude-sonnet-5',
    } as never)

    await complete('profile-1', 'hello', { feature: 'test', temperature: 0.2 })

    expect(mockGenerateText.mock.calls[0][0]).not.toHaveProperty('temperature')
  })

  it('keeps sampling parameters for supported models', async () => {
    await complete('profile-1', 'hello', { feature: 'test', temperature: 0.2 })

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.2 }),
    )
  })

  it('recovers fenced JSON when the SDK cannot parse the output', async () => {
    const schema = z.object({ name: z.string() })
    mockGenerateText.mockRejectedValueOnce(
      new NoObjectGeneratedError({
        message: 'No object generated: could not parse the response.',
        cause: new Error('JSON parsing failed'),
        text: '```json\n{"name":"devon"}\n```',
        response,
        usage,
        finishReason: 'stop',
      }),
    )

    const res = await completeStructured('profile-1', 'hello', schema, { feature: 'cv-import' })
    expect(res.object).toEqual({ name: 'devon' })
    await vi.waitFor(() => expect(mockLogCreate).toHaveBeenCalled())
    expect(mockLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ feature: 'cv-import', totalTokens: 3 }),
      }),
    )
  })

  it('normalizes to LLMError when recovery is impossible', async () => {
    const schema = z.object({ name: z.string() })
    mockGenerateText.mockRejectedValueOnce(
      new NoObjectGeneratedError({
        message: 'No object generated: could not parse the response.',
        cause: new Error('JSON parsing failed'),
        text: 'I cannot do that.',
        response,
        usage,
        finishReason: 'stop',
      }),
    )

    await expect(
      completeStructured('profile-1', 'hello', schema, { feature: 'cv-import' }),
    ).rejects.toThrow('LLM output did not match the expected schema.')
  })
})

describe('resolveFastModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const settings = (over: Record<string, unknown>) =>
    mockFindUnique.mockResolvedValueOnce({ ...fakeSettings, availableModels: null, ...over } as never)

  it('returns the provider fast model when no model list is cached', async () => {
    settings({})
    await expect(resolveFastModel('profile-1')).resolves.toBe(FAST_MODELS.anthropic)
  })

  it('returns the fast model when the cached list contains it', async () => {
    settings({ availableModels: [{ id: 'claude-sonnet-4-6', name: 'S' }, { id: 'claude-haiku-5-5', name: 'H' }] })
    await expect(resolveFastModel('profile-1')).resolves.toBe('claude-haiku-5-5')
  })

  it('prefers a dated snapshot of the fast model from the cached list', async () => {
    settings({ availableModels: [{ id: 'claude-haiku-5-5-20261001', name: 'H' }] })
    await expect(resolveFastModel('profile-1')).resolves.toBe('claude-haiku-5-5-20261001')
  })

  it('falls back to the default model when the cached list lacks the fast model', async () => {
    settings({ availableModels: [{ id: 'claude-sonnet-4-6', name: 'S' }] })
    await expect(resolveFastModel('profile-1')).resolves.toBe('claude-sonnet-4-6')
  })

  it('falls back to the default model when the provider has no fast model', async () => {
    settings({ llmProvider: 'openai', llmModel: 'gpt-5' })
    await expect(resolveFastModel('profile-1')).resolves.toBe(FAST_MODELS.openai ?? 'gpt-5')
  })

  it('throws not_configured when the user has no key', async () => {
    mockFindUnique.mockResolvedValueOnce(null as never)
    await expect(resolveFastModel('profile-1')).rejects.toMatchObject({ kind: 'not_configured' })
  })
})
