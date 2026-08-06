import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  requireProfile: vi.fn().mockResolvedValue({
    profile: { id: 'profile-1', name: 'Test User' },
  }),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    coverLetterDocument: { findFirst: vi.fn() },
    cVDocument: { findFirst: vi.fn() },
    jobApplication: { findFirst: vi.fn() },
    userSettings: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}))
vi.mock('@/modules/search-profile/actions', () => ({
  emitSuggestion: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/modules/search-profile/schema', () => ({
  normalizeSearchProfile: vi.fn().mockReturnValue({
    roles: [], countries: [], remotePreference: '', salaryBand: null,
    preferredName: '', currentRole: '', careerGoals: '', pivotContext: '', extraContext: '',
  }),
}))
vi.mock('@/modules/profile/snapshot', () => ({
  buildProfileSnapshot: vi.fn().mockResolvedValue({}),
  serializeProfileForLLM: vi.fn().mockReturnValue('# Test User'),
}))
vi.mock('@/modules/llm/prompt-context', () => ({
  loadWritingContext: vi.fn().mockResolvedValue({ rules: '', brief: null, searchProfileSummary: null }),
  composeSystem: vi.fn().mockReturnValue('system prompt'),
}))
vi.mock('@/modules/prompts/loader', () => ({
  loadPromptText: vi.fn().mockResolvedValue('prompt'),
}))
vi.mock('@/modules/llm/client', () => ({
  complete: vi.fn(),
  completeStructured: vi.fn(),
}))
vi.mock('@/modules/cv/export', () => ({
  toMarkdown: vi.fn().mockReturnValue('CV markdown'),
}))
vi.mock('@/modules/cv/schema', () => ({
  CVDocumentContentSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: {} }) },
}))

import { buildWithMe, reviewLetter, analyseRole, buildLetterArchitecture, draftFromArchitecture, reviewDraftPass, finaliseFromReview } from './actions'
import type { Stage1Brief, Stage2Architecture, Stage4Issues } from './schema'
import { prisma } from '@/lib/db'
import { complete, completeStructured } from '@/modules/llm/client'

const mockLetterFind = vi.mocked(prisma.coverLetterDocument.findFirst)
const mockCVFind = vi.mocked(prisma.cVDocument.findFirst)
const mockComplete = vi.mocked(complete)
const mockCompleteStructured = vi.mocked(completeStructured)

describe('buildWithMe', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns not_found when letter missing', async () => {
    mockLetterFind.mockResolvedValue(null)
    const result = await buildWithMe('missing', {})
    expect(result).toEqual({ ok: false, error: 'not_found', message: expect.any(String) })
  })

  it('includes answers in prompt and calls complete', async () => {
    mockLetterFind.mockResolvedValue({ id: 'letter-1', content: '', jobApplicationId: null, jobTitle: null, company: null, jobApplication: null } as never)
    mockCVFind.mockResolvedValue(null)
    mockComplete.mockResolvedValue({ text: 'Dear Hiring Manager,' } as never)

    const result = await buildWithMe('letter-1', { whyRole: 'Excited about the product', whyCompany: 'Love the mission' })
    expect(result).toEqual({ ok: true, content: 'Dear Hiring Manager,' })

    const promptArg = mockComplete.mock.calls[0][1] as string
    expect(promptArg).toContain('Excited about the product')
    expect(promptArg).toContain('Love the mission')
    expect(mockComplete).toHaveBeenCalledWith(
      'profile-1',
      expect.any(String),
      expect.objectContaining({ feature: 'cover-letter-build' }),
    )
  })
})

describe('reviewLetter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns not_found when letter missing', async () => {
    mockLetterFind.mockResolvedValue(null)
    const result = await reviewLetter('missing')
    expect(result).toEqual({ ok: false, error: 'not_found', message: expect.any(String) })
  })

  it('returns no_content when letter is empty', async () => {
    mockLetterFind.mockResolvedValue({ id: 'letter-1', content: '', jobApplicationId: null, jobTitle: null, company: null, jobApplication: null } as never)
    const result = await reviewLetter('letter-1')
    expect(result).toEqual({ ok: false, error: 'no_content', message: expect.any(String) })
  })

  it('calls completeStructured and returns review', async () => {
    mockLetterFind.mockResolvedValue({ id: 'letter-1', content: 'Dear Hiring Manager,\n\nBody text.', jobApplicationId: null, jobTitle: null, company: null, jobApplication: null } as never)
    mockCVFind.mockResolvedValue(null)
    const review = { issues: [], strengths: ['Clear opening.'], summary: 'Good letter.' }
    mockCompleteStructured.mockResolvedValue({ object: review } as never)

    const result = await reviewLetter('letter-1')
    expect(result).toEqual({ ok: true, review })
    expect(mockCompleteStructured).toHaveBeenCalledWith(
      'profile-1',
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ feature: 'cover-letter-review' }),
    )
  })
})

describe('analyseRole', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns not_found when letter missing', async () => {
    mockLetterFind.mockResolvedValue(null)
    const result = await analyseRole('missing')
    expect(result).toEqual({ ok: false, error: 'not_found', message: expect.any(String) })
  })

  it('calls completeStructured and returns brief', async () => {
    mockLetterFind.mockResolvedValue({
      id: 'letter-1', content: '', jobApplicationId: null, jobTitle: 'PM', company: 'Acme',
      jobApplication: { title: 'PM', company: 'Acme', jobDescription: 'Build product', jobAnalysis: null },
    } as never)
    mockCVFind.mockResolvedValue(null)
    const brief: Stage1Brief = {
      rolePurpose: 'Drive product strategy for enterprise segment',
      topRequirements: ['Product sense', 'Cross-functional leadership', 'Data fluency'],
      track: 'pm',
      selectedProofPoint: 'Led launch of X to 50k users in 3 months',
      gaps: [],
      screenerCriteria: ['Jira'],
      closeFormula: 'Based in London, eligible to work in UK',
    }
    mockCompleteStructured.mockResolvedValue({ object: brief } as never)

    const result = await analyseRole('letter-1')
    expect(result).toEqual({ ok: true, brief })
    expect(mockCompleteStructured).toHaveBeenCalledWith(
      'profile-1',
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ system: expect.any(String), feature: 'cover-letter-analyse', temperature: 0 }),
    )
  })

  it('returns llm error kind on LLMError', async () => {
    mockLetterFind.mockResolvedValue({ id: 'letter-1', content: '', jobApplicationId: null, jobTitle: null, company: null, jobApplication: null } as never)
    mockCVFind.mockResolvedValue(null)
    const { LLMError } = await import('@/modules/llm/errors')
    mockCompleteStructured.mockRejectedValue(new LLMError('No key', 'not_configured'))
    const result = await analyseRole('letter-1')
    expect(result).toEqual({ ok: false, error: 'not_configured', message: 'No key' })
  })
})

describe('buildLetterArchitecture', () => {
  beforeEach(() => vi.clearAllMocks())

  const brief: Stage1Brief = {
    rolePurpose: 'Drive product strategy for enterprise segment',
    topRequirements: ['Product sense', 'Cross-functional leadership', 'Data fluency'],
    track: 'pm',
    selectedProofPoint: 'Led launch of X to 50k users',
    gaps: [],
    screenerCriteria: [],
    closeFormula: 'Based in London',
  }

  it('returns not_found when letter missing', async () => {
    mockLetterFind.mockResolvedValue(null)
    const result = await buildLetterArchitecture('missing', brief)
    expect(result).toEqual({ ok: false, error: 'not_found', message: expect.any(String) })
  })

  it('calls completeStructured with brief JSON in prompt and returns architecture', async () => {
    mockLetterFind.mockResolvedValue({ id: 'letter-1', content: '', jobApplicationId: null, jobTitle: null, company: null, jobApplication: null } as never)
    mockCVFind.mockResolvedValue(null)
    const architecture = {
      hook: 'Acme needs someone to turn ambiguous product bets into shipped outcomes.',
      connection: "That's the work I've done for four years at Unity.",
      proofSetup: 'Led launch of X — 50k users in 3 months.',
      gapAcknowledgement: null,
      closeFormula: 'Based in London, eligible to work in UK.',
    }
    mockCompleteStructured.mockResolvedValue({ object: architecture } as never)

    const result = await buildLetterArchitecture('letter-1', brief)
    expect(result).toEqual({ ok: true, architecture })
    expect(mockCompleteStructured).toHaveBeenCalledWith(
      'profile-1',
      expect.stringContaining('Drive product strategy'),
      expect.anything(),
      expect.objectContaining({ system: expect.any(String), feature: 'cover-letter-architect' }),
    )
  })
})

describe('draftFromArchitecture', () => {
  beforeEach(() => vi.clearAllMocks())

  const architecture: Stage2Architecture = {
    hook: 'Acme needs someone to own ambiguous product bets.',
    connection: "That's the work I've done for four years.",
    proofSetup: 'Led launch of X — 50k users in 3 months.',
    gapAcknowledgement: null,
    closeFormula: 'Based in London, eligible to work in UK.',
  }

  it('returns not_found when letter missing', async () => {
    mockLetterFind.mockResolvedValue(null)
    const result = await draftFromArchitecture('missing', architecture)
    expect(result).toEqual({ ok: false, error: 'not_found', message: expect.any(String) })
  })

  it('calls complete with architecture context and returns draft', async () => {
    mockLetterFind.mockResolvedValue({ id: 'letter-1', content: '', jobApplicationId: null, jobTitle: null, company: null, jobApplication: null } as never)
    mockCVFind.mockResolvedValue(null)
    mockComplete.mockResolvedValue({ text: '# Test User\n\nDear Hiring Manager,\n\nDraft body.' } as never)

    const result = await draftFromArchitecture('letter-1', architecture)
    expect(result).toEqual({ ok: true, draft: '# Test User\n\nDear Hiring Manager,\n\nDraft body.' })
    expect(mockComplete).toHaveBeenCalledWith(
      'profile-1',
      expect.stringContaining('Acme needs someone'),
      expect.objectContaining({ system: expect.any(String), feature: 'cover-letter-draft' }),
    )
  })
})

describe('reviewDraftPass', () => {
  beforeEach(() => vi.clearAllMocks())

  const brief: Stage1Brief = {
    rolePurpose: 'Drive product strategy',
    topRequirements: ['Product sense', 'Cross-functional', 'Data'],
    track: 'pm',
    selectedProofPoint: 'Led launch of X',
    gaps: [],
    screenerCriteria: ['Jira'],
    closeFormula: 'Based in London',
  }

  it('returns not_found when letter missing', async () => {
    mockLetterFind.mockResolvedValue(null)
    const result = await reviewDraftPass('missing', 'draft text', brief)
    expect(result).toEqual({ ok: false, error: 'not_found', message: expect.any(String) })
  })

  it('calls completeStructured with draft and brief and returns issues', async () => {
    mockLetterFind.mockResolvedValue({ id: 'letter-1', content: '', jobApplicationId: null, jobTitle: null, company: null, jobApplication: null } as never)
    mockCVFind.mockResolvedValue(null)
    const issues: Stage4Issues = {
      mustFix: [],
      consider: [{ description: 'Em dash on line 3.' }],
      wordCount: 295,
      passesChecklist: true,
    }
    mockCompleteStructured.mockResolvedValue({ object: issues } as never)

    const result = await reviewDraftPass('letter-1', 'Dear Hiring Manager,\n\nBody text.', brief)
    expect(result).toEqual({ ok: true, issues })
    expect(mockCompleteStructured).toHaveBeenCalledWith(
      'profile-1',
      expect.stringContaining('Dear Hiring Manager'),
      expect.anything(),
      expect.objectContaining({ system: expect.any(String), feature: 'cover-letter-review-pass' }),
    )
  })
})

describe('finaliseFromReview', () => {
  beforeEach(() => vi.clearAllMocks())

  const issues: Stage4Issues = {
    mustFix: [{ description: 'Missing data fluency requirement.', suggestedFix: 'Add reference to analytics work in paragraph 2.' }],
    consider: [],
    wordCount: 295,
    passesChecklist: false,
  }

  it('returns not_found when letter missing', async () => {
    mockLetterFind.mockResolvedValue(null)
    const result = await finaliseFromReview('missing', 'draft', issues)
    expect(result).toEqual({ ok: false, error: 'not_found', message: expect.any(String) })
  })

  it('calls complete with draft and issues and returns final content', async () => {
    mockLetterFind.mockResolvedValue({ id: 'letter-1', content: '', jobApplicationId: null, jobTitle: null, company: null, jobApplication: null } as never)
    mockCVFind.mockResolvedValue(null)
    mockComplete.mockResolvedValue({ text: '# Test User\n\nDear Hiring Manager,\n\nFinal body.' } as never)

    const result = await finaliseFromReview('letter-1', 'Dear Hiring Manager,\n\nDraft.', issues)
    expect(result).toEqual({ ok: true, content: '# Test User\n\nDear Hiring Manager,\n\nFinal body.' })
    expect(mockComplete).toHaveBeenCalledWith(
      'profile-1',
      expect.stringContaining('Missing data fluency requirement'),
      expect.objectContaining({ system: expect.any(String), feature: 'cover-letter-finalise' }),
    )
  })
})
