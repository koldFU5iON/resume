import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    skill: { findMany: vi.fn().mockResolvedValue([]) },
    experience: { findMany: vi.fn().mockResolvedValue([]) },
    project: { findMany: vi.fn().mockResolvedValue([]) },
    education: { findMany: vi.fn().mockResolvedValue([]) },
    certification: { findMany: vi.fn().mockResolvedValue([]) },
    jobApplication: {
      findUnique: vi.fn(),
    },
    cVDocument: { findUnique: vi.fn() },
    interviewPrepSession: { findUnique: vi.fn() },
    coverLetterDocument: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/utils', () => ({
  parseJsonField: vi.fn().mockReturnValue([]),
}))

import { assertOwnership } from './tools'
import { prisma } from '@/lib/db'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('assertOwnership', () => {
  it('passes when resource belongs to profileId', async () => {
    vi.mocked(prisma.jobApplication.findUnique).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { profileId: 'profile-1' } as any,
    )
    await expect(
      assertOwnership('jobApplication', 'job-1', 'profile-1'),
    ).resolves.toBeUndefined()
  })

  it('throws when resource belongs to a different profileId', async () => {
    vi.mocked(prisma.jobApplication.findUnique).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { profileId: 'profile-2' } as any,
    )
    await expect(
      assertOwnership('jobApplication', 'job-1', 'profile-1'),
    ).rejects.toThrow('Resource not found or access denied')
  })

  it('throws when resource does not exist', async () => {
    vi.mocked(prisma.jobApplication.findUnique).mockResolvedValue(null)
    await expect(
      assertOwnership('jobApplication', 'nonexistent', 'profile-1'),
    ).rejects.toThrow('Resource not found or access denied')
  })
})

describe('retired CV edit tools (#469)', () => {
  it('no longer offers propose_cv_update or propose_cv_section_create', async () => {
    const { createChatTools } = await import('./tools')
    const tools = createChatTools('profile-1') as Record<string, unknown>
    expect(tools).not.toHaveProperty('propose_cv_update')
    expect(tools).not.toHaveProperty('propose_cv_section_create')
  })
})
