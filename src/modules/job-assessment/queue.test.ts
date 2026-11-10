import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db', () => {
  const jobAssessment = { updateMany: vi.fn(), create: vi.fn(), createManyAndReturn: vi.fn(), count: vi.fn(), findFirst: vi.fn() }
  // Fake interactive transaction: the callback gets a tx sharing the same delegates.
  const tx = { $executeRaw: vi.fn(), jobAssessment }
  return {
    prisma: {
      profile: { findUnique: vi.fn() },
      jobApplication: { findFirst: vi.fn(), findMany: vi.fn() },
      jobAssessment,
      $executeRaw: tx.$executeRaw,
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  }
})
vi.mock('@/lib/session', () => ({ isAdminUser: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('./run', async (orig) => ({ ...(await orig<typeof import('./run')>()), runJobAssessment: vi.fn() }))
vi.mock('./continuation', async (orig) => ({
  ...(await orig<typeof import('./continuation')>()),
  requestContinuation: vi.fn(),
}))

import { after } from 'next/server'
import { prisma } from '@/lib/db'
import { isAdminUser } from '@/lib/session'
import {
  activeDrainCount,
  admitNextRun,
  assessmentFlag,
  assessmentMaybeEnabled,
  DRAIN_TIME_BUDGET_MS,
  drainProfileQueue,
  isAssessmentEnabledFor,
  MAX_RESCHEDULES,
  MAX_RUNS_PER_DRAIN,
  MIN_RUN_START_MS,
  ASSESSMENT_CONCURRENCY_PER_PROFILE,
  queueJobAssessment,
  insertQueuedAssessments,
  queueJobAssessments,
  queueJobAssessmentSafely,
  STALE_QUEUED_REASON,
} from './queue'
import { runJobAssessment, STAGE_WORST_MS } from './run'
import { MAX_CONTINUATIONS, requestContinuation } from './continuation'
import { PIPELINE_VERSION } from './schema'

const mockAfter = vi.mocked(after)
const mockAdmin = vi.mocked(isAdminUser)
const mockRun = vi.mocked(runJobAssessment)
const a = vi.mocked(prisma.jobAssessment)
const mockLock = vi.mocked(prisma.$executeRaw)
const mockTransaction = vi.mocked(prisma.$transaction)
const mockContinue = vi.mocked(requestContinuation)

/** Ids of the claims passed to runJobAssessment, in order. */
const ranIds = () => mockRun.mock.calls.map((c) => c[0].id)

/** Is this a count of in-progress rows (admission), rather than of queued rows (post-drain re-check)? */
const isInProgressCount = (args: unknown) => typeof (args as { where: { status: unknown } }).where.status === 'object'

beforeEach(() => {
  vi.clearAllMocks()
  // Drop implementations and unconsumed *Once values from earlier tests.
  for (const m of [a.updateMany, a.create, a.createManyAndReturn, a.count, a.findFirst, mockLock, mockTransaction]) m.mockReset()
  mockTransaction.mockImplementation((async (fn: (tx: unknown) => unknown) => fn({ $executeRaw: mockLock, jobAssessment: a })) as never)
  vi.stubEnv('TYPESAFE_API_KEY', 'ts-test')
  vi.stubEnv('JOB_ASSESSMENT_V2', 'all')
  vi.mocked(prisma.profile.findUnique).mockResolvedValue({ userId: 'u1' } as never)
  vi.mocked(prisma.jobApplication.findFirst).mockResolvedValue({ id: 'job-1' } as never)
  a.updateMany.mockResolvedValue({ count: 1 }) // supersede / expiry / admission claim
  a.create.mockResolvedValue({ id: 'as-1' } as never)
  a.count.mockResolvedValue(0) // no runs in progress, and nothing queued on the post-drain re-check
  a.findFirst.mockResolvedValue(null)
  mockAdmin.mockResolvedValue(false)
  mockLock.mockResolvedValue(1 as never)
  mockRun.mockReset()
  mockRun.mockResolvedValue('complete')
  mockContinue.mockResolvedValue(true)
})
afterEach(() => vi.unstubAllEnvs())

describe('assessmentFlag', () => {
  it.each([
    [undefined, 'admin'], ['', 'admin'], ['off', 'off'], ['ALL', 'all'], ['admin', 'admin'], ['bogus', 'admin'],
  ])('%s → %s', (value, flag) => {
    if (value === undefined) vi.stubEnv('JOB_ASSESSMENT_V2', undefined as never)
    else vi.stubEnv('JOB_ASSESSMENT_V2', value)
    expect(assessmentFlag()).toBe(flag)
  })
})

describe('isAssessmentEnabledFor', () => {
  it('is off without a TypeSafe key, whatever the flag', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '')
    expect(await isAssessmentEnabledFor('p1')).toBe(false)
  })

  it('is off when the flag is off', async () => {
    vi.stubEnv('JOB_ASSESSMENT_V2', 'off')
    expect(await isAssessmentEnabledFor('p1')).toBe(false)
  })

  it('admin: only for the profile of an admin user', async () => {
    vi.stubEnv('JOB_ASSESSMENT_V2', 'admin')
    expect(await isAssessmentEnabledFor('p1')).toBe(false)
    mockAdmin.mockResolvedValueOnce(true)
    expect(await isAssessmentEnabledFor('p1')).toBe(true)
    expect(mockAdmin).toHaveBeenLastCalledWith('u1')
  })

  it('all: everyone', async () => {
    expect(await isAssessmentEnabledFor('p1')).toBe(true)
    expect(mockAdmin).not.toHaveBeenCalled()
  })
})

describe('assessmentMaybeEnabled', () => {
  it('is a sync env/flag check', () => {
    expect(assessmentMaybeEnabled()).toBe(true)
    vi.stubEnv('JOB_ASSESSMENT_V2', 'off')
    expect(assessmentMaybeEnabled()).toBe(false)
    vi.stubEnv('JOB_ASSESSMENT_V2', 'admin')
    vi.stubEnv('TYPESAFE_API_KEY', '')
    expect(assessmentMaybeEnabled()).toBe(false)
  })
})

describe('queueJobAssessment', () => {
  it('is a no-op when disabled', async () => {
    vi.stubEnv('JOB_ASSESSMENT_V2', 'off')
    expect(await queueJobAssessment('p1', 'job-1', { reason: 'created' })).toEqual({ queued: false, reason: 'disabled' })
    expect(a.create).not.toHaveBeenCalled()
    expect(mockAfter).not.toHaveBeenCalled()
  })

  it('refuses a job of another profile', async () => {
    vi.mocked(prisma.jobApplication.findFirst).mockResolvedValueOnce(null)
    expect(await queueJobAssessment('p1', 'job-x', { reason: 'manual' })).toEqual({ queued: false, reason: 'not_found' })
    expect(prisma.jobApplication.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'job-x', profileId: 'p1' } }))
    expect(a.create).not.toHaveBeenCalled()
  })

  it('supersedes older queued rows, inserts a queued row and schedules the drain', async () => {
    const res = await queueJobAssessment('p1', 'job-1', { reason: 'edited' })
    expect(res).toEqual({ queued: true, assessmentId: 'as-1' })
    expect(a.updateMany).toHaveBeenCalledWith({
      where: { profileId: 'p1', jobApplicationId: 'job-1', status: 'queued' },
      data: expect.objectContaining({ status: 'failed', failureKind: 'superseded', completedAt: expect.any(Date) }),
    })
    expect(a.create).toHaveBeenCalledWith({
      data: { profileId: 'p1', jobApplicationId: 'job-1', pipelineVersion: PIPELINE_VERSION, status: 'queued' },
      select: { id: true },
    })
    expect(a.updateMany.mock.invocationCallOrder[0]).toBeLessThan(a.create.mock.invocationCallOrder[0])
    expect(mockAfter).toHaveBeenCalledOnce()
  })

  it('drains detached when after() is unavailable', async () => {
    mockAfter.mockImplementationOnce(() => { throw new Error('outside a request scope') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await queueJobAssessment('p1', 'job-1', { reason: 'created' })
    await vi.waitFor(() => expect(a.count).toHaveBeenCalled())
    warn.mockRestore()
  })
})

describe('queueJobAssessmentSafely', () => {
  it('swallows and logs errors', async () => {
    a.create.mockRejectedValueOnce(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(queueJobAssessmentSafely('p1', 'job-1', { reason: 'created' })).resolves.toBeUndefined()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})

describe('admitNextRun', () => {
  it('takes the per-profile advisory lock inside the transaction, before counting', async () => {
    a.findFirst.mockResolvedValueOnce({ id: 'r1' } as never)
    await admitNextRun('p1')
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    const [sql, ...values] = mockLock.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]]
    expect(sql.join('?')).toBe('SELECT pg_advisory_xact_lock(hashtext(?))')
    expect(values).toEqual(['job-assessment:p1'])
    expect(mockLock.mock.invocationCallOrder[0]).toBeLessThan(a.count.mock.invocationCallOrder[0])
    expect(a.count.mock.invocationCallOrder[0]).toBeLessThan(a.findFirst.mock.invocationCallOrder[0])
  })

  it('counts only runs in progress inside the 5-minute lease window', async () => {
    await admitNextRun('p1')
    const where = (a.count.mock.calls[0][0] as { where: { status: unknown; startedAt: { gte: Date } } }).where
    expect(where.status).toEqual({ in: ['checking', 'fetching', 'assessing'] })
    expect(Date.now() - where.startedAt.gte.getTime()).toBeGreaterThanOrEqual(5 * 60_000 - 1000)
  })

  it('returns limit without claiming when the profile is at the limit', async () => {
    a.count.mockResolvedValueOnce(2)
    expect(await admitNextRun('p1')).toEqual({ kind: 'limit' })
    expect(a.findFirst).not.toHaveBeenCalled()
    expect(a.updateMany).not.toHaveBeenCalled()
  })

  it('claims the oldest queued row below the limit, with startedAt as the lease token', async () => {
    a.count.mockResolvedValueOnce(1)
    a.findFirst.mockResolvedValueOnce({ id: 'r1' } as never)
    const res = await admitNextRun('p1')
    expect(a.findFirst).toHaveBeenCalledWith({
      where: { profileId: 'p1', status: 'queued' }, orderBy: { createdAt: 'asc' }, select: { id: true },
    })
    expect(a.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'queued' }, data: { status: 'checking', startedAt: expect.any(Date) },
    })
    const startedAt = (a.updateMany.mock.calls[0][0] as { data: { startedAt: Date } }).data.startedAt
    expect(res).toEqual({ kind: 'claimed', claim: { id: 'r1', startedAt } })
  })

  it('returns empty when nothing is queued', async () => {
    expect(await admitNextRun('p1')).toEqual({ kind: 'empty' })
  })

  it('serialises concurrent admissions so the limit holds across drains', async () => {
    // A real lock: each transaction waits for the previous one. Two "instances"
    // admit at once with one run already going; only one more may start.
    let inProgress = 1
    let chain: Promise<unknown> = Promise.resolve()
    mockTransaction.mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) => {
      const run = chain.then(() => fn({ $executeRaw: mockLock, jobAssessment: a }))
      chain = run.catch(() => {})
      return run
    }) as never)
    a.count.mockImplementation((async () => inProgress) as never)
    let n = 0
    a.findFirst.mockImplementation((async () => ({ id: `r${n++}` })) as never)
    a.updateMany.mockImplementation((async () => { inProgress++; return { count: 1 } }) as never)

    const results = await Promise.all([admitNextRun('p1'), admitNextRun('p1'), admitNextRun('p1')])
    expect(results.filter((r) => r.kind === 'claimed')).toHaveLength(1)
    expect(results.filter((r) => r.kind === 'limit')).toHaveLength(2)
  })
})

describe('drainProfileQueue', () => {
  it('runs admitted rows oldest first until none are left', async () => {
    a.findFirst
      .mockResolvedValueOnce({ id: 'r1' } as never)
      .mockResolvedValueOnce({ id: 'r2' } as never)
      .mockResolvedValueOnce(null)
    expect(await drainProfileQueue('p1')).toBe(2)
    expect(ranIds()).toEqual(['r1', 'r2'])
    expect(mockTransaction).toHaveBeenCalledTimes(3) // one admission per run, plus the empty one
    expect(activeDrainCount('p1')).toBe(0)
  })

  it('runs one at a time', async () => {
    let inFlight = 0
    let maxInFlight = 0
    a.findFirst
      .mockResolvedValueOnce({ id: 'r1' } as never)
      .mockResolvedValueOnce({ id: 'r2' } as never)
      .mockResolvedValueOnce({ id: 'r3' } as never)
      .mockResolvedValueOnce(null)
    mockRun.mockImplementation(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return 'complete'
    })
    await drainProfileQueue('p1')
    expect(maxInFlight).toBe(1)
  })

  it('stops when admission reports the limit', async () => {
    a.count.mockResolvedValueOnce(2)
    expect(await drainProfileQueue('p1')).toBe(0)
    expect(mockRun).not.toHaveBeenCalled()
    expect(activeDrainCount('p1')).toBe(0)
  })

  it('re-admits (count + claim, atomically) before every run', async () => {
    let inProgress = 0
    a.count.mockImplementation((async (args: unknown) => (isInProgressCount(args) ? inProgress : 0)) as never)
    a.findFirst.mockResolvedValue({ id: 'r1' } as never)
    mockRun.mockImplementation(async () => { inProgress = 2; return 'complete' }) // another instance started two runs
    expect(await drainProfileQueue('p1')).toBe(1)
    expect(mockRun).toHaveBeenCalledTimes(1)
    expect(mockTransaction).toHaveBeenCalledTimes(2)
  })

  it('uses the in-process counter only as a pre-check (no transaction when this instance is full)', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    a.findFirst.mockResolvedValueOnce({ id: 'r1' } as never).mockResolvedValueOnce({ id: 'r2' } as never).mockResolvedValue(null)
    mockRun.mockImplementation(async () => { await gate; return 'complete' })

    const d1 = drainProfileQueue('p1')
    const d2 = drainProfileQueue('p1')
    await vi.waitFor(() => expect(mockRun).toHaveBeenCalledTimes(2))
    const transactions = mockTransaction.mock.calls.length
    expect(await drainProfileQueue('p1')).toBe(0) // third drain: pre-check stops it
    expect(mockTransaction.mock.calls.length).toBe(transactions)
    release()
    await Promise.all([d1, d2])
    expect(activeDrainCount('p1')).toBe(0)
  })

  it('stops if an admitted claim is no longer ours', async () => {
    a.findFirst.mockResolvedValue({ id: 'r1' } as never)
    mockRun.mockResolvedValue('not_claimed')
    expect(await drainProfileQueue('p1')).toBe(0)
    expect(mockRun).toHaveBeenCalledTimes(1)
  })

  it('stops after MAX_RUNS_PER_DRAIN runs', async () => {
    let n = 0
    a.findFirst.mockImplementation((async () => ({ id: `r${n++}` })) as never)
    expect(await drainProfileQueue('p1')).toBe(MAX_RUNS_PER_DRAIN)
  })

  it('never throws on a DB error', async () => {
    mockTransaction.mockRejectedValueOnce(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(drainProfileQueue('p1')).resolves.toBe(0)
    expect(activeDrainCount('p1')).toBe(0)
    err.mockRestore()
  })
})

describe('drainProfileQueue — deadline, stale rows, re-checks', () => {
  it('fails queued rows older than the stale window before admitting anything', async () => {
    await drainProfileQueue('p1')
    expect(a.updateMany.mock.calls[0][0]).toEqual({
      where: { profileId: 'p1', status: 'queued', createdAt: { lt: expect.any(Date) } },
      data: { status: 'failed', failureKind: 'superseded', failureReasons: [STALE_QUEUED_REASON], completedAt: expect.any(Date) },
    })
    const cutoff = (a.updateMany.mock.calls[0][0] as { where: { createdAt: { lt: Date } } }).where.createdAt.lt
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(15 * 60_000 - 1000)
    expect(a.updateMany.mock.invocationCallOrder[0]).toBeLessThan(mockTransaction.mock.invocationCallOrder[0])
  })

  it('MIN_RUN_START_MS covers the first stage', () => {
    expect(MIN_RUN_START_MS).toBeGreaterThanOrEqual(STAGE_WORST_MS.verify)
  })

  it('does not admit a run when less than MIN_RUN_START_MS is left', async () => {
    a.findFirst.mockResolvedValue({ id: 'r1' } as never)
    expect(await drainProfileQueue('p1', { deadline: Date.now() + MIN_RUN_START_MS - 1_000 })).toBe(0)
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockRun).not.toHaveBeenCalled()
  })

  /** Fake clock: each run advances it by `runMs`. */
  function fakeClock(runMs: number) {
    let now = 1_000_000
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    mockRun.mockImplementation(async () => { now += runMs; return 'complete' })
    return { start: now, restore: () => spy.mockRestore() }
  }

  it('completes a batch of many fast runs within one drain', async () => {
    const clock = fakeClock(8_000)
    let n = 0
    a.findFirst.mockImplementation((async () => (n < 20 ? { id: `r${n++}` } : null)) as never)
    const ran = await drainProfileQueue('p1', { deadline: clock.start + DRAIN_TIME_BUDGET_MS })
    clock.restore()
    expect(ran).toBe(20)
  })

  it('passes the claim and the deadline to each run', async () => {
    a.findFirst.mockResolvedValueOnce({ id: 'r1' } as never).mockResolvedValue(null)
    const deadline = Date.now() + 200_000
    await drainProfileQueue('p1', { deadline })
    expect(mockRun).toHaveBeenCalledWith({ id: 'r1', startedAt: expect.any(Date) }, { deadline })
  })

  it('stops starting runs once less than MIN_RUN_START_MS is left', async () => {
    const clock = fakeClock(60_000)
    a.findFirst.mockResolvedValue({ id: 'r1' } as never)
    const ran = await drainProfileQueue('p1', { deadline: clock.start + 285_000 })
    clock.restore()
    expect(ran).toBe(4) // starts at 0, 60, 120, 180s; at 240s only 45s are left
  })

  it('stops after a run re-queues itself, and the next drain runs that row', async () => {
    a.findFirst.mockResolvedValue({ id: 'slow' } as never)
    mockRun.mockResolvedValueOnce('requeued')
    expect(await drainProfileQueue('p1')).toBe(0)
    expect(mockRun).toHaveBeenCalledTimes(1)
    expect(mockTransaction).toHaveBeenCalledTimes(1) // no in-process re-drain (continuation takes over)

    a.findFirst.mockReset()
    a.findFirst.mockResolvedValueOnce({ id: 'slow' } as never).mockResolvedValue(null)
    mockRun.mockResolvedValueOnce('complete')
    expect(await drainProfileQueue('p1')).toBe(1)
    expect(ranIds().at(-1)).toBe('slow')
  })

  it('takes the deadline from the request start when the caller passes it', async () => {
    await queueJobAssessment('p1', 'job-1', { reason: 'capture', requestStartedAt: Date.now() - DRAIN_TIME_BUDGET_MS })
    a.findFirst.mockResolvedValue({ id: 'r1' } as never)
    await (mockAfter.mock.calls[0][0] as () => Promise<unknown>)()
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('picks up a row queued while the last drain was finishing (stranding race)', async () => {
    // Drain A finds the queue empty; meanwhile row r9 is queued and its own
    // drain returned because A still held a slot. A's re-check finds it.
    let queued = 0
    a.count.mockImplementation((async (args: unknown) => (isInProgressCount(args) ? 0 : queued)) as never)
    a.findFirst
      .mockImplementationOnce((async () => { queued = 1; return null }) as never)
      .mockImplementationOnce((async () => ({ id: 'r9' })) as never)
      .mockResolvedValue(null)
    mockRun.mockImplementation(async () => { queued = 0; return 'complete' })
    expect(await drainProfileQueue('p1')).toBe(1)
    expect(ranIds()).toEqual(['r9'])
    expect(activeDrainCount('p1')).toBe(0)
  })

  it('stops re-checking after MAX_RESCHEDULES', async () => {
    a.count.mockImplementation((async (args: unknown) => (isInProgressCount(args) ? 0 : 1)) as never)
    a.findFirst.mockResolvedValue(null)
    await drainProfileQueue('p1')
    expect(mockTransaction).toHaveBeenCalledTimes(MAX_RESCHEDULES + 1)
  })

  it('does not re-drain in-process after stopping at the deadline', async () => {
    a.count.mockImplementation((async (args: unknown) => (isInProgressCount(args) ? 0 : 1)) as never)
    await drainProfileQueue('p1', { deadline: Date.now() })
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockContinue).toHaveBeenCalledOnce() // a fresh invocation takes over instead
  })
})

describe('queueJobAssessments (batch)', () => {
  beforeEach(() => {
    vi.mocked(prisma.jobApplication.findMany).mockResolvedValue([{ id: 'j1' }, { id: 'j2' }, { id: 'j3' }] as never)
    a.createManyAndReturn.mockImplementation((async (args: { data: unknown[] }) =>
      args.data.map((_, i) => ({ id: `as-${i}` }))) as never)
  })

  it('is a no-op when disabled', async () => {
    vi.stubEnv('JOB_ASSESSMENT_V2', 'off')
    expect(await queueJobAssessments('p1', ['j1'], { reason: 'backfill' })).toEqual({ queued: 0, reason: 'disabled' })
    expect(a.createManyAndReturn).not.toHaveBeenCalled()
    expect(mockAfter).not.toHaveBeenCalled()
  })

  it("skips jobs of other profiles and keeps the caller's order", async () => {
    vi.mocked(prisma.jobApplication.findMany).mockResolvedValueOnce([{ id: 'j3' }, { id: 'j1' }] as never)
    const res = await queueJobAssessments('p1', ['j3', 'jx', 'j1'], { reason: 'backfill' })
    expect(res).toEqual({ queued: 2, assessmentIds: ['as-0', 'as-1'] })
    expect(prisma.jobApplication.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['j3', 'jx', 'j1'] }, profileId: 'p1' }, select: { id: true },
    })
    const data = (a.createManyAndReturn.mock.calls[0][0] as { data: { jobApplicationId: string; createdAt: Date; profileId: string; status: string; pipelineVersion: string }[] }).data
    expect(data.map((d) => d.jobApplicationId)).toEqual(['j3', 'j1'])
    expect(data.every((d) => d.profileId === 'p1' && d.status === 'queued' && d.pipelineVersion === PIPELINE_VERSION)).toBe(true)
    // Oldest first at admission → j3 runs before j1.
    expect(data[0].createdAt.getTime()).toBeLessThan(data[1].createdAt.getTime())
  })

  it('supersedes queued rows of the same jobs before inserting', async () => {
    await queueJobAssessments('p1', ['j1', 'j2'], { reason: 'backfill' })
    expect(a.updateMany).toHaveBeenCalledWith({
      where: { profileId: 'p1', jobApplicationId: { in: ['j1', 'j2'] }, status: 'queued' },
      data: expect.objectContaining({ status: 'failed', failureKind: 'superseded' }),
    })
    expect(a.updateMany.mock.invocationCallOrder[0]).toBeLessThan(a.createManyAndReturn.mock.invocationCallOrder[0])
  })

  it('schedules ASSESSMENT_CONCURRENCY_PER_PROFILE drains in one after(), not one per job', async () => {
    await queueJobAssessments('p1', ['j1', 'j2', 'j3'], { reason: 'backfill' })
    expect(mockAfter).toHaveBeenCalledOnce()
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let n = 0
    a.findFirst.mockImplementation((async () => (n < 3 ? { id: `r${n++}` } : null)) as never)
    mockRun.mockImplementation(async () => { await gate; return 'complete' })
    const done = (mockAfter.mock.calls[0][0] as () => Promise<unknown>)()
    await vi.waitFor(() => expect(mockRun).toHaveBeenCalledTimes(ASSESSMENT_CONCURRENCY_PER_PROFILE))
    release()
    await done
    expect(mockRun).toHaveBeenCalledTimes(3)
  })

  it('queues nothing for an empty list', async () => {
    expect(await queueJobAssessments('p1', [], { reason: 'backfill' })).toEqual({ queued: 0, assessmentIds: [] })
    expect(mockAfter).not.toHaveBeenCalled()
  })
})

describe('drainProfileQueue — continuation', () => {
  /** Queued rows left after the drain (the non-admission count). */
  function queuedLeft(n: number) {
    a.count.mockImplementation((async (args: unknown) => (isInProgressCount(args) ? 0 : n)) as never)
  }

  it('continues after the deadline when rows are still queued', async () => {
    queuedLeft(3)
    a.findFirst.mockResolvedValue({ id: 'r1' } as never)
    await drainProfileQueue('p1', { deadline: Date.now() + MIN_RUN_START_MS - 1_000 })
    expect(mockContinue).toHaveBeenCalledWith('p1', 1)
  })

  it('continues after a run re-queued itself', async () => {
    queuedLeft(1)
    a.findFirst.mockResolvedValue({ id: 'r1' } as never)
    mockRun.mockResolvedValueOnce('requeued')
    await drainProfileQueue('p1', { continuation: 4 })
    expect(mockContinue).toHaveBeenCalledWith('p1', 5)
  })

  it('continues after MAX_RUNS_PER_DRAIN runs', async () => {
    queuedLeft(5)
    let n = 0
    a.findFirst.mockImplementation((async () => ({ id: `r${n++}` })) as never)
    await drainProfileQueue('p1')
    expect(mockContinue).toHaveBeenCalledWith('p1', 1)
  })

  it('does not continue when nothing is left queued', async () => {
    queuedLeft(0)
    a.findFirst.mockResolvedValue({ id: 'r1' } as never)
    await drainProfileQueue('p1', { deadline: Date.now() + MIN_RUN_START_MS - 1_000 })
    expect(mockContinue).not.toHaveBeenCalled()
  })

  it('does not continue at the hop limit', async () => {
    queuedLeft(3)
    await drainProfileQueue('p1', { deadline: Date.now() + MIN_RUN_START_MS - 1_000, continuation: MAX_CONTINUATIONS })
    expect(mockContinue).not.toHaveBeenCalled()
  })

  it('does not continue on limit, empty or stuck', async () => {
    queuedLeft(3)
    a.count.mockResolvedValueOnce(2) // admission: at the limit
    await drainProfileQueue('p1')
    expect(mockContinue).not.toHaveBeenCalled()

    a.findFirst.mockResolvedValue(null) // empty (its own re-check runs instead)
    await drainProfileQueue('p1', { depth: MAX_RESCHEDULES })
    expect(mockContinue).not.toHaveBeenCalled()

    a.findFirst.mockResolvedValue({ id: 'r1' } as never)
    mockRun.mockResolvedValueOnce('not_claimed') // stuck
    await drainProfileQueue('p1')
    expect(mockContinue).not.toHaveBeenCalled()
  })

  it("passes the hop through the 'empty' re-check, so a re-drain that hits the deadline continues the same chain", async () => {
    // First pass finds the queue empty while a row appears and time runs out;
    // the re-drain then stops on the deadline and must continue hop 7 → 8.
    let queued = 0
    const start = 1_000_000
    const deadline = start + MIN_RUN_START_MS + 1_000
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start)
    a.count.mockImplementation((async (args: unknown) => (isInProgressCount(args) ? 0 : queued)) as never)
    a.findFirst.mockImplementationOnce((async () => {
      queued = 1
      clock.mockReturnValue(deadline)
      return null
    }) as never)
    await drainProfileQueue('p1', { deadline, continuation: 7 })
    clock.mockRestore()
    expect(mockContinue).toHaveBeenCalledWith('p1', 8)
  })

  it('never throws when the continuation check fails', async () => {
    a.findFirst.mockResolvedValue({ id: 'r1' } as never)
    a.count.mockImplementation((async (args: unknown) => {
      if (isInProgressCount(args)) return 0
      throw new Error('db down')
    }) as never)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(drainProfileQueue('p1', { deadline: Date.now() + MIN_RUN_START_MS - 1_000 })).resolves.toBe(0)
    expect(mockContinue).not.toHaveBeenCalled()
    err.mockRestore()
  })
})

describe('insertQueuedAssessments', () => {
  it('uses the client it is given (e.g. a transaction) and schedules nothing', async () => {
    const tx = {
      jobApplication: { findMany: vi.fn(async () => [{ id: 'j1' }]) },
      jobAssessment: { updateMany: vi.fn(async () => ({ count: 0 })), createManyAndReturn: vi.fn(async () => [{ id: 'as-1' }]) },
    }
    expect(await insertQueuedAssessments(tx as never, 'p1', ['j1', 'jx'])).toEqual(['as-1'])
    expect(tx.jobApplication.findMany).toHaveBeenCalledWith({ where: { id: { in: ['j1', 'jx'] }, profileId: 'p1' }, select: { id: true } })
    expect(tx.jobAssessment.updateMany).toHaveBeenCalled()
    expect(a.createManyAndReturn).not.toHaveBeenCalled()
    expect(mockAfter).not.toHaveBeenCalled()
  })
})
