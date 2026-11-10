import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => {
  const jobApplication = { count: vi.fn(), findMany: vi.fn() }
  const jobAssessment = { count: vi.fn() }
  const tx = { $executeRaw: vi.fn(), jobApplication, jobAssessment }
  return {
    prisma: {
      jobApplication,
      jobAssessment,
      $executeRaw: tx.$executeRaw,
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  }
})
vi.mock('@/modules/jev/client', () => ({ jevCallsRemainingToday: vi.fn() }))
vi.mock('@/modules/llm/client', () => ({ getLLMConfigStatus: vi.fn() }))
vi.mock('./queue', () => ({ insertQueuedAssessments: vi.fn(), scheduleBatchDrains: vi.fn() }))

import { prisma } from '@/lib/db'
import { jevCallsRemainingToday } from '@/modules/jev/client'
import { getLLMConfigStatus } from '@/modules/llm/client'
import {
  BACKFILL_BATCH_SIZE,
  backfillCandidateWhere,
  backfillSkippedWhere,
  getBackfillStatus,
  JEV_CALLS_PER_RUN_ESTIMATE,
  planBatch,
  startBackfill,
} from './backfill'
import { insertQueuedAssessments, scheduleBatchDrains } from './queue'
import { PIPELINE_VERSION } from './schema'

const jobCount = vi.mocked(prisma.jobApplication.count)
const jobFind = vi.mocked(prisma.jobApplication.findMany)
const runCount = vi.mocked(prisma.jobAssessment.count)
const lock = vi.mocked(prisma.$executeRaw)
const transaction = vi.mocked(prisma.$transaction)
const remaining = vi.mocked(jevCallsRemainingToday)
const llm = vi.mocked(getLLMConfigStatus)
const insert = vi.mocked(insertQueuedAssessments)
const schedule = vi.mocked(scheduleBatchDrains)

beforeEach(() => {
  vi.clearAllMocks()
  jobCount.mockResolvedValue(30)
  runCount.mockResolvedValue(0)
  remaining.mockResolvedValue(300)
  llm.mockResolvedValue({ configured: true } as never)
  jobFind.mockImplementation((async (args: { take: number }) =>
    Array.from({ length: args.take }, (_, i) => ({ id: `j${i}` }))) as never)
  insert.mockImplementation((async (_db: unknown, _p: string, ids: readonly string[]) => ids.map((id) => `as-${id}`)) as never)
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

type Where = { AND: [Record<string, unknown>, { assessments: Record<string, Record<string, unknown>> }] }

describe('backfillCandidateWhere / backfillSkippedWhere', () => {
  const now = new Date('2026-11-10T12:00:00Z')

  it('scopes to the profile, non-archived "not started" jobs without a current result or pending run', () => {
    const [base] = (backfillCandidateWhere('p1', now) as Where).AND
    expect(base).toMatchObject({ profileId: 'p1', archivedAt: null, status: 'not started' })
    const none = (base.assessments as { none: { OR: Record<string, unknown>[] } }).none.OR
    expect(none[0]).toEqual({ pipelineVersion: PIPELINE_VERSION, status: 'complete' })
    // Pending: queued within 15 min, or in progress within 5 min (stale rows don't block).
    const pending = (none[1] as { OR: unknown[] }).OR
    expect(pending[0]).toEqual({ status: 'queued', createdAt: { gte: new Date(now.getTime() - 15 * 60_000) } })
    expect(pending[1]).toEqual({
      status: { in: ['checking', 'fetching', 'assessing'] },
      startedAt: { gte: new Date(now.getTime() - 5 * 60_000) },
    })
  })

  it('excludes jobs whose current-version runs failed in a way that would fail again', () => {
    const [, excl] = (backfillCandidateWhere('p1', now) as Where).AND
    expect(excl.assessments.none).toEqual({
      pipelineVersion: PIPELINE_VERSION,
      status: 'failed',
      failureKind: { in: ['verification', 'no_llm_key', 'error'] },
    })
  })

  it('keeps transient failures eligible', () => {
    const [, excl] = (backfillCandidateWhere('p1', now) as Where).AND
    const kinds = (excl.assessments.none.failureKind as { in: string[] }).in
    for (const transient of ['rate_limited', 'overloaded', 'daily_cap', 'superseded', 'not_configured']) {
      expect(kinds).not.toContain(transient)
    }
  })

  it('counts the excluded jobs as skipped, on the same base', () => {
    const candidate = (backfillCandidateWhere('p1', now) as Where).AND
    const skipped = (backfillSkippedWhere('p1', now) as Where).AND
    expect(skipped[0]).toEqual(candidate[0])
    expect(skipped[1].assessments.some).toEqual(candidate[1].assessments.none)
  })
})

describe('getBackfillStatus', () => {
  it('reports eligible and skipped jobs, pending runs, calls left and the next batch', async () => {
    jobCount.mockResolvedValueOnce(12).mockResolvedValueOnce(4)
    remaining.mockResolvedValueOnce(240)
    expect(await getBackfillStatus('p1')).toEqual({
      eligible: 12,
      skipped: 4,
      pending: 0,
      remainingCalls: 240,
      nextBatch: 12,
      limitedBy: 'none',
      callsPerJob: JEV_CALLS_PER_RUN_ESTIMATE,
    })
    expect(runCount).toHaveBeenCalledWith({ where: expect.objectContaining({ profileId: 'p1' }) })
    expect(remaining).toHaveBeenCalledWith('p1')
  })
})

describe('startBackfill', () => {
  it('checks pending runs and inserts under the per-profile backfill lock, in one transaction', async () => {
    await startBackfill('p1')
    expect(transaction).toHaveBeenCalledOnce()
    const [sql, ...values] = lock.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]]
    expect(sql.join('?')).toBe('SELECT pg_advisory_xact_lock(hashtext(?))')
    expect(values).toEqual(['job-assessment-backfill:p1'])
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(runCount.mock.invocationCallOrder[0])
    expect(runCount.mock.invocationCallOrder[0]).toBeLessThan(insert.mock.invocationCallOrder[0])
    // Inserted with the transaction client, drains scheduled only after it.
    expect(insert.mock.calls[0][0]).toHaveProperty('$executeRaw')
    expect(insert.mock.invocationCallOrder[0]).toBeLessThan(schedule.mock.invocationCallOrder[0])
  })

  it('refuses while runs are pending', async () => {
    runCount.mockResolvedValueOnce(3)
    expect(await startBackfill('p1')).toEqual({ ok: false, error: expect.any(String) })
    expect(insert).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
  })

  it('a second, concurrent start waits on the lock and then sees the first batch as pending', async () => {
    let chain: Promise<unknown> = Promise.resolve()
    let pendingRows = 0
    transaction.mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) => {
      const run = chain.then(() => fn({ $executeRaw: lock, jobApplication: prisma.jobApplication, jobAssessment: prisma.jobAssessment }))
      chain = run.catch(() => {})
      return run
    }) as never)
    runCount.mockImplementation((async () => pendingRows) as never)
    insert.mockImplementation((async (_db: unknown, _p: string, ids: readonly string[]) => {
      pendingRows += ids.length
      return ids.map((id) => `as-${id}`)
    }) as never)
    const [a, b] = await Promise.all([startBackfill('p1'), startBackfill('p1')])
    expect([a.ok, b.ok].sort()).toEqual([false, true])
    expect(insert).toHaveBeenCalledOnce()
  })

  it('refuses without an LLM key', async () => {
    llm.mockResolvedValueOnce({ configured: false } as never)
    expect(await startBackfill('p1')).toMatchObject({ ok: false })
    expect(insert).not.toHaveBeenCalled()
  })

  it('queues a batch of the newest candidates as a backfill', async () => {
    const res = await startBackfill('p1', { requestStartedAt: 123 })
    expect(res).toEqual({ ok: true, queued: BACKFILL_BATCH_SIZE, remaining: 30 - BACKFILL_BATCH_SIZE, limitedBy: 'batch' })
    expect(jobFind).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ lastUpdated: 'desc' }, { id: 'desc' }],
      take: BACKFILL_BATCH_SIZE,
    }))
    const [, profileId, ids] = insert.mock.calls[0]
    expect(profileId).toBe('p1')
    expect(ids).toHaveLength(BACKFILL_BATCH_SIZE)
    expect(schedule).toHaveBeenCalledWith('p1', BACKFILL_BATCH_SIZE, { reason: 'backfill', requestStartedAt: 123 })
  })

  it('never plans past the daily cap', async () => {
    remaining.mockResolvedValueOnce(10) // 3 runs
    expect(await startBackfill('p1')).toEqual({ ok: true, queued: 3, remaining: 27, limitedBy: 'daily_cap' })
    expect(insert.mock.calls[0][2]).toHaveLength(3)
  })

  it('queues nothing when no calls are left', async () => {
    remaining.mockResolvedValueOnce(0)
    expect(await startBackfill('p1')).toEqual({ ok: true, queued: 0, remaining: 30, limitedBy: 'daily_cap' })
    expect(jobFind).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })
})
