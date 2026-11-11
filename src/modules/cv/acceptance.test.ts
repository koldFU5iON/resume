import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: { cVDocument: { findFirst: vi.fn(), updateMany: vi.fn() } },
}))

import { prisma } from '@/lib/db'
import { acceptCV, acceptLatestCVForAppliedJob, unacceptCV } from './acceptance'

const findFirst = vi.mocked(prisma.cVDocument.findFirst)
const updateMany = vi.mocked(prisma.cVDocument.updateMany)
const now = new Date('2026-11-11T12:00:00Z')

beforeEach(() => vi.resetAllMocks())

describe('acceptCV', () => {
  it("accepts the profile's own draft job CV, recorded as manual", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 })
    expect(await acceptCV('p1', 'cv-1', now)).toEqual({ ok: true, acceptedAt: now })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'cv-1', profileId: 'p1', status: 'draft', jobApplicationId: { not: null } },
      data: { status: 'accepted', acceptedAt: now, acceptedVia: 'manual' },
    })
  })

  it.each([
    [null, 'not_found'],
    [{ status: 'draft', jobApplicationId: null }, 'no_job'],
    [{ status: 'accepted', jobApplicationId: 'job-1' }, 'already_accepted'],
    [{ status: 'generating', jobApplicationId: 'job-1' }, 'not_ready'],
    [{ status: 'failed', jobApplicationId: 'job-1' }, 'not_ready'],
  ])('explains why nothing changed (%o → %s)', async (doc, reason) => {
    updateMany.mockResolvedValueOnce({ count: 0 })
    findFirst.mockResolvedValueOnce(doc as never)
    expect(await acceptCV('p1', 'cv-1', now)).toEqual({ ok: false, reason })
    expect(findFirst.mock.calls[0][0]).toMatchObject({ where: { id: 'cv-1', profileId: 'p1' } })
  })
})

describe('unacceptCV', () => {
  it('puts an accepted CV back to draft and clears how/when it was accepted', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 })
    expect(await unacceptCV('p1', 'cv-1')).toBe(true)
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'cv-1', profileId: 'p1', status: 'accepted' },
      data: { status: 'draft', acceptedAt: null, acceptedVia: null },
    })
  })

  it('reports false for a CV that is not accepted or not owned', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 })
    expect(await unacceptCV('p1', 'cv-x')).toBe(false)
  })
})

describe('acceptLatestCVForAppliedJob', () => {
  it("accepts the job's newest draft, only if the job has no accepted CV", async () => {
    findFirst.mockResolvedValueOnce({ id: 'cv-new' } as never)
    updateMany.mockResolvedValueOnce({ count: 1 })

    expect(await acceptLatestCVForAppliedJob('p1', 'job-1', now)).toBe('cv-new')
    expect(findFirst).toHaveBeenCalledWith({
      where: { profileId: 'p1', jobApplicationId: 'job-1', status: 'draft' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'cv-new',
        profileId: 'p1',
        jobApplicationId: 'job-1',
        status: 'draft',
        jobApplication: { profileId: 'p1', cvDocuments: { none: { status: 'accepted' } } },
      },
      data: { status: 'accepted', acceptedAt: now, acceptedVia: 'applied' },
    })
  })

  it('does nothing when the job has no draft CV (none, failed or still generating)', async () => {
    findFirst.mockResolvedValueOnce(null)
    expect(await acceptLatestCVForAppliedJob('p1', 'job-1', now)).toBeNull()
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('does nothing when a CV is already accepted (the guarded update matches no row)', async () => {
    findFirst.mockResolvedValueOnce({ id: 'cv-new' } as never)
    updateMany.mockResolvedValueOnce({ count: 0 })
    expect(await acceptLatestCVForAppliedJob('p1', 'job-1', now)).toBeNull()
  })
})
