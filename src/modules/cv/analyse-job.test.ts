import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    jobApplication: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))
vi.mock('@/modules/llm/client', () => ({
  completeStructured: vi.fn(),
}))
vi.mock('@/modules/profile/snapshot', () => ({
  buildProfileSnapshot: vi.fn(),
  serializeProfileForLLM: vi.fn(),
}))
vi.mock('@/modules/llm/prompt-context', () => ({
  loadCVJobAnalysisPrompt: vi.fn(),
  composeSystem: vi.fn(),
}))

import { analyseJob } from './analyse-job'
import { prisma } from '@/lib/db'
import { completeStructured } from '@/modules/llm/client'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { loadCVJobAnalysisPrompt, composeSystem } from '@/modules/llm/prompt-context'

const mockFindFirst = vi.mocked(prisma.jobApplication.findFirst)
const mockUpdate = vi.mocked(prisma.jobApplication.update)
const mockCompleteStructured = vi.mocked(completeStructured)
const mockBuildProfileSnapshot = vi.mocked(buildProfileSnapshot)
const mockSerializeProfileForLLM = vi.mocked(serializeProfileForLLM)
const mockLoadPrompt = vi.mocked(loadCVJobAnalysisPrompt)
const mockComposeSystem = vi.mocked(composeSystem)

const PROFILE_ID = 'profile-1'
const JOB_ID = 'job-1'

const MOCK_JOB = {
  id: JOB_ID,
  title: 'PR Director',
  company: 'Uberstrategist',
  jobDescription: 'We need a PR director with agency experience...',
}

const MOCK_ANALYSIS = {
  mustHave: ['Agency Experience', 'Media Relations'],
  niceToHave: ['Remote Team Experience'],
  risks: [
    {
      risk: 'Agency experience not prominent',
      severity: 'high' as const,
      recommendation: 'Lead with Megarom role',
    },
  ],
  positioningStrategy: 'Lead with agency experience. Downplay in-house tooling.',
}

describe('analyseJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFirst.mockResolvedValue(MOCK_JOB as never)
    mockUpdate.mockResolvedValue({} as never)
    mockBuildProfileSnapshot.mockResolvedValue({} as never)
    mockSerializeProfileForLLM.mockReturnValue('Serialized profile')
    mockLoadPrompt.mockResolvedValue('System prompt')
    mockComposeSystem.mockReturnValue('Composed system')
    mockCompleteStructured.mockResolvedValue({ object: MOCK_ANALYSIS } as never)
  })

  it('returns null when job is not found', async () => {
    mockFindFirst.mockResolvedValue(null)
    const result = await analyseJob(PROFILE_ID, JOB_ID)
    expect(result).toBeNull()
  })

  it('returns null when job has no description', async () => {
    mockFindFirst.mockResolvedValue({ ...MOCK_JOB, jobDescription: null } as never)
    const result = await analyseJob(PROFILE_ID, JOB_ID)
    expect(result).toBeNull()
  })

  it('returns null when job description is whitespace only', async () => {
    mockFindFirst.mockResolvedValue({ ...MOCK_JOB, jobDescription: '   ' } as never)
    const result = await analyseJob(PROFILE_ID, JOB_ID)
    expect(result).toBeNull()
  })

  it('calls completeStructured with feature cv-job-analysis', async () => {
    await analyseJob(PROFILE_ID, JOB_ID)
    expect(mockCompleteStructured).toHaveBeenCalledWith(
      PROFILE_ID,
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ feature: 'cv-job-analysis' }),
    )
  })

  it('runs on the fast role with room for the full schema (#359)', async () => {
    await analyseJob(PROFILE_ID, JOB_ID)
    const opts = mockCompleteStructured.mock.calls[0][3]
    expect(opts).toMatchObject({ role: 'fast' })
    expect(opts.maxOutputTokens).toBeGreaterThanOrEqual(3000)
  })

  it('stores the analysis result on the job application', async () => {
    await analyseJob(PROFILE_ID, JOB_ID)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: JOB_ID, profileId: PROFILE_ID },
      data: expect.objectContaining({
        jobAnalysis: MOCK_ANALYSIS,
        jobAnalysedAt: expect.any(Date),
      }),
    })
  })

  it('returns the parsed analysis', async () => {
    const result = await analyseJob(PROFILE_ID, JOB_ID)
    expect(result).toEqual(MOCK_ANALYSIS)
  })

  it('returns null and does not throw when LLM call fails', async () => {
    mockCompleteStructured.mockRejectedValue(new Error('LLM error'))
    const result = await analyseJob(PROFILE_ID, JOB_ID)
    expect(result).toBeNull()
  })
})
