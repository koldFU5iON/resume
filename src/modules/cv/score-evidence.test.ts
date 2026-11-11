import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/llm/client', () => ({
  completeStructured: vi.fn(),
}))
vi.mock('@/modules/llm/prompt-context', () => ({
  loadEvidenceScoringPrompt: vi.fn(),
  composeSystem: vi.fn(),
}))

import { applyRoleBudgets, scoreEvidence } from './score-evidence'
import { completeStructured } from '@/modules/llm/client'
import { loadEvidenceScoringPrompt, composeSystem } from '@/modules/llm/prompt-context'
import type { ProfileSnapshot } from '@/modules/profile/snapshot'
import type { JobAnalysis } from '@/modules/jobs/schema'

const mockCompleteStructured = vi.mocked(completeStructured)
const mockLoadPrompt = vi.mocked(loadEvidenceScoringPrompt)
const mockComposeSystem = vi.mocked(composeSystem)

const PROFILE_ID = 'profile-1'

function makeActivity(kind: string, description: string, highlighted = false) {
  return { kind, description, impact: null, highlighted }
}

const MOCK_SNAPSHOT: ProfileSnapshot = {
  name: 'Test User',
  email: null,
  phone: null,
  website: null,
  linkedin: null,
  location: null,
  headline: null,
  github: null,
  summary: null,
  tools: [],
  experiences: [
    {
      role: 'Director',
      company: 'Acme',
      startDate: new Date('2020-01-01'),
      endDate: null,
      location: null,
      remote: false,
      summary: 'Led EMEA.',
      activities: [
        makeActivity('achievement', 'Led 8 territories', true),
        makeActivity('achievement', 'Managed €500k budget', true),
        makeActivity('responsibility', 'Line managed 4 leads', false),
        makeActivity('responsibility', 'Generic admin work', false),
      ],
    },
    {
      role: 'Manager',
      company: 'Beta',
      startDate: new Date('2016-01-01'),
      endDate: new Date('2019-12-31'),
      location: null,
      remote: false,
      summary: 'Agency lead.',
      activities: [
        makeActivity('achievement', 'Won 3 new accounts', true),
        makeActivity('achievement', 'Delivered 14,000 registrations', true),
        makeActivity('responsibility', 'Monthly client reports', false),
        makeActivity('responsibility', 'Team admin', false),
        makeActivity('responsibility', 'Event attendance', false),
      ],
    },
  ],
  skills: [],
  educations: [],
  certifications: [],
  competencies: [],
  languages: [],
  projects: [],
}

const MOCK_ANALYSIS: JobAnalysis = {
  mustHave: ['Multi-territory', 'Budget ownership'],
  niceToHave: ['Agency experience'],
  risks: [],
  positioningStrategy: 'Lead with multi-territory scope and budget ownership.',
}

describe('applyRoleBudgets', () => {
  it('trims role 0 to 5 activities', () => {
    const snapshot: ProfileSnapshot = {
      ...MOCK_SNAPSHOT,
      experiences: [
        {
          ...MOCK_SNAPSHOT.experiences[0],
          activities: Array(7).fill(makeActivity('achievement', 'Activity')),
        },
      ],
    }
    const result = applyRoleBudgets(snapshot)
    expect(result.experiences[0].activities).toHaveLength(5)
  })

  it('trims role 1 to 4 activities', () => {
    const snapshot: ProfileSnapshot = {
      ...MOCK_SNAPSHOT,
      experiences: [
        MOCK_SNAPSHOT.experiences[0],
        {
          ...MOCK_SNAPSHOT.experiences[1],
          activities: Array(6).fill(makeActivity('achievement', 'Activity')),
        },
      ],
    }
    const result = applyRoleBudgets(snapshot)
    expect(result.experiences[1].activities).toHaveLength(4)
  })

  it('trims role 2+ to 3 activities', () => {
    const olderRole = {
      ...MOCK_SNAPSHOT.experiences[0],
      activities: Array(5).fill(makeActivity('achievement', 'Activity')),
    }
    const snapshot: ProfileSnapshot = {
      ...MOCK_SNAPSHOT,
      experiences: [
        MOCK_SNAPSHOT.experiences[0],
        MOCK_SNAPSHOT.experiences[1],
        olderRole,
      ],
    }
    const result = applyRoleBudgets(snapshot)
    expect(result.experiences[2].activities).toHaveLength(3)
  })

  it('does not trim roles already within budget', () => {
    const result = applyRoleBudgets(MOCK_SNAPSHOT)
    expect(result.experiences[0].activities).toHaveLength(4)
    expect(result.experiences[1].activities).toHaveLength(4)
  })

  it('does not mutate the original snapshot', () => {
    const original = MOCK_SNAPSHOT.experiences[0].activities.length
    applyRoleBudgets(MOCK_SNAPSHOT)
    expect(MOCK_SNAPSHOT.experiences[0].activities).toHaveLength(original)
  })
})

describe('scoreEvidence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadPrompt.mockResolvedValue('Score prompt')
    mockComposeSystem.mockReturnValue('Composed system')
  })

  it('filters activities by tier — cut activities are removed', async () => {
    mockCompleteStructured.mockResolvedValue({
      object: {
        scores: [
          { experienceIndex: 0, activityIndex: 0, score: 9, tier: 'must-include' },
          { experienceIndex: 0, activityIndex: 1, score: 8, tier: 'must-include' },
          { experienceIndex: 0, activityIndex: 2, score: 2, tier: 'cut' },
          { experienceIndex: 0, activityIndex: 3, score: 1, tier: 'cut' },
          { experienceIndex: 1, activityIndex: 0, score: 7, tier: 'must-include' },
          { experienceIndex: 1, activityIndex: 1, score: 6, tier: 'useful-context' },
          { experienceIndex: 1, activityIndex: 2, score: 3, tier: 'cut' },
          { experienceIndex: 1, activityIndex: 3, score: 2, tier: 'cut' },
          { experienceIndex: 1, activityIndex: 4, score: 1, tier: 'cut' },
        ],
      },
    } as never)

    const result = await scoreEvidence(PROFILE_ID, MOCK_SNAPSHOT, MOCK_ANALYSIS)

    expect(result.experiences[0].activities).toHaveLength(2)
    expect(result.experiences[1].activities).toHaveLength(2)
  })

  it('sorts remaining activities by score descending', async () => {
    mockCompleteStructured.mockResolvedValue({
      object: {
        scores: [
          { experienceIndex: 0, activityIndex: 0, score: 7, tier: 'must-include' },
          { experienceIndex: 0, activityIndex: 1, score: 9, tier: 'must-include' },
          { experienceIndex: 0, activityIndex: 2, score: 2, tier: 'cut' },
          { experienceIndex: 0, activityIndex: 3, score: 2, tier: 'cut' },
          { experienceIndex: 1, activityIndex: 0, score: 5, tier: 'useful-context' },
          { experienceIndex: 1, activityIndex: 1, score: 8, tier: 'must-include' },
          { experienceIndex: 1, activityIndex: 2, score: 1, tier: 'cut' },
          { experienceIndex: 1, activityIndex: 3, score: 1, tier: 'cut' },
          { experienceIndex: 1, activityIndex: 4, score: 1, tier: 'cut' },
        ],
      },
    } as never)

    const result = await scoreEvidence(PROFILE_ID, MOCK_SNAPSHOT, MOCK_ANALYSIS)

    // Higher-scored activity (index 1, score 9) should come before index 0 (score 7)
    expect(result.experiences[0].activities[0].description).toBe('Managed €500k budget')
    expect(result.experiences[0].activities[1].description).toBe('Led 8 territories')
    // In role 1, activity index 1 (score 8) should come before index 0 (score 5)
    expect(result.experiences[1].activities[0].description).toBe('Delivered 14,000 registrations')
    expect(result.experiences[1].activities[1].description).toBe('Won 3 new accounts')
  })

  it('enforces role budget after filtering', async () => {
    // 5 must-include activities for role 0 — budget is 5, so all survive
    // 6 must-include activities for role 1 — budget is 4, so 2 are cut
    const manyActivities = Array(6).fill(null).map((_, ai) => ({
      experienceIndex: 1,
      activityIndex: ai,
      score: 8,
      tier: 'must-include' as const,
    }))
    mockCompleteStructured.mockResolvedValue({
      object: {
        scores: [
          { experienceIndex: 0, activityIndex: 0, score: 9, tier: 'must-include' },
          { experienceIndex: 0, activityIndex: 1, score: 8, tier: 'must-include' },
          { experienceIndex: 0, activityIndex: 2, score: 2, tier: 'cut' },
          { experienceIndex: 0, activityIndex: 3, score: 2, tier: 'cut' },
          ...manyActivities,
        ],
      },
    } as never)

    const snapshotWith6InRole1: ProfileSnapshot = {
      ...MOCK_SNAPSHOT,
      experiences: [
        MOCK_SNAPSHOT.experiences[0],
        {
          ...MOCK_SNAPSHOT.experiences[1],
          activities: Array(6).fill(makeActivity('achievement', 'Activity')),
        },
      ],
    }

    const result = await scoreEvidence(PROFILE_ID, snapshotWith6InRole1, MOCK_ANALYSIS)
    expect(result.experiences[1].activities).toHaveLength(4)
  })

  it('falls back to applyRoleBudgets when the LLM call fails', async () => {
    mockCompleteStructured.mockRejectedValue(new Error('LLM timeout'))

    const result = await scoreEvidence(PROFILE_ID, MOCK_SNAPSHOT, MOCK_ANALYSIS)

    // Fallback: role budgets applied, all 4 activities in role 0 survive (within budget)
    expect(result.experiences[0].activities).toHaveLength(4)
    expect(result.experiences[1].activities).toHaveLength(4)
  })

  it('falls back to budget slice when LLM marks all activities as cut', async () => {
    mockCompleteStructured.mockResolvedValue({
      object: {
        scores: [
          { experienceIndex: 0, activityIndex: 0, score: 1, tier: 'cut' },
          { experienceIndex: 0, activityIndex: 1, score: 1, tier: 'cut' },
          { experienceIndex: 0, activityIndex: 2, score: 1, tier: 'cut' },
          { experienceIndex: 0, activityIndex: 3, score: 1, tier: 'cut' },
          { experienceIndex: 1, activityIndex: 0, score: 8, tier: 'must-include' },
          { experienceIndex: 1, activityIndex: 1, score: 7, tier: 'must-include' },
          { experienceIndex: 1, activityIndex: 2, score: 1, tier: 'cut' },
          { experienceIndex: 1, activityIndex: 3, score: 1, tier: 'cut' },
          { experienceIndex: 1, activityIndex: 4, score: 1, tier: 'cut' },
        ],
      },
    } as never)

    const result = await scoreEvidence(PROFILE_ID, MOCK_SNAPSHOT, MOCK_ANALYSIS)

    // Role 0: all cut → falls back to budget slice (4 activities, all within budget of 5)
    expect(result.experiences[0].activities).toHaveLength(4)
    // Role 1: 2 survivors — normal scoring path
    expect(result.experiences[1].activities).toHaveLength(2)
  })

  it('calls completeStructured with feature cv-evidence-score', async () => {
    mockCompleteStructured.mockResolvedValue({
      object: { scores: [] },
    } as never)

    await scoreEvidence(PROFILE_ID, MOCK_SNAPSHOT, MOCK_ANALYSIS)

    expect(mockCompleteStructured).toHaveBeenCalledWith(
      PROFILE_ID,
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ feature: 'cv-evidence-score' }),
    )
  })

  it('includes a JOB INTELLIGENCE block with risks and positioning', async () => {
    mockCompleteStructured.mockResolvedValue({ object: { scores: [] } } as never)

    const analysisWithRisks: JobAnalysis = {
      ...MOCK_ANALYSIS,
      risks: [
        { risk: 'No enterprise sales experience', severity: 'high', recommendation: 'Lead with large-account wins.' },
      ],
    }

    await scoreEvidence(PROFILE_ID, MOCK_SNAPSHOT, analysisWithRisks)

    const [, userMessage] = mockCompleteStructured.mock.calls[0]
    expect(userMessage).toContain('== JOB INTELLIGENCE ==')
    expect(userMessage).toContain('Lead with multi-territory scope and budget ownership.')
    expect(userMessage).toContain('[HIGH] No enterprise sales experience')
    expect(userMessage).toContain('Lead with large-account wins.')
  })

  it('omits the risks section when analysis has no risks', async () => {
    mockCompleteStructured.mockResolvedValue({ object: { scores: [] } } as never)

    await scoreEvidence(PROFILE_ID, MOCK_SNAPSHOT, MOCK_ANALYSIS)

    const [, userMessage] = mockCompleteStructured.mock.calls[0]
    expect(userMessage).toContain('== JOB INTELLIGENCE ==')
    expect(userMessage).not.toContain('Risks:')
  })
})
