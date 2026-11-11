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

vi.mock('./web-search', async () => {
  const actual = await vi.importActual<typeof import('./web-search')>('./web-search')
  return {
    ...actual,
    // Plain markers instead of real SDK tool objects; the mapping has its own tests.
    webSearchTools: vi.fn((provider: string, opts: unknown) => {
      if (provider === 'mistral') return actual.webSearchTools(provider, opts as never)
      return { [`${provider}_search`]: { opts } }
    }),
  }
})

import { complete, completeStructured } from './client'
import { ROLE_RECOMMENDATIONS } from './roles'
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

  it.each(['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5'])(
    'omits sampling parameters for %s',
    async (model) => {
      mockFindUnique.mockResolvedValueOnce({ ...fakeSettings, llmModel: model } as never)
      await complete('profile-1', 'hello', { feature: 'test', temperature: 0 })
      expect(mockGenerateText.mock.calls.at(-1)![0]).not.toHaveProperty('temperature')
    },
  )

  it('keeps sampling parameters for older Claude models', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...fakeSettings, llmModel: 'claude-haiku-4-5' } as never)
    await complete('profile-1', 'hello', { feature: 'test', temperature: 0.2 })
    expect(mockGenerateText.mock.calls.at(-1)![0]).toHaveProperty('temperature', 0.2)
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

  const invalidOutput = () => new NoObjectGeneratedError({
    message: 'No object generated: response did not match schema.',
    cause: Object.assign(new Error('Type validation failed'), {
      issues: [{ path: ['requirements', 3, 'text'], message: 'Too long', input: 'SECRET JOB TEXT' }],
    }),
    text: 'SECRET JOB TEXT and more',
    response,
    usage,
    finishReason: 'stop',
  })

  it('logs raw output on invalid output by default (other features unchanged)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGenerateText.mockRejectedValueOnce(invalidOutput())
    await expect(completeStructured('profile-1', 'hello', z.object({ n: z.number() }), { feature: 'cv-import' }))
      .rejects.toMatchObject({ kind: 'invalid_output' })
    expect(JSON.stringify(err.mock.calls)).toContain('SECRET JOB TEXT')
    err.mockRestore()
  })

  it('logs only issue paths when redactInvalidOutput is set', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGenerateText.mockRejectedValueOnce(invalidOutput())
    await expect(completeStructured('profile-1', 'hello', z.object({ n: z.number() }), {
      feature: 'job-assessment-facts', redactInvalidOutput: true,
    })).rejects.toMatchObject({ kind: 'invalid_output' })
    const logged = JSON.stringify(err.mock.calls)
    expect(logged).not.toContain('SECRET')
    expect(logged).toContain('requirements.3.text')
    err.mockRestore()
  })

  it('passes an abort signal when timeoutMs is set, and none otherwise', async () => {
    await completeStructured('profile-1', 'hello', z.object({ name: z.string() }), { feature: 'x', timeoutMs: 30_000 })
    expect(mockGenerateText.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal)
    await completeStructured('profile-1', 'hello', z.object({ name: z.string() }), { feature: 'x' })
    expect(mockGenerateText.mock.calls[1][0]).not.toHaveProperty('abortSignal')
  })

  it('maps an elapsed timeout to LLMError kind timeout', async () => {
    mockGenerateText.mockImplementationOnce((async (args: { abortSignal?: AbortSignal }) => {
      await new Promise((r) => setTimeout(r, 20))
      throw args.abortSignal?.reason ?? new Error('aborted')
    }) as never)
    await expect(completeStructured('profile-1', 'hello', z.object({ name: z.string() }), { feature: 'x', timeoutMs: 1 }))
      .rejects.toMatchObject({ name: 'LLMError', kind: 'timeout' })
  })
})

describe('model roles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLogCreate.mockResolvedValue({} as never)
  })

  const settings = (over: Record<string, unknown>) =>
    mockFindUnique.mockResolvedValueOnce({ ...fakeSettings, availableModels: null, llmModelRoles: null, ...over } as never)
  const usedModel = () => (mockGenerateText.mock.calls.at(-1)?.[0] as { model: unknown }).model
  const loggedRow = async () => {
    await vi.waitFor(() => expect(mockLogCreate).toHaveBeenCalled())
    return (mockLogCreate.mock.calls.at(-1)?.[0] as { data: Record<string, unknown> }).data
  }

  it('uses the default model and logs role default when no role is given', async () => {
    settings({})
    const res = await complete('profile-1', 'hi', { feature: 'x' })
    expect(res.model).toBe('claude-sonnet-4-6')
    expect(await loggedRow()).toMatchObject({ role: 'default', model: 'claude-sonnet-4-6' })
  })

  it("uses the user's choice for a role when their key still has it", async () => {
    settings({
      availableModels: [{ id: 'claude-sonnet-4-6', name: 'S' }, { id: 'claude-opus-5-5', name: 'O' }],
      llmModelRoles: { fast: 'claude-opus-5-5' },
    })
    const res = await complete('profile-1', 'hi', { feature: 'x', role: 'fast' })
    expect(res.model).toBe('claude-opus-5-5')
    expect(await loggedRow()).toMatchObject({ role: 'fast', model: 'claude-opus-5-5' })
  })

  it('falls back to the recommendation when the chosen model is gone', async () => {
    settings({
      availableModels: [{ id: 'claude-sonnet-4-6', name: 'S' }, { id: 'claude-haiku-5-5', name: 'H' }],
      llmModelRoles: { fast: 'claude-retired-1' },
    })
    const res = await completeStructured('profile-1', 'hi', z.object({ name: z.string() }), { feature: 'x', role: 'fast' })
    expect(res.model).toBe(ROLE_RECOMMENDATIONS.anthropic.fast)
  })

  it('falls back to the default model when neither choice nor recommendation is available', async () => {
    settings({ availableModels: [{ id: 'claude-sonnet-4-6', name: 'S' }], llmModelRoles: { fast: 'claude-retired-1' } })
    const res = await complete('profile-1', 'hi', { feature: 'x', role: 'fast' })
    expect(res.model).toBe('claude-sonnet-4-6')
  })

  it('uses the default model for a role with no recommendation (openai)', async () => {
    settings({ llmProvider: 'openai', llmModel: 'gpt-5' })
    const res = await complete('profile-1', 'hi', { feature: 'x', role: 'fast' })
    expect(res.model).toBe('gpt-5')
  })

  it('lets an explicit model override the role', async () => {
    settings({ llmModelRoles: { fast: 'claude-opus-5-5' } })
    const res = await complete('profile-1', 'hi', { feature: 'x', role: 'fast', model: 'claude-test-1' })
    expect(res.model).toBe('claude-test-1')
    expect(usedModel()).toBe('mock-model')
  })

  it('logs no role for an explicit model without one', async () => {
    settings({})
    await complete('profile-1', 'hi', { feature: 'x', model: 'claude-test-1' })
    expect(await loggedRow()).toMatchObject({ role: null, model: 'claude-test-1' })
  })

  it('logs the role on a failed call', async () => {
    settings({})
    mockGenerateText.mockRejectedValueOnce(new Error('boom'))
    await expect(complete('profile-1', 'hi', { feature: 'x', role: 'analysis' })).rejects.toMatchObject({ name: 'LLMError' })
    expect(await loggedRow()).toMatchObject({ role: 'analysis', status: 'error' })
  })
})

describe('web search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLogCreate.mockResolvedValue({} as never)
  })

  it('passes the provider search tools and logs server tool calls', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...fakeSettings } as never)
    mockGenerateText.mockResolvedValueOnce({
      text: 'found',
      finishReason: 'stop',
      usage,
      content: [
        { type: 'tool-call', providerExecuted: true },
        { type: 'tool-call', providerExecuted: true },
        { type: 'text' },
      ],
    } as never)
    await complete('profile-1', 'find', { feature: 'x', role: 'research', webSearch: { maxUses: 3, allowedDomains: ['example.com'] } })
    const args = mockGenerateText.mock.calls.at(-1)?.[0] as { tools?: Record<string, unknown> }
    expect(args.tools).toEqual({ anthropic_search: { opts: { maxUses: 3, allowedDomains: ['example.com'] } } })
    await vi.waitFor(() => expect(mockLogCreate).toHaveBeenCalled())
    expect(mockLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'research', serverToolCalls: 2 }) }),
    )
  })

  it('counts Google grounding queries from provider metadata', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...fakeSettings, llmProvider: 'google', llmModel: 'gemini-3.5-flash' } as never)
    mockGenerateText.mockResolvedValueOnce({
      text: 'found',
      finishReason: 'stop',
      usage,
      content: [{ type: 'text' }],
      providerMetadata: { google: { groundingMetadata: { webSearchQueries: ['a', 'b', 'c'] } } },
    } as never)
    await complete('profile-1', 'find', { feature: 'x', webSearch: { maxUses: 3 } })
    await vi.waitFor(() => expect(mockLogCreate).toHaveBeenCalled())
    expect(mockLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ serverToolCalls: 3 }) }),
    )
  })

  it("rejects webSearch on structured output with 'unsupported', before any provider call", async () => {
    await expect(
      completeStructured('profile-1', 'find', z.object({ name: z.string() }), { feature: 'x', webSearch: { maxUses: 2 } }),
    ).rejects.toMatchObject({ name: 'LLMError', kind: 'unsupported' })
    expect(mockFindUnique).not.toHaveBeenCalled()
    expect(mockGenerateText).not.toHaveBeenCalled()
  })

  it('sends no tools without webSearch', async () => {
    mockFindUnique.mockResolvedValueOnce({ ...fakeSettings } as never)
    await complete('profile-1', 'hi', { feature: 'x' })
    const args = mockGenerateText.mock.calls.at(-1)?.[0] as { tools?: unknown }
    expect(args.tools).toBeUndefined()
  })
})
