import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => {
  const cvGeneration = { findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), updateMany: vi.fn() }
  const tx = { $executeRaw: vi.fn(), cvGeneration }
  return {
    prisma: {
      jobApplication: { findFirst: vi.fn() },
      cvGeneration,
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      $executeRaw: tx.$executeRaw,
    },
  }
})

import { prisma } from '@/lib/db'
import { ACTIVE_STATUSES, CV_GENERATION_CONCURRENCY_PER_PROFILE, CV_GENERATION_STALE_MS, CV_GENERATION_STATUSES } from './schema'
import { FAILURE_MESSAGES, allowedFrom, createCvGenerationRun, failRun, setStatus, updateActive } from './run'
import { FAILURE_KINDS } from './schema'

const db = vi.mocked(prisma, { deep: true })

beforeEach(() => {
  vi.clearAllMocks()
  db.jobApplication.findFirst.mockResolvedValue({ id: 'job-1' } as never)
  db.cvGeneration.findFirst.mockResolvedValue(null)
  db.cvGeneration.count.mockResolvedValue(0)
  db.cvGeneration.create.mockResolvedValue({ id: 'run-1' } as never)
  db.cvGeneration.updateMany.mockResolvedValue({ count: 1 })
})

describe('allowedFrom', () => {
  it('lets a stage start only from earlier active statuses', () => {
    expect(allowedFrom('gathering')).toEqual(['queued'])
    expect(allowedFrom('briefing')).toEqual(['queued', 'gathering'])
    expect(allowedFrom('landing')).toEqual(ACTIVE_STATUSES.slice(0, -1))
  })

  it('reaches complete and failed from any active status, and never queued', () => {
    expect(allowedFrom('complete')).toEqual(ACTIVE_STATUSES)
    expect(allowedFrom('failed')).toEqual(ACTIVE_STATUSES)
    expect(allowedFrom('queued')).toEqual([])
  })

  it('never allows a move out of a finished status or to the same status', () => {
    for (const target of CV_GENERATION_STATUSES) {
      const from = allowedFrom(target)
      expect(from).not.toContain('complete')
      expect(from).not.toContain('failed')
      if (target !== 'complete' && target !== 'failed') expect(from).not.toContain(target)
    }
  })
})

describe('setStatus', () => {
  it('updates guarded by the statuses it may come from and writes the data with the new status', async () => {
    const startedAt = new Date()
    expect(await setStatus('p1', 'run-1', 'gathering', { startedAt })).toBe(true)
    expect(db.cvGeneration.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', profileId: 'p1', status: { in: ['queued'] }, createdAt: { gte: expect.any(Date) } },
      data: { startedAt, status: 'gathering' },
    })
  })

  it('returns false when the run is gone, finished or already past (nothing matched)', async () => {
    db.cvGeneration.updateMany.mockResolvedValue({ count: 0 })
    expect(await setStatus('p1', 'run-1', 'briefing')).toBe(false)
  })

  it('does not let data override the status', async () => {
    await setStatus('p1', 'run-1', 'selecting', { status: 'complete' } as never)
    expect(db.cvGeneration.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'selecting' } }))
  })

  it('refuses a move to queued without touching the database', async () => {
    expect(await setStatus('p1', 'run-1', 'queued')).toBe(false)
    expect(db.cvGeneration.updateMany).not.toHaveBeenCalled()
  })
})

describe('updateActive and failRun', () => {
  it('only writes a run that is still active', async () => {
    expect(await updateActive('p1', 'run-1', { log: { entries: [] } })).toBe(true)
    expect(db.cvGeneration.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', profileId: 'p1', status: { in: [...ACTIVE_STATUSES] }, createdAt: { gte: expect.any(Date) } },
      data: { log: { entries: [] } },
    })
  })

  it('never writes a run of another profile or one past the stale window', async () => {
    await updateActive('p1', 'run-1', { log: {} })
    const where = (db.cvGeneration.updateMany.mock.calls[0][0] as { where: { profileId: string; createdAt: { gte: Date } } }).where
    expect(where.profileId).toBe('p1')
    expect(Date.now() - where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(CV_GENERATION_STALE_MS - 1000)
  })

  it('records a failure with the kind’s default message and a completion time', async () => {
    expect(await failRun('p1', 'run-1', 'no_llm_key', null, { stageTimings: { gather: 5 } })).toBe(true)
    const call = db.cvGeneration.updateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({
      status: 'failed', failureKind: 'no_llm_key', failureMessage: FAILURE_MESSAGES.no_llm_key, stageTimings: { gather: 5 },
    })
    expect(call.data.completedAt).toBeInstanceOf(Date)
  })

  it('never throws when the write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.cvGeneration.updateMany.mockRejectedValue(new Error('db down'))
    expect(await failRun('p1', 'run-1', 'error', 'boom')).toBe(false)
  })

  it('has a message for every failure kind', () => {
    for (const k of FAILURE_KINDS) expect(FAILURE_MESSAGES[k]).toBeTruthy()
  })
})

describe('createCvGenerationRun', () => {
  it('inserts a queued row under the per-profile lock', async () => {
    expect(await createCvGenerationRun('p1', 'job-1')).toEqual({ kind: 'created', runId: 'run-1' })
    expect(db.$executeRaw).toHaveBeenCalled()
    expect(db.cvGeneration.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { profileId: 'p1', jobApplicationId: 'job-1', status: 'queued', deepDiveId: null },
    }))
  })

  it('records the source deep dive when given one', async () => {
    await createCvGenerationRun('p1', 'job-1', { deepDiveId: 'dd-1' })
    expect(db.cvGeneration.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ deepDiveId: 'dd-1' }),
    }))
  })

  it('filters the job by profile and creates nothing for a job that isn’t theirs', async () => {
    db.jobApplication.findFirst.mockResolvedValue(null)
    expect(await createCvGenerationRun('p1', 'job-x')).toEqual({ kind: 'not_found' })
    expect(db.jobApplication.findFirst).toHaveBeenCalledWith({ where: { id: 'job-x', profileId: 'p1' }, select: { id: true } })
    expect(db.cvGeneration.create).not.toHaveBeenCalled()
  })

  it('returns the live run of the job instead of starting a second', async () => {
    db.cvGeneration.findFirst.mockResolvedValue({ id: 'run-0' } as never)
    expect(await createCvGenerationRun('p1', 'job-1')).toEqual({ kind: 'existing', runId: 'run-0' })
    expect(db.cvGeneration.create).not.toHaveBeenCalled()
  })

  it('refuses at the per-profile concurrency limit, counting only live active runs', async () => {
    db.cvGeneration.count.mockResolvedValue(CV_GENERATION_CONCURRENCY_PER_PROFILE)
    expect(await createCvGenerationRun('p1', 'job-1')).toEqual({ kind: 'limit' })
    expect(db.cvGeneration.count).toHaveBeenCalledWith({
      where: { profileId: 'p1', status: { in: [...ACTIVE_STATUSES] }, createdAt: { gte: expect.any(Date) } },
    })
  })
})
