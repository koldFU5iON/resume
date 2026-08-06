import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/llm/client', () => ({ complete: vi.fn() }))
vi.mock('@/modules/llm/prompt-context', () => ({
  loadCVPrompt: vi.fn(),
  loadWritingContext: vi.fn(),
  composeSystem: vi.fn(),
}))
vi.mock('@/modules/profile/snapshot', () => ({
  buildProfileSnapshot: vi.fn(),
  serializeProfileForLLM: vi.fn(),
}))
vi.mock('@/modules/cv/score-evidence', () => ({
  applyRoleBudgets: vi.fn(),
}))

import { formatCareerVerticalContext, generateMasterCVContent } from './master-cv'
import { complete } from '@/modules/llm/client'
import { loadCVPrompt, loadWritingContext, composeSystem } from '@/modules/llm/prompt-context'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { applyRoleBudgets } from '@/modules/cv/score-evidence'

const mockComplete = vi.mocked(complete)
const mockLoadCVPrompt = vi.mocked(loadCVPrompt)
const mockLoadWritingContext = vi.mocked(loadWritingContext)
const mockComposeSystem = vi.mocked(composeSystem)
const mockBuildProfileSnapshot = vi.mocked(buildProfileSnapshot)
const mockSerializeProfileForLLM = vi.mocked(serializeProfileForLLM)
const mockApplyRoleBudgets = vi.mocked(applyRoleBudgets)

const PROFILE_ID = 'profile-1'

const VERTICAL = {
  thesis: 'Solves cross-functional operational complexity by designing scalable systems.',
  businessProblems: ['Cross-functional misalignment', 'Manual processes'],
  responsibilities: ['Lead programmes', 'Build operational processes'],
  outcomes: ['Improved efficiency', 'Standardisation'],
  competencies: ['Programme Management', 'Process Design'],
}

const CONTENT = {
  version: 1 as const,
  sections: [
    {
      id: 'header',
      type: 'header' as const,
      visible: true,
      data: { name: 'Devon', headline: 'Operations Leader', contact: {} },
    },
  ],
}

describe('formatCareerVerticalContext', () => {
  it('renders thesis and all four thread groups', () => {
    const out = formatCareerVerticalContext(VERTICAL)
    expect(out).toContain('== CAREER VERTICAL ==')
    expect(out).toContain(`Career thesis: ${VERTICAL.thesis}`)
    expect(out).toContain('Business problems: Cross-functional misalignment, Manual processes')
    expect(out).toContain('Competencies: Programme Management, Process Design')
  })

  it('falls back to a placeholder when the thesis is null', () => {
    const out = formatCareerVerticalContext({ ...VERTICAL, thesis: null })
    expect(out).toContain('Career thesis: Not set')
  })
})

describe('generateMasterCVContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadCVPrompt.mockResolvedValue('cv prompt')
    mockLoadWritingContext.mockResolvedValue({ rules: 'rules', brief: 'brief', searchProfileSummary: null })
    mockComposeSystem.mockReturnValue('Composed system')
    mockBuildProfileSnapshot.mockResolvedValue({} as never)
    mockSerializeProfileForLLM.mockReturnValue('Serialized profile')
    mockApplyRoleBudgets.mockImplementation(x => x)
    mockComplete.mockResolvedValue({
      text: `\`\`\`json\n${JSON.stringify(CONTENT)}\n\`\`\``,
    } as never)
  })

  it('applies deterministic role budgets to the snapshot', async () => {
    const snapshot = { experiences: [] }
    mockBuildProfileSnapshot.mockResolvedValue(snapshot as never)
    await generateMasterCVContent(PROFILE_ID, VERTICAL)
    expect(mockApplyRoleBudgets).toHaveBeenCalledWith(snapshot)
  })

  it('calls complete with feature master-cv-generate', async () => {
    await generateMasterCVContent(PROFILE_ID, VERTICAL)
    expect(mockComplete).toHaveBeenCalledWith(
      PROFILE_ID,
      expect.any(String),
      expect.objectContaining({ feature: 'master-cv-generate' }),
    )
  })

  it('includes the career vertical in the prompt and announces master mode', async () => {
    await generateMasterCVContent(PROFILE_ID, VERTICAL)
    const prompt = mockComplete.mock.calls[0][1] as string
    expect(prompt).toContain('== MODE: MASTER CV ==')
    expect(prompt).toContain('== CAREER VERTICAL ==')
    expect(prompt).toContain('== CANDIDATE PROFILE ==')
  })

  it('parses the fenced JSON output into a CVDocumentContent', async () => {
    const result = await generateMasterCVContent(PROFILE_ID, VERTICAL)
    expect(result).toEqual(CONTENT)
    expect(result.sections[0].type).toBe('header')
  })
})
