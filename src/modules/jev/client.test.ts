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

vi.mock('@/lib/db', () => {
  const llmUsageLog = { count: vi.fn(), create: vi.fn(), update: vi.fn() }
  // A fake interactive transaction: the callback gets a tx with the same delegates.
  // Attribution is validated inside the reservation transaction (see llm/attribution.ts).
  const jobApplication = { findFirst: vi.fn() }
  const cVDocument = { findFirst: vi.fn() }
  const tx = { $executeRaw: vi.fn(), llmUsageLog, jobApplication, cVDocument }
  return { prisma: { llmUsageLog, jobApplication, cVDocument, $executeRaw: tx.$executeRaw, $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) } }
})

vi.mock('next/server', () => ({ after: vi.fn(cb => cb()) }))

import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  TypeSafeError,
  noul,
} from '@typesafe-ai/sdk'
import { prisma } from '@/lib/db'
import { askJev, isJevConfigured, jevCallsRemainingToday, JevError, JEV_MODEL, normalizeJevError } from './client'

const mockCount = vi.mocked(prisma.llmUsageLog.count)
const mockCreate = vi.mocked(prisma.llmUsageLog.create)
const mockUpdate = vi.mocked(prisma.llmUsageLog.update)
const mockLock = vi.mocked(prisma.$executeRaw)
const mockTransaction = vi.mocked(prisma.$transaction)

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
    mockCreate.mockResolvedValue({ id: 'res-1' } as never)
    mockUpdate.mockResolvedValue({} as never)
    mockLock.mockResolvedValue(1 as never)
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
    expect(mockCreate).not.toHaveBeenCalled() // no reservation at the cap
  })

  it('reserves under a per-profile advisory lock taken before the count', async () => {
    await askJev('p1', { state, questions }, { feature: 'test' })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    const [sql, ...values] = mockLock.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]]
    expect(sql.join('?')).toBe('SELECT pg_advisory_xact_lock(hashtext(?))')
    expect(values).toEqual(['jev-quota:p1'])
    expect(mockLock.mock.invocationCallOrder[0]).toBeLessThan(mockCount.mock.invocationCallOrder[0])
    expect(mockCount.mock.invocationCallOrder[0]).toBeLessThan(mockCreate.mock.invocationCallOrder[0])
    expect(mockCreate.mock.invocationCallOrder[0]).toBeLessThan(mockSystemOne.mock.invocationCallOrder[0])
  })

  it('maps a failed reservation to unavailable without calling the API', async () => {
    mockTransaction.mockRejectedValueOnce(new Error('pool exhausted'))
    await expect(askJev('p1', { state, questions }, { feature: 'test' }))
      .rejects.toMatchObject({ name: 'JevError', kind: 'unavailable' })
    expect(mockSystemOne).not.toHaveBeenCalled()
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

  it('sends no per-call options by default', async () => {
    await askJev('p1', { state, questions }, { feature: 'test' })
    expect(mockSystemOne.mock.calls[0]).toHaveLength(1)
  })

  it('forwards timeout and retry bounds to the SDK per call', async () => {
    await askJev('p1', { state, questions }, {
      feature: 'test', timeoutMs: 20_000, maxRetries: 1, maxRetryAfterMs: 5_000,
    })
    expect(mockSystemOne).toHaveBeenCalledWith(
      { model: JEV_MODEL, state, questions },
      { timeout: 20_000, retry: { maxRetries: 1, maxRetryAfterMs: 5_000 } },
    )
  })

  it('forwards a timeout alone without a retry override', async () => {
    await askJev('p1', { state, questions }, { feature: 'test', timeoutMs: 5_000 })
    expect(mockSystemOne.mock.calls[0][1]).toEqual({ timeout: 5_000 })
  })

  it('reserves one zero-token typesafe row, then updates it with the real usage', async () => {
    await askJev('p1', { state, questions }, { feature: 'job-assessment-judge' })

    expect(mockCreate).toHaveBeenCalledTimes(1)
    const { data } = mockCreate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(data).toEqual({
      profileId: 'p1',
      provider: 'typesafe',
      model: JEV_MODEL,
      feature: 'job-assessment-judge',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
      usageKnown: false,
      jobApplicationId: null,
      cvDocumentId: null,
      runId: null,
    })
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { model: 'jev-1.14.0', promptTokens: 120, completionTokens: 3, totalTokens: 123, usageKnown: true, latencyMs: expect.any(Number) },
    })
  })

  it('writes validated job/run attribution on the reservation and keeps it on failure', async () => {
    vi.mocked(prisma.jobApplication.findFirst).mockImplementation((async ({ where }: { where: { id: string; profileId: string } }) =>
      where.id === 'job-1' && where.profileId === 'p1' ? { id: 'job-1' } : null) as never)
    await askJev('p1', { state, questions }, { feature: 'job-assessment-judge', attribution: { jobApplicationId: 'job-1', runId: 'a1' } })
    expect((mockCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data)
      .toMatchObject({ jobApplicationId: 'job-1', cvDocumentId: null, runId: 'a1', usageKnown: false })

    // Another profile's job is dropped; a failed call keeps its row as unknown usage.
    mockSystemOne.mockRejectedValueOnce(apiError(500))
    await expect(askJev('p2', { state, questions }, { feature: 'x', attribution: { jobApplicationId: 'job-1', runId: 'a2' } })).rejects.toThrow(JevError)
    expect((mockCreate.mock.calls[1][0] as { data: Record<string, unknown> }).data).toMatchObject({ jobApplicationId: null, runId: 'a2' })
    const failedUpdate = mockUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> }
    expect(failedUpdate.data).toMatchObject({ feature: 'x:failed' })
    expect(failedUpdate.data).not.toHaveProperty('usageKnown')
  })

  it('treats null token counts as zero', async () => {
    mockSystemOne.mockResolvedValueOnce({ ...okResult, usage: { input_tokens: null, output_tokens: null } })
    const res = await askJev('p1', { state, questions }, { feature: 'test' })
    expect(res.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
    // …but the row says the usage wasn't reported, rather than claiming a measured zero.
    expect((mockUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> }).data).toMatchObject({ usageKnown: false })
  })

  it('still returns the answer when updating the reservation fails', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('DB down'))
    await expect(askJev('p1', { state, questions }, { feature: 'test' })).resolves.toBeDefined()
  })

  it('throws JevError and keeps the reservation, marked failed with zero tokens, when the call fails', async () => {
    mockSystemOne.mockRejectedValueOnce(apiError(529))
    await expect(askJev('p1', { state, questions }, { feature: 'test' }))
      .rejects.toBeInstanceOf(JevError)
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { feature: 'test:failed', latencyMs: expect.any(Number) },
    })
  })

  it('still throws the call error when marking the reservation failed also fails', async () => {
    mockSystemOne.mockRejectedValueOnce(apiError(429))
    mockUpdate.mockRejectedValueOnce(new Error('DB down'))
    await expect(askJev('p1', { state, questions }, { feature: 'test' })).rejects.toMatchObject({ kind: 'rate_limited' })
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
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ feature: 'test:failed' }) }))
  })

  it('keeps status and request id on API errors', () => {
    const err = APIError.fromResponse(429, { detail: 'slow down' }, new Headers({ 'x-typesafe-request-id': 'req-1' }))
    expect(normalizeJevError(err)).toMatchObject({ kind: 'rate_limited', status: 429, requestId: 'req-1' })
  })
})

describe('jevCallsRemainingToday', () => {
  afterEach(() => vi.unstubAllEnvs())

  it("is the daily limit minus today's typesafe rows for the profile, never negative", async () => {
    vi.stubEnv('JEV_DAILY_CALL_LIMIT', '300')
    mockCount.mockResolvedValueOnce(60)
    expect(await jevCallsRemainingToday('p1')).toBe(240)
    const where = (mockCount.mock.calls.at(-1)![0] as { where: { profileId: string; provider: string; createdAt: { gte: Date } } }).where
    expect(where.profileId).toBe('p1')
    expect(where.provider).toBe('typesafe')
    expect(where.createdAt.gte.getHours()).toBe(0)
    mockCount.mockResolvedValueOnce(400)
    expect(await jevCallsRemainingToday('p1')).toBe(0)
  })

  it('uses the default limit when the env var is blank', async () => {
    vi.stubEnv('JEV_DAILY_CALL_LIMIT', '')
    mockCount.mockResolvedValueOnce(0)
    expect(await jevCallsRemainingToday('p1')).toBe(300)
  })
})
