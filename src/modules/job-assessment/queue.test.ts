import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    profile: { findUnique: vi.fn() },
    jobApplication: { findFirst: vi.fn() },
    jobAssessment: { updateMany: vi.fn(), create: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/session', () => ({ isAdminUser: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('./run', () => ({ runJobAssessment: vi.fn() }))

import { after } from 'next/server'
import { prisma } from '@/lib/db'
import { isAdminUser } from '@/lib/session'
import {
  activeDrainCount,
  assessmentFlag,
  drainProfileQueue,
  isAssessmentEnabledFor,
  MAX_RUNS_PER_DRAIN,
  queueJobAssessment,
  queueJobAssessmentSafely,
} from './queue'
import { runJobAssessment } from './run'
import { PIPELINE_VERSION } from './schema'

const mockAfter = vi.mocked(after)
const mockAdmin = vi.mocked(isAdminUser)
const mockRun = vi.mocked(runJobAssessment)
const a = vi.mocked(prisma.jobAssessment)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('TYPESAFE_API_KEY', 'ts-test')
  vi.stubEnv('JOB_ASSESSMENT_V2', 'all')
  vi.mocked(prisma.profile.findUnique).mockResolvedValue({ userId: 'u1' } as never)
  vi.mocked(prisma.jobApplication.findFirst).mockResolvedValue({ id: 'job-1' } as never)
  a.updateMany.mockResolvedValue({ count: 0 })
  a.create.mockResolvedValue({ id: 'as-1' } as never)
  a.count.mockResolvedValue(0)
  a.findFirst.mockResolvedValue(null)
  mockAdmin.mockResolvedValue(false)
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

describe('drainProfileQueue', () => {
  it('runs queued rows oldest first until none are left', async () => {
    a.findFirst
      .mockResolvedValueOnce({ id: 'r1' } as never)
      .mockResolvedValueOnce({ id: 'r2' } as never)
      .mockResolvedValueOnce(null)
    mockRun.mockResolvedValue('complete')
    expect(await drainProfileQueue('p1')).toBe(2)
    expect(mockRun.mock.calls.map((c) => c[0])).toEqual(['r1', 'r2'])
    expect(a.findFirst).toHaveBeenCalledWith({
      where: { profileId: 'p1', status: 'queued' }, orderBy: { createdAt: 'asc' }, select: { id: true },
    })
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

  it('returns when the profile already has the limit of runs in progress', async () => {
    a.count.mockResolvedValueOnce(2)
    expect(await drainProfileQueue('p1')).toBe(0)
    expect(a.count).toHaveBeenCalledWith({
      where: { profileId: 'p1', status: { in: ['checking', 'fetching', 'assessing'] }, startedAt: { gte: expect.any(Date) } },
    })
    expect(a.findFirst).not.toHaveBeenCalled()
    expect(activeDrainCount('p1')).toBe(0)
  })

  it('caps concurrent drains per profile in this instance', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    a.findFirst.mockResolvedValueOnce({ id: 'r1' } as never).mockResolvedValueOnce({ id: 'r2' } as never).mockResolvedValue(null)
    mockRun.mockImplementation(async () => { await gate; return 'complete' })

    const d1 = drainProfileQueue('p1')
    const d2 = drainProfileQueue('p1')
    await vi.waitFor(() => expect(mockRun).toHaveBeenCalledTimes(2))
    expect(activeDrainCount('p1')).toBe(2)
    expect(await drainProfileQueue('p1')).toBe(0) // third drain: limit reached
    release()
    await Promise.all([d1, d2])
    expect(activeDrainCount('p1')).toBe(0)
  })

  it('skips rows another drain claimed, and stops if the same row keeps failing to claim', async () => {
    a.findFirst.mockResolvedValue({ id: 'r1' } as never)
    mockRun.mockResolvedValue('not_claimed')
    expect(await drainProfileQueue('p1')).toBe(0)
    expect(mockRun).toHaveBeenCalledTimes(2)
  })

  it('stops after MAX_RUNS_PER_DRAIN runs', async () => {
    let n = 0
    a.findFirst.mockImplementation((async () => ({ id: `r${n++}` })) as never)
    mockRun.mockResolvedValue('complete')
    expect(await drainProfileQueue('p1')).toBe(MAX_RUNS_PER_DRAIN)
  })

  it('never throws on a DB error', async () => {
    a.count.mockRejectedValueOnce(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(drainProfileQueue('p1')).resolves.toBe(0)
    expect(activeDrainCount('p1')).toBe(0)
    err.mockRestore()
  })
})
