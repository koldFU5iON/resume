import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  requireProfile: vi.fn().mockResolvedValue({ profile: { id: 'profile-1' } }),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    careerVertical: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('./analyse', () => ({ runCareerVerticalAnalysis: vi.fn() }))
vi.mock('./master-cv', () => ({ generateMasterCVContent: vi.fn() }))
vi.mock('@/modules/writing-desk/master', () => ({ landMasterCvDraft: vi.fn() }))
vi.mock('@/modules/writing-desk/queries', () => ({ getMasterCvDeskView: vi.fn() }))

import { analyseCareerVertical, generateMasterCV } from './actions'
import { prisma } from '@/lib/db'
import { runCareerVerticalAnalysis } from './analyse'
import { generateMasterCVContent } from './master-cv'
import { LLMError } from '@/modules/llm/errors'
import { landMasterCvDraft } from '@/modules/writing-desk/master'
import { getMasterCvDeskView } from '@/modules/writing-desk/queries'

const mockVerticalUpsert = vi.mocked(prisma.careerVertical.upsert)
const mockVerticalFindUnique = vi.mocked(prisma.careerVertical.findUnique)
const mockVerticalUpdate = vi.mocked(prisma.careerVertical.update)
const mockLand = vi.mocked(landMasterCvDraft)
const mockMasterView = vi.mocked(getMasterCvDeskView)
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

const CONTENT = {
  version: 1 as const,
  sections: [{ id: 'h', type: 'header' as const, visible: true, data: { name: 'Jane Doe', headline: 'Operations Lead', contact: { email: 'jane@example.test' } } }],
}

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
    mockMasterView.mockResolvedValue(null)
    mockLand.mockResolvedValue({ ok: true, deskId: 'desk-master' })
    mockGenerateMasterContent.mockResolvedValue(CONTENT as never)
  })

  it('returns no_vertical when no analysis exists', async () => {
    mockVerticalFindUnique.mockResolvedValue(null)
    const res = await generateMasterCV()
    expect(res).toMatchObject({ ok: false, error: 'no_vertical' })
    expect(mockLand).not.toHaveBeenCalled()
  })

  it('returns no_vertical when the vertical is not ready', async () => {
    mockVerticalFindUnique.mockResolvedValue({ ...VERTICAL, status: 'analysing' } as never)
    const res = await generateMasterCV()
    expect(res).toMatchObject({ ok: false, error: 'no_vertical' })
  })

  it('generates from the vertical and lands the master CV as a writing desk draft', async () => {
    const res = await generateMasterCV()
    expect(res).toEqual({ ok: true, deskId: 'desk-master' })
    expect(mockGenerateMasterContent).toHaveBeenCalledWith('profile-1', VERTICAL)
    const [profileId, markdown] = mockLand.mock.calls[0]
    expect(profileId).toBe('profile-1')
    expect(markdown).toContain(':::header')
    expect(markdown).toContain('{{contact}}')
    expect(markdown).not.toContain('jane@example.test')
  })

  it('spends nothing when a master CV draft is already waiting', async () => {
    mockMasterView.mockResolvedValue({ draft: { content: '# waiting' } } as never)
    const res = await generateMasterCV()
    expect(res).toMatchObject({ ok: false, error: 'draft_exists' })
    expect(mockGenerateMasterContent).not.toHaveBeenCalled()
    expect(mockLand).not.toHaveBeenCalled()
  })

  it('passes a landing refusal through', async () => {
    mockLand.mockResolvedValue({ ok: false, reason: 'draft_exists', deskId: 'desk-master', message: 'waiting' })
    const res = await generateMasterCV()
    expect(res).toEqual({ ok: false, error: 'draft_exists', message: 'waiting' })
  })

  it('returns the LLM error kind and lands nothing on generation failure', async () => {
    mockGenerateMasterContent.mockRejectedValue(new LLMError('no key', 'not_configured'))
    const res = await generateMasterCV()
    expect(res).toMatchObject({ ok: false, error: 'not_configured' })
    expect(mockLand).not.toHaveBeenCalled()
  })
})
