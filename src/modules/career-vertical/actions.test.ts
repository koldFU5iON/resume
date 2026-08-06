import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  requireProfile: vi.fn().mockResolvedValue({ profile: { id: 'profile-1' } }),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    careerVertical: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    cVTemplate: { upsert: vi.fn() },
    cVDocument: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('./analyse', () => ({ runCareerVerticalAnalysis: vi.fn() }))
vi.mock('./master-cv', () => ({ generateMasterCVContent: vi.fn() }))

import { analyseCareerVertical, generateMasterCV } from './actions'
import { prisma } from '@/lib/db'
import { runCareerVerticalAnalysis } from './analyse'
import { generateMasterCVContent } from './master-cv'
import { LLMError } from '@/modules/llm/errors'

const mockVerticalUpsert = vi.mocked(prisma.careerVertical.upsert)
const mockVerticalFindUnique = vi.mocked(prisma.careerVertical.findUnique)
const mockVerticalUpdate = vi.mocked(prisma.careerVertical.update)
const mockTemplateUpsert = vi.mocked(prisma.cVTemplate.upsert)
const mockCvFindFirst = vi.mocked(prisma.cVDocument.findFirst)
const mockCvCreate = vi.mocked(prisma.cVDocument.create)
const mockCvUpdate = vi.mocked(prisma.cVDocument.update)
const mockRunAnalysis = vi.mocked(runCareerVerticalAnalysis)
const mockGenerateMasterContent = vi.mocked(generateMasterCVContent)

const ANALYSIS = {
  thesis: 'Solves cross-functional operational complexity.',
  businessProblems: ['Cross-functional misalignment'],
  responsibilities: ['Lead programmes'],
  outcomes: ['Improved efficiency'],
  competencies: ['Programme Management'],
}

const VERTICAL = {
  id: 'cv-vert-1',
  profileId: 'profile-1',
  status: 'ready',
  thesis: ANALYSIS.thesis,
  businessProblems: ANALYSIS.businessProblems,
  responsibilities: ANALYSIS.responsibilities,
  outcomes: ANALYSIS.outcomes,
  competencies: ANALYSIS.competencies,
  sourceJobIds: ['job-1'],
  analysedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
}

const CONTENT = { version: 1 as const, sections: [] }

describe('analyseCareerVertical', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerticalUpsert.mockResolvedValue({} as never)
    mockVerticalUpdate.mockResolvedValue({} as never)
    mockRunAnalysis.mockResolvedValue(ANALYSIS)
  })

  it('returns no_jobs when no ids are provided', async () => {
    const res = await analyseCareerVertical([])
    expect(res).toMatchObject({ ok: false, error: 'no_jobs' })
    expect(mockVerticalUpsert).not.toHaveBeenCalled()
  })

  it('flips status to analysing before running', async () => {
    await analyseCareerVertical(['job-1'])
    expect(mockVerticalUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { profileId: 'profile-1' },
        update: { status: 'analysing' },
        create: { profileId: 'profile-1', status: 'analysing' },
      }),
    )
  })

  it('returns the analysis on success', async () => {
    const res = await analyseCareerVertical(['job-1'])
    expect(res).toEqual({ ok: true, analysis: ANALYSIS })
  })

  it('returns the LLM error kind and marks the vertical failed on LLM failure', async () => {
    mockRunAnalysis.mockRejectedValue(new LLMError('rate limited', 'rate_limit'))
    const res = await analyseCareerVertical(['job-1'])
    expect(res).toMatchObject({ ok: false, error: 'rate_limit' })
    expect(mockVerticalUpdate).toHaveBeenCalledWith({
      where: { profileId: 'profile-1' },
      data: { status: 'failed' },
    })
  })
})

describe('generateMasterCV', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerticalFindUnique.mockResolvedValue(VERTICAL as never)
    mockTemplateUpsert.mockResolvedValue({ id: 'default' } as never)
    mockCvFindFirst.mockResolvedValue(null)
    mockCvCreate.mockResolvedValue({ id: 'cv-new' } as never)
    mockCvUpdate.mockResolvedValue({} as never)
    mockGenerateMasterContent.mockResolvedValue(CONTENT as never)
  })

  it('returns no_vertical when no analysis exists', async () => {
    mockVerticalFindUnique.mockResolvedValue(null)
    const res = await generateMasterCV()
    expect(res).toMatchObject({ ok: false, error: 'no_vertical' })
    expect(mockCvCreate).not.toHaveBeenCalled()
  })

  it('returns no_vertical when the vertical is not ready', async () => {
    mockVerticalFindUnique.mockResolvedValue({ ...VERTICAL, status: 'analysing' } as never)
    const res = await generateMasterCV()
    expect(res).toMatchObject({ ok: false, error: 'no_vertical' })
  })

  it('creates a master CVDocument linked to the vertical and generates content', async () => {
    const res = await generateMasterCV()
    expect(res).toEqual({ ok: true, cvId: 'cv-new' })
    expect(mockCvCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          profileId: 'profile-1',
          careerVerticalId: 'cv-vert-1',
          jobApplicationId: null,
          status: 'generating',
          jobTitle: 'Master CV',
        }),
      }),
    )
    expect(mockGenerateMasterContent).toHaveBeenCalledWith('profile-1', VERTICAL)
    expect(mockCvUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'cv-new' },
        data: { generatedContent: JSON.stringify(CONTENT), status: 'draft' },
      }),
    )
  })

  it('regenerates an existing master CV instead of creating a duplicate', async () => {
    mockCvFindFirst.mockResolvedValue({ id: 'cv-existing' } as never)
    const res = await generateMasterCV()
    expect(res).toEqual({ ok: true, cvId: 'cv-existing' })
    expect(mockCvCreate).not.toHaveBeenCalled()
  })

  it('returns the LLM error kind and marks the document failed on generation failure', async () => {
    mockGenerateMasterContent.mockRejectedValue(new LLMError('no key', 'not_configured'))
    const res = await generateMasterCV()
    expect(res).toMatchObject({ ok: false, error: 'not_configured' })
    expect(mockCvUpdate).toHaveBeenCalledWith({
      where: { id: 'cv-new' },
      data: { status: 'failed' },
    })
  })
})
