import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: vi.fn() }))
vi.mock('@/modules/job-assessment/queue', () => ({
  assessmentMaybeEnabled: vi.fn(() => true),
  drainProfileQueue: vi.fn(),
  DRAIN_TIME_BUDGET_MS: 285_000,
}))

import { after } from 'next/server'
import { signContinuationToken } from '@/modules/job-assessment/continuation'
import { assessmentMaybeEnabled, drainProfileQueue } from '@/modules/job-assessment/queue'
import { POST } from './route'

const mockAfter = vi.mocked(after)
const mockDrain = vi.mocked(drainProfileQueue)

function req(authorization?: string) {
  return new Request('http://localhost/api/internal/job-assessment/drain', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-not-real')
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/internal/job-assessment/drain', () => {
  it('returns 401 with no body for a missing or bad token', async () => {
    for (const auth of [undefined, 'Bearer nope', `Bearer ${signContinuationToken('p1', 1)}x`]) {
      const res = await POST(req(auth))
      expect(res.status).toBe(401)
      expect(await res.text()).toBe('')
    }
    expect(mockAfter).not.toHaveBeenCalled()
  })

  it('returns 401 for an expired token', async () => {
    const res = await POST(req(`Bearer ${signContinuationToken('p1', 1, Date.now() - 3 * 60_000)}`))
    expect(res.status).toBe(401)
  })

  it('returns 202 and drains the profile in after() with a fresh budget and the hop', async () => {
    const before = Date.now()
    const res = await POST(req(`Bearer ${signContinuationToken('p1', 3)}`))
    expect(res.status).toBe(202)
    expect(mockAfter).toHaveBeenCalledOnce()
    expect(mockDrain).not.toHaveBeenCalled() // only after the response
    await (mockAfter.mock.calls[0][0] as () => Promise<unknown>)()
    const [profileId, opts] = mockDrain.mock.calls[0]
    expect(profileId).toBe('p1')
    expect(opts?.continuation).toBe(3)
    expect(opts!.deadline! - before).toBeGreaterThanOrEqual(285_000)
  })

  it('accepts but does not drain when the feature is switched off', async () => {
    vi.mocked(assessmentMaybeEnabled).mockReturnValueOnce(false)
    const res = await POST(req(`Bearer ${signContinuationToken('p1', 1)}`))
    expect(res.status).toBe(202)
    expect(mockAfter).not.toHaveBeenCalled()
  })
})
