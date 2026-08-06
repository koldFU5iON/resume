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

import { formatCareerVerticalContext, formatMasterCVNarrative, generateMasterCVContent } from './master-cv'
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

describe('formatMasterCVNarrative', () => {
  const FULL_CONTENT = {
    version: 1 as const,
    sections: [
      {
        id: 'header',
        type: 'header' as const,
        visible: true,
        data: { name: 'Devon', headline: 'Operations Leader', subHeadline: 'Fintech', contact: { linkedin: 'x' } },
      },
      {
        id: 'profile',
        type: 'profile' as const,
        visible: true,
        data: { content: 'Scales operations across cross-functional teams.' },
      },
      {
        id: 'comp',
        type: 'competencies' as const,
        visible: true,
        data: { items: ['Programme Management', 'Process Design'] },
      },
      {
        id: 'skills',
        type: 'skills' as const,
        visible: true,
        data: { items: ['Stakeholder Management'] },
      },
      {
        id: 'exp',
        type: 'experience' as const,
        visible: true,
        data: {
          company: 'Acme',
          titles: ['Head of Ops', 'Ops Lead'],
          location: 'London',
          duration: '2020-2024',
          description: 'Ran the operational backbone.',
          outcomes: ['Cut cycle time 40%'],
        },
      },
    ],
  }

  it('returns null for empty or missing content', () => {
    expect(formatMasterCVNarrative(null)).toBeNull()
    expect(formatMasterCVNarrative({ version: 1, sections: [] })).toBeNull()
  })

  it('serializes narrative sections and canonical experience wording', () => {
    const out = formatMasterCVNarrative(FULL_CONTENT)!
    expect(out).toContain('== MASTER CV (CANONICAL NARRATIVE) ==')
    expect(out).toContain('Headline: Operations Leader')
    expect(out).toContain('Sub-headline: Fintech')
    expect(out).toContain('Profile: Scales operations across cross-functional teams.')
    expect(out).toContain('Competencies: Programme Management, Process Design')
    expect(out).toContain('Skills: Stakeholder Management')
    expect(out).toContain('Acme | Head of Ops/Ops Lead — Ran the operational backbone.')
    expect(out).toContain('Cut cycle time 40%')
  })

  it('excludes hidden sections', () => {
    const out = formatMasterCVNarrative({
      version: 1,
      sections: [
        { id: 'skills', type: 'skills' as const, visible: false, data: { items: ['Hidden'] } },
        { id: 'exp', type: 'experience' as const, visible: false, data: { company: 'Acme', titles: [], location: '', duration: '', description: '', outcomes: [] } },
      ],
    })
    expect(out).toBeNull()
  })

  it('attaches tailoring instructions', () => {
    const out = formatMasterCVNarrative(FULL_CONTENT)!
    expect(out).toContain('keep the headline, sub-headline, competencies')
    expect(out).toContain('reuse the canonical description and outcome wording')
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

  it('parses fenced JSON surrounded by prose', async () => {
    mockComplete.mockResolvedValue({
      text: `Sure, here it is:\n\`\`\`json\n${JSON.stringify(CONTENT)}\n\`\`\`\nLet me know if you want edits.`,
    } as never)
    const result = await generateMasterCVContent(PROFILE_ID, VERTICAL)
    expect(result).toEqual(CONTENT)
  })

  it('throws a normalized LLMError instead of a raw SyntaxError when output is unparseable', async () => {
    mockComplete.mockResolvedValue({
      text: 'I am unable to produce a CV right now.',
    } as never)
    await expect(generateMasterCVContent(PROFILE_ID, VERTICAL)).rejects.toMatchObject({
      name: 'LLMError',
      message: expect.stringContaining('could not be parsed'),
    })
  })
})
