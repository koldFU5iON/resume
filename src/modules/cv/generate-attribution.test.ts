import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    jobApplication: { findFirst: vi.fn() },
    userSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    careerVertical: { findUnique: vi.fn().mockResolvedValue(null) },
    cVDocument: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}))
vi.mock('@/modules/llm/complete-json', () => ({ completeJSON: vi.fn() }))
vi.mock('@/modules/llm/prompt-context', () => ({
  loadWritingContext: vi.fn().mockResolvedValue({ rules: null, brief: null }),
  loadCVPrompt: vi.fn().mockResolvedValue(''),
  composeSystem: vi.fn(() => ''),
}))
vi.mock('@/modules/profile/snapshot', () => ({
  buildProfileSnapshot: vi.fn().mockResolvedValue({ experiences: [] }),
  serializeProfileForLLM: vi.fn(() => 'profile'),
}))
vi.mock('@/modules/career-vertical/master-cv', () => ({ formatMasterCVNarrative: vi.fn(() => null) }))
vi.mock('./analyse-job', () => ({ analyseJob: vi.fn() }))
vi.mock('./score-evidence', () => ({ scoreEvidence: vi.fn(async (_p: string, s: unknown) => s), applyRoleBudgets: vi.fn((s: unknown) => s) }))
vi.mock('./scan-cv', () => ({ scanCV: vi.fn().mockResolvedValue(null) }))
vi.mock('./ats-context', () => ({ buildATSContext: vi.fn().mockResolvedValue(null), formatATSContext: vi.fn(() => '') }))
vi.mock('./header', () => ({ fillCVHeader: vi.fn((c: unknown) => c) }))

import { prisma } from '@/lib/db'
import { completeJSON } from '@/modules/llm/complete-json'
import { generateCVContent } from './generate'
import { analyseJob } from './analyse-job'
import { scoreEvidence } from './score-evidence'
import { scanCV } from './scan-cv'
import { buildATSContext } from './ats-context'

const analysis = { mustHave: ['x'], niceToHave: [], positioningStrategy: 'p', risks: [] }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.jobApplication.findFirst).mockResolvedValue({ jobDescription: 'JD', title: 'PM', company: 'Co', jobAnalysis: null } as never)
  vi.mocked(analyseJob).mockResolvedValue(analysis as never)
  vi.mocked(completeJSON).mockResolvedValue({ extracted: { ok: true, value: { sections: [] } }, finishReason: 'stop', rawText: '' } as never)
})

describe('generateCVContent usage attribution', () => {
  it('attributes analysis, evidence, ATS context, draft and recruiter scan to one job, CV and run', async () => {
    await generateCVContent('p1', 'job-1', { cvDocumentId: 'cv-1' })
    await vi.waitFor(() => expect(scanCV).toHaveBeenCalled())

    const attribution = vi.mocked(completeJSON).mock.calls[0][3].attribution
    expect(attribution).toEqual({ jobApplicationId: 'job-1', cvDocumentId: 'cv-1', runId: expect.any(String) })
    expect(vi.mocked(analyseJob).mock.calls[0][2]).toBe(attribution)
    expect(vi.mocked(scoreEvidence).mock.calls[0][3]).toBe(attribution)
    expect(vi.mocked(buildATSContext).mock.calls[0][3]).toBe(attribution)
    expect(vi.mocked(scanCV).mock.calls[0][4]).toBe(attribution)
  })

  it('gives each generation attempt its own run id', async () => {
    await generateCVContent('p1', 'job-1', { cvDocumentId: 'cv-1' })
    await generateCVContent('p1', 'job-1', { cvDocumentId: 'cv-1' })
    const [a, b] = vi.mocked(completeJSON).mock.calls.map((c) => c[3].attribution!)
    expect(a.cvDocumentId).toBe(b.cvDocumentId)
    expect(a.runId).not.toBe(b.runId)
  })

  it('a generic CV carries only the CV and run, no job', async () => {
    await generateCVContent('p1', undefined, { cvDocumentId: 'cv-g' })
    expect(vi.mocked(completeJSON).mock.calls[0][3].attribution).toMatchObject({ jobApplicationId: null, cvDocumentId: 'cv-g' })
  })
})
