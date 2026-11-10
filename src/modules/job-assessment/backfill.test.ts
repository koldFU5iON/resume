import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    jobApplication: { count: vi.fn(), findMany: vi.fn() },
    jobAssessment: { count: vi.fn() },
  },
}))
vi.mock('@/modules/jev/client', () => ({ jevCallsRemainingToday: vi.fn() }))
vi.mock('@/modules/llm/client', () => ({ getLLMConfigStatus: vi.fn() }))
vi.mock('./queue', () => ({ queueJobAssessments: vi.fn() }))

import { prisma } from '@/lib/db'
import { jevCallsRemainingToday } from '@/modules/jev/client'
import { getLLMConfigStatus } from '@/modules/llm/client'
import {
  BACKFILL_BATCH_SIZE,
  backfillCandidateWhere,
  getBackfillStatus,
  JEV_CALLS_PER_RUN_ESTIMATE,
  planBatch,
  startBackfill,
} from './backfill'
import { queueJobAssessments } from './queue'
import { PIPELINE_VERSION } from './schema'

const jobCount = vi.mocked(prisma.jobApplication.count)
const jobFind = vi.mocked(prisma.jobApplication.findMany)
const runCount = vi.mocked(prisma.jobAssessment.count)
const remaining = vi.mocked(jevCallsRemainingToday)
const llm = vi.mocked(getLLMConfigStatus)
const queue = vi.mocked(queueJobAssessments)

beforeEach(() => {
  vi.clearAllMocks()
  jobCount.mockResolvedValue(30)
  runCount.mockResolvedValue(0)
  remaining.mockResolvedValue(300)
  llm.mockResolvedValue({ configured: true } as never)
  jobFind.mockImplementation((async (args: { take: number }) =>
    Array.from({ length: args.take }, (_, i) => ({ id: `j${i}` }))) as never)
  queue.mockImplementation((async (_p: string, ids: readonly string[]) =>
    ({ queued: ids.length, assessmentIds: ids.map((id) => `as-${id}`) })) as never)
})

describe('planBatch', () => {
  it('is limited by the batch size when calls and jobs are plentiful', () => {
    expect(planBatch(100, 300)).toEqual({ size: BACKFILL_BATCH_SIZE, limitedBy: 'batch' })
  })

  it('is limited by the daily cap when fewer than a batch of runs fit', () => {
    // 40 calls → 13 runs of 3 calls.
    expect(planBatch(100, 40)).toEqual({ size: Math.floor(40 / JEV_CALLS_PER_RUN_ESTIMATE), limitedBy: 'daily_cap' })
    expect(planBatch(15, 40)).toEqual({ size: 13, limitedBy: 'daily_cap' })
  })

  it('queues nothing when no calls are left', () => {
    expect(planBatch(10, 0)).toEqual({ size: 0, limitedBy: 'daily_cap' })
    expect(planBatch(10, 2)).toEqual({ size: 0, limitedBy: 'daily_cap' })
    expect(planBatch(10, -5)).toEqual({ size: 0, limitedBy: 'daily_cap' })
  })

  it('takes every candidate when they all fit', () => {
    expect(planBatch(7, 300)).toEqual({ size: 7, limitedBy: 'none' })
    expect(planBatch(0, 0)).toEqual({ size: 0, limitedBy: 'none' })
    expect(planBatch(BACKFILL_BATCH_SIZE, 300)).toEqual({ size: BACKFILL_BATCH_SIZE, limitedBy: 'none' })
  })
})

describe('backfillCandidateWhere', () => {
  it('scopes to the profile, non-archived "not started" jobs without a current result or pending run', () => {
    const now = new Date('2026-11-10T12:00:00Z')
    const where = backfillCandidateWhere('p1', now)
    expect(where).toMatchObject({ profileId: 'p1', archivedAt: null, status: 'not started' })
    const none = (where.assessments as { none: { OR: Record<string, unknown>[] } }).none.OR
    expect(none).toContainEqual({ pipelineVersion: PIPELINE_VERSION, status: 'complete' })
    expect(none).toContainEqual({ pipelineVersion: PIPELINE_VERSION, status: 'failed', failureKind: 'verification' })
    // Pending: queued within 15 min, or in progress within 5 min (stale rows don't block).
    const pending = (none[2] as { OR: { status: unknown; createdAt?: { gte: Date }; startedAt?: { gte: Date } }[] }).OR
    expect(pending[0]).toEqual({ status: 'queued', createdAt: { gte: new Date(now.getTime() - 15 * 60_000) } })
    expect(pending[1]).toEqual({
      status: { in: ['checking', 'fetching', 'assessing'] },
      startedAt: { gte: new Date(now.getTime() - 5 * 60_000) },
    })
  })
})

describe('getBackfillStatus', () => {
  it('reports eligible jobs, pending runs, calls left and the next batch', async () => {
    jobCount.mockResolvedValueOnce(12)
    runCount.mockResolvedValueOnce(0)
    remaining.mockResolvedValueOnce(240)
    expect(await getBackfillStatus('p1')).toEqual({
      eligible: 12, pending: 0, remainingCalls: 240, nextBatch: 12, limitedBy: 'none', callsPerJob: JEV_CALLS_PER_RUN_ESTIMATE,
    })
    expect(runCount).toHaveBeenCalledWith({ where: expect.objectContaining({ profileId: 'p1' }) })
    expect(jobCount).toHaveBeenCalledWith({ where: expect.objectContaining({ profileId: 'p1' }) })
    expect(remaining).toHaveBeenCalledWith('p1')
  })
})

describe('startBackfill', () => {
  it('refuses while runs are pending', async () => {
    runCount.mockResolvedValueOnce(3)
    expect(await startBackfill('p1')).toEqual({ ok: false, error: expect.any(String) })
    expect(queue).not.toHaveBeenCalled()
  })

  it('refuses without an LLM key', async () => {
    llm.mockResolvedValueOnce({ configured: false } as never)
    expect(await startBackfill('p1')).toMatchObject({ ok: false })
    expect(queue).not.toHaveBeenCalled()
  })

  it('queues a batch of the newest candidates as a backfill', async () => {
    const res = await startBackfill('p1', { requestStartedAt: 123 })
    expect(res).toEqual({ ok: true, queued: BACKFILL_BATCH_SIZE, remaining: 30 - BACKFILL_BATCH_SIZE, limitedBy: 'batch' })
    expect(jobFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ profileId: 'p1', status: 'not started', archivedAt: null }),
      orderBy: [{ lastUpdated: 'desc' }, { id: 'desc' }],
      take: BACKFILL_BATCH_SIZE,
    }))
    const [profileId, ids, opts] = queue.mock.calls[0]
    expect(profileId).toBe('p1')
    expect(ids).toHaveLength(BACKFILL_BATCH_SIZE)
    expect(opts).toEqual({ reason: 'backfill', requestStartedAt: 123 })
  })

  it('never plans past the daily cap', async () => {
    remaining.mockResolvedValueOnce(10) // 3 runs
    expect(await startBackfill('p1')).toEqual({ ok: true, queued: 3, remaining: 27, limitedBy: 'daily_cap' })
    expect(queue.mock.calls[0][1]).toHaveLength(3)
  })

  it('queues nothing when no calls are left', async () => {
    remaining.mockResolvedValueOnce(0)
    expect(await startBackfill('p1')).toEqual({ ok: true, queued: 0, remaining: 30, limitedBy: 'daily_cap' })
    expect(jobFind).not.toHaveBeenCalled()
    expect(queue).not.toHaveBeenCalled()
  })

  it('reports a disabled feature', async () => {
    queue.mockResolvedValueOnce({ queued: 0, reason: 'disabled' })
    expect(await startBackfill('p1')).toMatchObject({ ok: false })
  })
})
