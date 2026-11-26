import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  requireProfile: vi.fn().mockResolvedValue({ profile: { id: 'profile-1' } }),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    cVDocument: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    jobApplication: { findFirst: vi.fn() },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { markCVAccepted } from './actions'
import { prisma } from '@/lib/db'

const mockFindFirst = vi.mocked(prisma.cVDocument.findFirst)

describe('markCVAccepted', () => {
  beforeEach(() => vi.clearAllMocks())

  it("accepts the signed-in profile's CV", async () => {
    vi.mocked(prisma.cVDocument.updateMany).mockResolvedValue({ count: 1 })
    await markCVAccepted('cv-1')
    expect(vi.mocked(prisma.cVDocument.updateMany).mock.calls[0][0].where).toMatchObject({ id: 'cv-1', profileId: 'profile-1' })
  })

  it('throws a readable error when the CV is still a draft without a job', async () => {
    vi.mocked(prisma.cVDocument.updateMany).mockResolvedValue({ count: 0 })
    mockFindFirst.mockResolvedValue({ status: 'draft', jobApplication: null } as never)
    await expect(markCVAccepted('cv-1')).rejects.toThrow('Only a CV for a job can be accepted.')
  })
})
