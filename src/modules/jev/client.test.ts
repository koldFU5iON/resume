import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockSystemOne, MockClient, clientConfigs } = vi.hoisted(() => {
  const mockSystemOne = vi.fn()
  // Survives vi.clearAllMocks(): the SDK client is a lazy singleton, built once per file.
  const clientConfigs: unknown[] = []
  const MockClient = vi.fn(function (this: { systemOne: typeof mockSystemOne }, config: unknown) {
    clientConfigs.push(config)
    this.systemOne = mockSystemOne
  })
  return { mockSystemOne, MockClient, clientConfigs }
})

vi.mock('@typesafe-ai/sdk', async () => {
  const actual = await vi.importActual<typeof import('@typesafe-ai/sdk')>('@typesafe-ai/sdk')
  return { ...actual, TypeSafeClient: MockClient }
})

vi.mock('@/lib/db', () => ({
  prisma: {
    llmUsageLog: { count: vi.fn(), create: vi.fn() },
  },
}))

vi.mock('next/server', () => ({ after: vi.fn(cb => cb()) }))

import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  TypeSafeError,
  noul,
} from '@typesafe-ai/sdk'
import { prisma } from '@/lib/db'
import { askJev, isJevConfigured, JevError, JEV_MODEL, normalizeJevError } from './client'

const mockCount = vi.mocked(prisma.llmUsageLog.count)
const mockCreate = vi.mocked(prisma.llmUsageLog.create)

const questions = { is_full_description: noul('`description` is a complete job posting.') }
const state = { description: 'We are hiring a product manager…' }

const okResult = {
  model: 'jev-1.14.0',
  answers: { is_full_description: { type: 'noul', noul: 0.9 } },
  usage: { input_tokens: 120, output_tokens: 3 },
}

const apiError = (status: number, body: unknown = { detail: 'x' }) =>
  APIError.fromResponse(status, body, new Headers())

describe('isJevConfigured', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is false when the key is unset or blank', () => {
    vi.stubEnv('TYPESAFE_API_KEY', '')
    expect(isJevConfigured()).toBe(false)
    vi.stubEnv('TYPESAFE_API_KEY', '   ')
    expect(isJevConfigured()).toBe(false)
  })

  it('is true when the key is set', () => {
    vi.stubEnv('TYPESAFE_API_KEY', 'ts-test')
    expect(isJevConfigured()).toBe(true)
  })
})

describe('askJev', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('TYPESAFE_API_KEY', 'ts-test')
    mockCount.mockResolvedValue(0 as never)
    mockCreate.mockResolvedValue({} as never)
    mockSystemOne.mockResolvedValue(okResult)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('throws not_configured without calling the API', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '')
    await expect(askJev('p1', { state, questions }, { feature: 'test' }))
      .rejects.toMatchObject({ name: 'JevError', kind: 'not_configured' })
    expect(mockSystemOne).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('throws daily_cap at the limit without calling the API', async () => {
    vi.stubEnv('JEV_DAILY_CALL_LIMIT', '5')
    mockCount.mockResolvedValueOnce(5 as never)
    await expect(askJev('p1', { state, questions }, { feature: 'test' }))
      .rejects.toMatchObject({ kind: 'daily_cap' })
    expect(mockSystemOne).not.toHaveBeenCalled()
    expect(mockCount).toHaveBeenCalledWith({
      where: { profileId: 'p1', provider: 'typesafe', createdAt: { gte: expect.any(Date) } },
    })
  })

  it('counts calls from local midnight today', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 10, 15, 42, 7))
    try {
      await askJev('p1', { state, questions }, { feature: 'test' })
      const since = mockCount.mock.calls[0][0]!.where!.createdAt as { gte: Date }
      expect(since.gte).toEqual(new Date(2026, 10, 10, 0, 0, 0, 0))
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['', '   ', 'abc', '0', '-5', '2.5'])(
    'falls back to the default cap of 300 when JEV_DAILY_CALL_LIMIT is %j',
    async (value) => {
      vi.stubEnv('JEV_DAILY_CALL_LIMIT', value)
      mockCount.mockResolvedValueOnce(299 as never)
      await expect(askJev('p1', { state, questions }, { feature: 'test' })).resolves.toBeDefined()
      mockCount.mockResolvedValueOnce(300 as never)
      await expect(askJev('p1', { state, questions }, { feature: 'test' }))
        .rejects.toMatchObject({ kind: 'daily_cap' })
    },
  )

  it('defaults the daily cap to 300', async () => {
    mockCount.mockResolvedValueOnce(299 as never)
    await expect(askJev('p1', { state, questions }, { feature: 'test' })).resolves.toBeDefined()
    mockCount.mockResolvedValueOnce(300 as never)
    await expect(askJev('p1', { state, questions }, { feature: 'test' }))
      .rejects.toMatchObject({ kind: 'daily_cap' })
  })

  it('sends the pinned model and returns answers, usage and the exact request', async () => {
    const res = await askJev('p1', { state, questions }, { feature: 'job-assessment-verify' })

    expect(clientConfigs).toEqual([
      expect.objectContaining({ apiKey: 'ts-test', defaultModel: JEV_MODEL, logLevel: 'warn' }),
    ])
    expect(mockSystemOne).toHaveBeenCalledWith({ model: JEV_MODEL, state, questions })
    expect(res.answers.is_full_description.noul).toBeTypeOf('number')
    expect(res.model).toBe('jev-1.14.0')
    expect(res.usage).toEqual({ inputTokens: 120, outputTokens: 3 })
    expect(res.latencyMs).toBeGreaterThanOrEqual(0)
    expect(res.request).toEqual({ model: JEV_MODEL, state, questions })
  })

  it('writes one usage row with provider typesafe and no request content', async () => {
    await askJev('p1', { state, questions }, { feature: 'job-assessment-judge' })

    expect(mockCreate).toHaveBeenCalledTimes(1)
    const { data } = mockCreate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(data).toEqual({
      profileId: 'p1',
      provider: 'typesafe',
      model: 'jev-1.14.0',
      feature: 'job-assessment-judge',
      promptTokens: 120,
      completionTokens: 3,
      totalTokens: 123,
      latencyMs: expect.any(Number),
    })
  })

  it('treats null token counts as zero', async () => {
    mockSystemOne.mockResolvedValueOnce({ ...okResult, usage: { input_tokens: null, output_tokens: null } })
    const res = await askJev('p1', { state, questions }, { feature: 'test' })
    expect(res.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
  })

  it('still returns the answer when the usage write fails', async () => {
    mockCreate.mockRejectedValueOnce(new Error('DB down'))
    await expect(askJev('p1', { state, questions }, { feature: 'test' })).resolves.toBeDefined()
  })

  it('throws JevError and writes no usage row when the call fails', async () => {
    mockSystemOne.mockRejectedValueOnce(apiError(529))
    await expect(askJev('p1', { state, questions }, { feature: 'test' }))
      .rejects.toBeInstanceOf(JevError)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it.each([
    ['401', () => apiError(401), 'auth'],
    ['403', () => apiError(403), 'auth'],
    ['429', () => apiError(429), 'rate_limited'],
    ['529', () => apiError(529), 'overloaded'],
    ['400 max_tokens_exceeded', () => apiError(400, { detail: { type: 'max_tokens_exceeded' } }), 'context_exceeded'],
    ['400 max_tokens_exceeded (string detail)', () => apiError(400, { detail: 'max_tokens_exceeded: too long' }), 'context_exceeded'],
    ['413', () => apiError(413), 'context_exceeded'],
    ['400 other', () => apiError(400, { detail: 'invalid UTF-8' }), 'invalid_request'],
    ['422', () => apiError(422, { detail: [{ type: 'missing', loc: ['body', 'state'] }] }), 'invalid_request'],
    ['408', () => apiError(408), 'unavailable'],
    ['500', () => apiError(500), 'unavailable'],
    ['503', () => apiError(503), 'unavailable'],
    ['connection', () => new APIConnectionError(), 'unavailable'],
    ['timeout', () => new APITimeoutError(10_000), 'unavailable'],
    ['SDK pre-send validation', () => new TypeSafeError('questions are empty'), 'invalid_request'],
    ['unknown', () => new Error('boom'), 'unavailable'],
  ] as const)('maps %s to %s', async (_label, makeError, kind) => {
    const err = makeError()
    mockSystemOne.mockRejectedValueOnce(err)
    const rejection = await askJev('p1', { state, questions }, { feature: 'test' }).catch(e => e)
    expect(rejection).toBeInstanceOf(JevError)
    expect(rejection.kind).toBe(kind)
    expect(rejection.cause).toBe(err)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('keeps status and request id on API errors', () => {
    const err = APIError.fromResponse(429, { detail: 'slow down' }, new Headers({ 'x-typesafe-request-id': 'req-1' }))
    expect(normalizeJevError(err)).toMatchObject({ kind: 'rate_limited', status: 429, requestId: 'req-1' })
  })
})
