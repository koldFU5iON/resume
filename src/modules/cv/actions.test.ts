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
vi.mock('./generate', () => ({ generateCVContent: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { addCustomSection, reorderSections, patchCVSectionData, regenerateCVContent, markCVAccepted, createAndGenerateCV } from './actions'
import { prisma } from '@/lib/db'
import { generateCVContent } from './generate'
import type { CVDocumentContent } from './schema'

const mockFindFirst = vi.mocked(prisma.cVDocument.findFirst)
const mockUpdate = vi.mocked(prisma.cVDocument.update)

function contentWith(sections: CVDocumentContent['sections']): string {
  return JSON.stringify({ version: 1, sections })
}

function savedContent(): CVDocumentContent {
  const call = mockUpdate.mock.calls[0][0]
  return JSON.parse((call.data as { generatedContent: string }).generatedContent)
}

const header = { id: 's1', type: 'header' as const, visible: true, data: { name: 'A', headline: 'B', contact: {} } }
const skills = { id: 's2', type: 'skills' as const, visible: true, data: { items: [] } }
const tools = { id: 's3', type: 'tools' as const, visible: true, data: { items: [] } }

describe('addCustomSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('appends to the end when no insertIndex is given', async () => {
    mockFindFirst.mockResolvedValue({ id: 'cv-1', generatedContent: contentWith([header]) } as never)
    mockUpdate.mockResolvedValue({} as never)

    await addCustomSection('cv-1', 'Awards', 'list')

    const saved = savedContent()
    expect(saved.sections).toHaveLength(2)
    expect(saved.sections[1].type).toBe('custom')
    expect((saved.sections[1] as { data: { heading: string } }).data.heading).toBe('Awards')
  })

  it('inserts at the given index', async () => {
    mockFindFirst.mockResolvedValue({ id: 'cv-1', generatedContent: contentWith([header, skills]) } as never)
    mockUpdate.mockResolvedValue({} as never)

    await addCustomSection('cv-1', 'Awards', 'text', 1)

    const saved = savedContent()
    expect(saved.sections.map(s => s.id)).toEqual(['s1', saved.sections[1].id, 's2'])
    expect(saved.sections[1].type).toBe('custom')
  })

  it('clamps an out-of-range insertIndex to the end', async () => {
    mockFindFirst.mockResolvedValue({ id: 'cv-1', generatedContent: contentWith([header]) } as never)
    mockUpdate.mockResolvedValue({} as never)

    await addCustomSection('cv-1', 'Awards', 'text', 99)

    const saved = savedContent()
    expect(saved.sections).toHaveLength(2)
    expect(saved.sections[0].id).toBe('s1')
  })

  it('clamps a negative insertIndex to the start', async () => {
    mockFindFirst.mockResolvedValue({ id: 'cv-1', generatedContent: contentWith([header]) } as never)
    mockUpdate.mockResolvedValue({} as never)

    await addCustomSection('cv-1', 'Awards', 'text', -5)

    const saved = savedContent()
    expect(saved.sections[0].type).toBe('custom')
    expect(saved.sections[1].id).toBe('s1')
  })
})

describe('reorderSections', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reorders sections to match the given id order', async () => {
    mockFindFirst.mockResolvedValue({ id: 'cv-1', generatedContent: contentWith([header, skills, tools]) } as never)
    mockUpdate.mockResolvedValue({} as never)

    await reorderSections('cv-1', ['s3', 's1', 's2'])

    const saved = savedContent()
    expect(saved.sections.map(s => s.id)).toEqual(['s3', 's1', 's2'])
  })

  it('throws when the id list is not a permutation of current sections', async () => {
    mockFindFirst.mockResolvedValue({ id: 'cv-1', generatedContent: contentWith([header, skills]) } as never)

    await expect(reorderSections('cv-1', ['s1'])).rejects.toThrow('Section list out of sync')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('throws when the id list contains an unknown id', async () => {
    mockFindFirst.mockResolvedValue({ id: 'cv-1', generatedContent: contentWith([header, skills]) } as never)

    await expect(reorderSections('cv-1', ['s1', 'unknown'])).rejects.toThrow('Section list out of sync')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('throws when the id list contains a duplicate id', async () => {
    mockFindFirst.mockResolvedValue({ id: 'cv-1', generatedContent: contentWith([header, skills]) } as never)

    await expect(reorderSections('cv-1', ['s1', 's1'])).rejects.toThrow('Section list out of sync')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('throws when the CV is not found', async () => {
    mockFindFirst.mockResolvedValue(null)
    await expect(reorderSections('cv-missing', [])).rejects.toThrow('CV not found')
  })
})

describe('patchCVSectionData', () => {
  const exp = {
    id: 'exp-1',
    type: 'experience' as const,
    visible: true,
    data: {
      company: 'Acme',
      titles: ['PM'],
      location: 'Remote',
      duration: '2020–2024',
      description: 'Built things.',
      outcomes: ['Shipped 10x'],
    },
  }

  beforeEach(() => vi.clearAllMocks())

  it('writes a full valid proposal', async () => {
    mockFindFirst.mockResolvedValue({ id: 'cv-1', generatedContent: contentWith([header, exp]) } as never)
    mockUpdate.mockResolvedValue({} as never)

    await patchCVSectionData('cv-1', 'exp-1', {
      ...exp.data,
      description: 'Rebuilt everything.',
    })

    const saved = savedContent()
    expect(saved.sections).toHaveLength(2)
    const section = saved.sections[1] as { data: Record<string, unknown> }
    expect(section.data.description).toBe('Rebuilt everything.')
    expect(section.data.outcomes).toEqual(['Shipped 10x'])
  })

  it('rejects a malformed proposal without writing (no CV corruption)', async () => {
    mockFindFirst.mockResolvedValue({ id: 'cv-1', generatedContent: contentWith([header, exp]) } as never)

    await expect(
      patchCVSectionData('cv-1', 'exp-1', { outcomes: 'not-an-array' }),
    ).rejects.toThrow('was not applied')

    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('throws Section not found when the section is missing', async () => {
    mockFindFirst.mockResolvedValue({ id: 'cv-1', generatedContent: contentWith([header]) } as never)

    await expect(patchCVSectionData('cv-1', 'nope', {})).rejects.toThrow('Section not found')
  })
})

describe('regenerateCVContent', () => {
  const generated = { version: 1, sections: [header] } as unknown as CVDocumentContent
  const base = {
    id: 'cv-1', jobApplicationId: 'job-1', careerVerticalId: null, templateId: 'default',
    jobDescription: 'JD', jobTitle: 'PM', company: 'Acme',
  }
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(generateCVContent).mockResolvedValue({ content: generated, masterUpdatedAt: null } as never)
  })

  it('overwrites a draft CV in place', async () => {
    mockFindFirst.mockResolvedValue({ ...base, status: 'draft' } as never)
    mockUpdate.mockResolvedValue({ id: 'cv-1' } as never)

    const res = await regenerateCVContent('cv-1')

    expect(res.id).toBe('cv-1')
    expect(prisma.cVDocument.create).not.toHaveBeenCalled()
    expect(generateCVContent).toHaveBeenCalledWith('profile-1', 'job-1', { cvDocumentId: 'cv-1' })
  })

  it('leaves an accepted CV untouched and generates into a new draft for the same job', async () => {
    mockFindFirst.mockResolvedValue({ ...base, status: 'accepted' } as never)
    vi.mocked(prisma.cVDocument.create).mockResolvedValue({ id: 'cv-2' } as never)
    mockUpdate.mockResolvedValue({} as never)

    const res = await regenerateCVContent('cv-1')

    expect(res).toEqual({ id: 'cv-2', content: generated })
    expect(vi.mocked(prisma.cVDocument.create).mock.calls[0][0].data).toMatchObject({
      profileId: 'profile-1', jobApplicationId: 'job-1', templateId: 'default', status: 'generating',
    })
    expect(generateCVContent).toHaveBeenCalledWith('profile-1', 'job-1', { cvDocumentId: 'cv-2' })
    // Every write goes to the new CV; the accepted one is never updated.
    for (const [args] of mockUpdate.mock.calls) expect(args.where).toMatchObject({ id: 'cv-2', profileId: 'profile-1' })
  })

  it("marks the new draft failed (not the accepted CV) when generation fails", async () => {
    mockFindFirst.mockResolvedValue({ ...base, status: 'accepted' } as never)
    vi.mocked(prisma.cVDocument.create).mockResolvedValue({ id: 'cv-2' } as never)
    vi.mocked(generateCVContent).mockRejectedValueOnce(new Error('boom'))

    await expect(regenerateCVContent('cv-1')).rejects.toThrow('boom')
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 'cv-2', profileId: 'profile-1' }, data: { status: 'failed' } })
  })
})

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

describe('createAndGenerateCV', () => {
  beforeEach(() => vi.clearAllMocks())

  it("refuses to link a CV to a job the profile doesn't own", async () => {
    mockFindFirst.mockResolvedValue(null as never)
    vi.mocked(prisma.jobApplication.findFirst).mockResolvedValue(null as never)

    await expect(createAndGenerateCV({ jobApplicationId: 'foreign-job' })).rejects.toThrow('Job not found')
    expect(vi.mocked(prisma.jobApplication.findFirst).mock.calls[0][0]?.where).toEqual({ id: 'foreign-job', profileId: 'profile-1' })
    expect(prisma.cVDocument.create).not.toHaveBeenCalled()
  })
})
