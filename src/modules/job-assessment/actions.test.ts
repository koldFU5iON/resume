import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  requireProfile: vi.fn().mockResolvedValue({ profile: { id: 'p1' } }),
}))
vi.mock('@/lib/db', () => ({ prisma: { jobApplication: { findFirst: vi.fn() } } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('./queue', () => ({ queueJobAssessment: vi.fn() }))

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { rerunJobAssessment } from './actions'
import { queueJobAssessment } from './queue'

const mockFind = vi.mocked(prisma.jobApplication.findFirst)
const mockQueue = vi.mocked(queueJobAssessment)

beforeEach(() => {
  vi.clearAllMocks()
  mockFind.mockResolvedValue({ id: 'job-1' } as never)
  mockQueue.mockResolvedValue({ queued: true, assessmentId: 'as-1' })
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
