import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  requireProfile: vi.fn().mockResolvedValue({ profile: { id: 'p1' } }),
}))
vi.mock('@/lib/db', () => ({ prisma: { jobApplication: { findFirst: vi.fn() } } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('./queue', () => ({ queueJobAssessment: vi.fn(), isAssessmentEnabledFor: vi.fn() }))
vi.mock('./backfill', () => ({ startBackfill: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { rerunJobAssessment, startAssessmentBackfill } from './actions'
import { startBackfill } from './backfill'
import { isAssessmentEnabledFor, queueJobAssessment } from './queue'

const mockFind = vi.mocked(prisma.jobApplication.findFirst)
const mockQueue = vi.mocked(queueJobAssessment)
const mockEnabled = vi.mocked(isAssessmentEnabledFor)
const mockBackfill = vi.mocked(startBackfill)

beforeEach(() => {
  vi.clearAllMocks()
  mockFind.mockResolvedValue({ id: 'job-1' } as never)
  mockQueue.mockResolvedValue({ queued: true, assessmentId: 'as-1' })
  mockEnabled.mockResolvedValue(true)
  mockBackfill.mockResolvedValue({ ok: true, queued: 12, remaining: 0, limitedBy: 'none' })
})

describe('rerunJobAssessment', () => {
  it('queues a manual run for an owned job and revalidates the list and detail', async () => {
    expect(await rerunJobAssessment('job-1')).toEqual({ ok: true })
    expect(mockFind).toHaveBeenCalledWith({ where: { id: 'job-1', profileId: 'p1' }, select: { id: true } })
    expect(mockQueue).toHaveBeenCalledWith('p1', 'job-1', { reason: 'manual' })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/job-applications')
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/job-applications/view/job-1')
  })

  it("refuses another user's job", async () => {
    mockFind.mockResolvedValueOnce(null)
    expect(await rerunJobAssessment('job-x')).toEqual({ ok: false, error: 'Job not found' })
    expect(mockQueue).not.toHaveBeenCalled()
  })

  it('reports a disabled feature', async () => {
    mockQueue.mockResolvedValueOnce({ queued: false, reason: 'disabled' })
    expect(await rerunJobAssessment('job-1')).toEqual({ ok: false, error: 'Early assessment is not enabled' })
  })

  it('reports a queue failure without throwing', async () => {
    mockQueue.mockRejectedValueOnce(new Error('db down'))
    expect(await rerunJobAssessment('job-1')).toMatchObject({ ok: false })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('startAssessmentBackfill', () => {
  it("starts a backfill for the signed-in user's profile and revalidates", async () => {
    expect(await startAssessmentBackfill()).toEqual({ ok: true, queued: 12, remaining: 0, limitedBy: 'none' })
    expect(requireProfile).toHaveBeenCalled()
    expect(mockEnabled).toHaveBeenCalledWith('p1')
    expect(mockBackfill).toHaveBeenCalledWith('p1', { requestStartedAt: expect.any(Number) })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/job-applications')
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/settings')
  })

  it('is refused when the feature is off for the profile', async () => {
    mockEnabled.mockResolvedValueOnce(false)
    expect(await startAssessmentBackfill()).toEqual({ ok: false, error: 'Early assessment is not enabled' })
    expect(mockBackfill).not.toHaveBeenCalled()
  })

  it('passes a refusal through (e.g. runs still pending) without revalidating', async () => {
    mockBackfill.mockResolvedValueOnce({ ok: false, error: 'Assessments are still running.' })
    expect(await startAssessmentBackfill()).toEqual({ ok: false, error: 'Assessments are still running.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('reports a DB failure without throwing', async () => {
    mockBackfill.mockRejectedValueOnce(new Error('db down'))
    expect(await startAssessmentBackfill()).toMatchObject({ ok: false })
  })
})
