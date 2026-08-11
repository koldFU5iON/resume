import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  requireProfile: vi.fn().mockResolvedValue({ profile: { id: 'profile-1' } }),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    cVDocument: { findFirst: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { addCustomSection, reorderSections, patchCVSectionData } from './actions'
import { prisma } from '@/lib/db'
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
