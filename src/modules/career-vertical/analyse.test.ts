import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    jobApplication: { findMany: vi.fn() },
    careerVertical: { upsert: vi.fn() },
  },
}))
vi.mock('@/modules/llm/client', () => ({ completeStructured: vi.fn() }))
vi.mock('@/modules/llm/prompt-context', () => ({
  loadCareerVerticalPrompt: vi.fn(),
  loadWritingContext: vi.fn(),
  composeSystem: vi.fn(),
}))
vi.mock('@/modules/profile/snapshot', () => ({
  buildProfileSnapshot: vi.fn(),
  serializeProfileForLLM: vi.fn(),
}))

import { runCareerVerticalAnalysis } from './analyse'
import { prisma } from '@/lib/db'
import { completeStructured } from '@/modules/llm/client'
import { loadCareerVerticalPrompt, loadWritingContext, composeSystem } from '@/modules/llm/prompt-context'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'

const mockFindMany = vi.mocked(prisma.jobApplication.findMany)
const mockUpsert = vi.mocked(prisma.careerVertical.upsert)
const mockCompleteStructured = vi.mocked(completeStructured)
const mockLoadPrompt = vi.mocked(loadCareerVerticalPrompt)
const mockLoadWritingContext = vi.mocked(loadWritingContext)
const mockComposeSystem = vi.mocked(composeSystem)
const mockBuildProfileSnapshot = vi.mocked(buildProfileSnapshot)
const mockSerializeProfileForLLM = vi.mocked(serializeProfileForLLM)

const PROFILE_ID = 'profile-1'
const JOB_1 = 'job-1'
const JOB_2 = 'job-2'
const JOB_NO_DESC = 'job-3'

const MOCK_JOBS = [
  { id: JOB_1, title: 'Senior Program Manager', company: 'Acme', jobDescription: 'Lead cross-functional programmes…', jobAnalysis: null },
  { id: JOB_2, title: 'Strategy & Operations Manager', company: 'Globex', jobDescription: 'Design operational processes…', jobAnalysis: null },
  { id: JOB_NO_DESC, title: 'No JD', company: 'Initech', jobDescription: null, jobAnalysis: null },
]

const MOCK_ANALYSIS = {
  thesis: 'Devon solves cross-functional operational complexity by designing scalable systems.',
  businessProblems: ['Cross-functional misalignment', 'Manual processes'],
  responsibilities: ['Lead programmes', 'Build operational processes'],
  outcomes: ['Improved efficiency', 'Standardisation'],
  competencies: ['Programme Management', 'Process Design'],
}

describe('runCareerVerticalAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindMany.mockResolvedValue(MOCK_JOBS as never)
    mockUpsert.mockResolvedValue({} as never)
    mockBuildProfileSnapshot.mockResolvedValue({} as never)
    mockSerializeProfileForLLM.mockReturnValue('Serialized profile')
    mockLoadPrompt.mockResolvedValue('System prompt')
    mockLoadWritingContext.mockResolvedValue({ rules: 'rules', brief: 'brief', searchProfileSummary: null })
    mockComposeSystem.mockReturnValue('Composed system')
    mockCompleteStructured.mockResolvedValue({ object: MOCK_ANALYSIS } as never)
  })

  it('throws when no selected jobs have a description', async () => {
    mockFindMany.mockResolvedValue([MOCK_JOBS[2]] as never)
    await expect(runCareerVerticalAnalysis(PROFILE_ID, [JOB_NO_DESC])).rejects.toThrow(
      'None of the selected jobs have a description',
    )
    expect(mockCompleteStructured).not.toHaveBeenCalled()
  })

  it('calls completeStructured with feature career-vertical-analyse', async () => {
    await runCareerVerticalAnalysis(PROFILE_ID, [JOB_1, JOB_2])
    expect(mockCompleteStructured).toHaveBeenCalledWith(
      PROFILE_ID,
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ feature: 'career-vertical-analyse' }),
    )
  })

  it('only persists jobs that have a description as sources', async () => {
    await runCareerVerticalAnalysis(PROFILE_ID, [JOB_1, JOB_2, JOB_NO_DESC])
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { profileId: PROFILE_ID },
        update: expect.objectContaining({
          sourceJobIds: [JOB_1, JOB_2],
          status: 'ready',
          analysedAt: expect.any(Date),
        }),
        create: expect.objectContaining({
          profileId: PROFILE_ID,
          sourceJobIds: [JOB_1, JOB_2],
          status: 'ready',
        }),
      }),
    )
  })

  it('persists the extracted threads and thesis', async () => {
    await runCareerVerticalAnalysis(PROFILE_ID, [JOB_1, JOB_2])
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          thesis: MOCK_ANALYSIS.thesis,
          businessProblems: MOCK_ANALYSIS.businessProblems,
          responsibilities: MOCK_ANALYSIS.responsibilities,
          outcomes: MOCK_ANALYSIS.outcomes,
          competencies: MOCK_ANALYSIS.competencies,
        }),
      }),
    )
  })

  it('returns the parsed analysis', async () => {
    const result = await runCareerVerticalAnalysis(PROFILE_ID, [JOB_1, JOB_2])
    expect(result).toEqual(MOCK_ANALYSIS)
  })

  it('dedupes and caps the number of target roles', async () => {
    mockFindMany.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => ({ ...MOCK_JOBS[0], id: `job-${i}` })) as never,
    )
    await runCareerVerticalAnalysis(PROFILE_ID, Array.from({ length: 50 }, (_, i) => `job-${i}`))
    const calls = mockFindMany.mock.calls[0][0] as { where: { id: { in: string[] } } }
    expect(calls.where.id.in).toHaveLength(30)
  })
})
