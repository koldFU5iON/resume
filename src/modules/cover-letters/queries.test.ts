import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    coverLetterDocument: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}))

import { listCoverLetters, getCoverLetter } from './queries'
import { prisma } from '@/lib/db'

const mockFindMany = vi.mocked(prisma.coverLetterDocument.findMany)
const mockFindFirst = vi.mocked(prisma.coverLetterDocument.findFirst)

describe('listCoverLetters', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries by profileId ordered by updatedAt desc', async () => {
    mockFindMany.mockResolvedValue([])
    await listCoverLetters('profile-1')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { profileId: 'profile-1' },
        orderBy: { updatedAt: 'desc' },
      })
    )
  })

  it('returns all letters', async () => {
    const rows = [
      { id: 'cl-1', jobTitle: 'PM', company: 'Acme', status: 'draft', content: 'Dear…', jobApplicationId: null, createdAt: new Date(), updatedAt: new Date() },
      { id: 'cl-2', jobTitle: 'Head of Product', company: 'Stripe', status: 'draft', content: '', jobApplicationId: 'job-1', createdAt: new Date(), updatedAt: new Date() },
    ]
    mockFindMany.mockResolvedValue(rows as never)
    const result = await listCoverLetters('profile-1')
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('cl-1')
  })
})

describe('getCoverLetter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns null when not found', async () => {
    mockFindFirst.mockResolvedValue(null)
    const result = await getCoverLetter('profile-1', 'cl-none')
    expect(result).toBeNull()
  })

  it('queries by id and profileId', async () => {
    mockFindFirst.mockResolvedValue(null)
    await getCoverLetter('profile-1', 'cl-1')
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cl-1', profileId: 'profile-1' },
      })
    )
  })

  it('returns letter with nested jobApplication', async () => {
    const row = {
      id: 'cl-1',
      content: 'Hello',
      status: 'draft',
      jobTitle: 'PM',
      company: 'Acme',
      jobApplicationId: 'job-1',
      jobApplication: {
        id: 'job-1',
        title: 'PM',
        company: 'Acme',
        status: 'applied',
        jobAnalysis: null,
        jobDescription: null,
      },
    }
    mockFindFirst.mockResolvedValue(row as never)
    const result = await getCoverLetter('profile-1', 'cl-1')
    expect(result?.jobApplication?.id).toBe('job-1')
  })
})
