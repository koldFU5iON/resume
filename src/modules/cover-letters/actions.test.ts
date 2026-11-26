import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  requireProfile: vi.fn().mockResolvedValue({
    profile: {
      id: 'profile-1',
      name: 'Test User',
      headline: 'Software Engineer',
      email: 'test@example.com',
      phone: null,
      linkedIn: null,
      website: null,
    },
  }),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    coverLetterDocument: {
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
    },
    jobApplication: {
      findFirst: vi.fn(),
    },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { updateCoverLetterContent, deleteCoverLetter, linkJobToCoverLetter, updateCoverLetterSection } from './actions'
import { prisma } from '@/lib/db'

const mockUpdateMany = vi.mocked(prisma.coverLetterDocument.updateMany)
const mockDeleteMany = vi.mocked(prisma.coverLetterDocument.deleteMany)
const mockFindFirst = vi.mocked(prisma.coverLetterDocument.findFirst)
const mockJobFind = vi.mocked(prisma.jobApplication.findFirst)

describe('updateCoverLetterContent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates content with profileId auth guard', async () => {
    mockFindFirst.mockResolvedValueOnce({ sections: '[]' } as never)
    mockUpdateMany.mockResolvedValue({ count: 1 })
    await updateCoverLetterContent('cl-1', 'Dear Hiring Manager,')
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cl-1', profileId: 'profile-1' },
        data: expect.objectContaining({ content: 'Dear Hiring Manager,' }),
      })
    )
  })

  it('throws when cover letter not found for this profile', async () => {
    mockFindFirst.mockResolvedValueOnce(null)
    await expect(updateCoverLetterContent('cl-none', 'text')).rejects.toThrow('Cover letter not found')
  })
})

describe('linkJobToCoverLetter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('links job and copies title/company with auth guards', async () => {
    mockJobFind.mockResolvedValue({ title: 'Staff Engineer', company: 'Acme' } as never)
    mockUpdateMany.mockResolvedValue({ count: 1 })
    const result = await linkJobToCoverLetter('cl-1', 'job-1')
    expect(mockJobFind).toHaveBeenCalledWith({
      where: { id: 'job-1', profileId: 'profile-1' },
      select: { title: true, company: true },
    })
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'cl-1', profileId: 'profile-1' },
      data: { jobApplicationId: 'job-1', jobTitle: 'Staff Engineer', company: 'Acme' },
    })
    expect(result).toEqual({ jobTitle: 'Staff Engineer', company: 'Acme' })
  })

  it('throws when the job does not belong to this profile', async () => {
    mockJobFind.mockResolvedValue(null)
    await expect(linkJobToCoverLetter('cl-1', 'job-x')).rejects.toThrow('Job not found')
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it('throws when the cover letter is not found for this profile', async () => {
    mockJobFind.mockResolvedValue({ title: 'PM', company: null } as never)
    mockUpdateMany.mockResolvedValue({ count: 0 })
    await expect(linkJobToCoverLetter('cl-none', 'job-1')).rejects.toThrow('Cover letter not found')
  })
})

describe('deleteCoverLetter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes with profileId auth guard', async () => {
    mockDeleteMany.mockResolvedValue({ count: 1 })
    await deleteCoverLetter('cl-1')
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { id: 'cl-1', profileId: 'profile-1' },
    })
  })

  it('throws when cover letter not found for this profile', async () => {
    mockDeleteMany.mockResolvedValue({ count: 0 })
    await expect(deleteCoverLetter('cl-none')).rejects.toThrow('Cover letter not found')
  })
})

describe('updateCoverLetterContent — sections derivation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('derives sections from content split on double newline', async () => {
    mockFindFirst.mockResolvedValueOnce({ sections: '[]' } as never)
    mockUpdateMany.mockResolvedValueOnce({ count: 1 })
    await updateCoverLetterContent('cl-1', 'Para one.\n\nPara two.')
    const call = mockUpdateMany.mock.calls[0][0] as { data: { sections: string } }
    const sections = JSON.parse(call.data.sections) as Array<{ id: string; content: string }>
    expect(sections).toHaveLength(2)
    expect(sections[0].content).toBe('Para one.')
    expect(sections[1].content).toBe('Para two.')
    expect(sections[0].id).toBeTruthy()
  })

  it('preserves existing IDs for unchanged paragraphs', async () => {
    const existing = [{ id: 'id-1', content: 'Opening.' }, { id: 'id-2', content: 'Closing.' }]
    mockFindFirst.mockResolvedValueOnce({ sections: JSON.stringify(existing) } as never)
    mockUpdateMany.mockResolvedValueOnce({ count: 1 })
    await updateCoverLetterContent('cl-1', 'Opening.\n\nNew middle.\n\nClosing.')
    const call = mockUpdateMany.mock.calls[0][0] as { data: { sections: string } }
    const sections = JSON.parse(call.data.sections) as Array<{ id: string; content: string }>
    expect(sections[0].id).toBe('id-1')
    expect(sections[1].id).not.toBe('id-1')
    expect(sections[2].id).toBe('id-2')
  })
})

describe('updateCoverLetterSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('replaces a section by id and rebuilds content', async () => {
    const existing = [
      { id: 'sec-a', content: 'Dear Hiring Manager,' },
      { id: 'sec-b', content: 'I am writing...' },
    ]
    mockFindFirst.mockResolvedValueOnce({ sections: JSON.stringify(existing) } as never)
    mockUpdateMany.mockResolvedValueOnce({ count: 1 })
    await updateCoverLetterSection('cl-1', 'sec-b', 'I am excited to apply...')
    const call = mockUpdateMany.mock.calls[0][0] as { data: { content: string; sections: string } }
    expect(call.data.content).toBe('Dear Hiring Manager,\n\nI am excited to apply...')
    const sections = JSON.parse(call.data.sections) as Array<{ id: string; content: string }>
    expect(sections[1]).toEqual({ id: 'sec-b', content: 'I am excited to apply...' })
  })

  it('throws when section id not found', async () => {
    mockFindFirst.mockResolvedValueOnce({ sections: '[]' } as never)
    await expect(updateCoverLetterSection('cl-1', 'missing', 'text')).rejects.toThrow('Section not found')
  })
})
