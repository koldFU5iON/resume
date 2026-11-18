import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/modules/llm/complete-json', () => ({ completeJSON: vi.fn() }))
vi.mock('@/modules/llm/prompt-context', () => ({
  composeSystem: (...p: string[]) => p.join('\n---\n'),
  loadCVBriefPrompt: vi.fn().mockResolvedValue('BRIEF INSTRUCTIONS'),
}))

import { z } from 'zod'
import { completeJSON } from '@/modules/llm/complete-json'
import { LLMError } from '@/modules/llm/errors'
import { readFileSync } from 'node:fs'
import { applyProfileBudgets, briefPrompt, runBrief } from './brief'
import { CvBriefSchema, parseBrief } from './schema'
import { gathered } from './__fixtures__/gathered'
import { bigCandidates } from './__fixtures__/candidates'

const mockJSON = vi.mocked(completeJSON)
const goodBrief = {
  hiddenQuestion: '  Can they ship a platform migration?  ',
  leadWith: ['a', 'b', 'c', 'd', 'e', 'f'],
  emphasise: [{ item: 'Release management', why: 'core' }],
  playDown: [],
  positioning: 'p',
  tone: 'plain',
  budgets: { experiences: 9, skills: 40, tools: 3.6, competencies: -2, certifications: 2, education: 3, projects: 2 },
}
const ok = (value: unknown) => ({ extracted: { ok: true as const, value: CvBriefSchema.parse(value) }, finishReason: 'stop', rawText: '', model: 'm-analysis' })
const bad = (reason: 'no_json' | 'parse' | 'schema' = 'schema') => ({
  extracted: { ok: false as const, reason, error: reason === 'schema' ? new z.ZodError([{ code: 'custom', message: 'x', path: ['budgets', 'skills'] }]) : null },
  finishReason: 'stop', rawText: 'SECRET PROFILE TEXT', model: 'm-analysis',
})

const ctx = { profileId: 'p1', jobApplicationId: 'job-1', runId: 'run-1', deadline: Date.now() + 120_000 }
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('CvBriefSchema', () => {
  it('trims, caps lists and clamps budgets to the code caps', () => {
    const b = CvBriefSchema.parse(goodBrief)
    expect(b.hiddenQuestion).toBe('Can they ship a platform migration?')
    expect(b.leadWith).toHaveLength(4)
    expect(b.budgets).toEqual({ experiences: 4, skills: 12, tools: 4, competencies: 0, certifications: 2, education: 3, projects: 2 })
  })

  it('always shows at least one role', () => {
    expect(CvBriefSchema.parse({ ...goodBrief, budgets: { ...goodBrief.budgets, experiences: 0 } }).budgets.experiences).toBe(1)
  })

  it('rejects a brief missing a field, and parseBrief tolerates junk', () => {
    expect(CvBriefSchema.safeParse({ ...goodBrief, positioning: undefined }).success).toBe(false)
    expect(parseBrief(null)).toBeNull()
    expect(parseBrief('x')).toBeNull()
    expect(parseBrief(CvBriefSchema.parse(goodBrief))).toMatchObject({ tone: 'plain' })
  })
})

describe('briefPrompt', () => {
  it('carries the job, the strategy and the outline, not the detailed evidence', () => {
    const text = briefPrompt(gathered())
    expect(text).toContain('Head of Delivery')
    expect(text).toContain('Run our delivery org.')
    expect(text).toContain('Source: job-analysis')
    expect(text).toContain('Delivery lead at scale.')
    expect(text).toContain('Employers (most recent first')
    expect(text).not.toContain('Activity 0 of role 0')
  })
})

describe('the brief prompt file', () => {
  const text = readFileSync('src/lib/prompts/cv-gen-brief.md', 'utf8')

  it('infers the hidden question only from the job description and strategy, and invents no company facts', () => {
    expect(text).toContain('inferred ONLY from the job description and the strategy source')
    expect(text).toContain('Never state a fact about the company')
  })

  it('keeps lead-with and emphasise to roles and themes in the outline, with no numbers, results or tools of its own', () => {
    expect(text).toMatch(/Lead with\.\*\* .*appears in the candidate outline/)
    expect(text).toContain('Never name a number, a result or a tool that the outline does not show')
    expect(text).toMatch(/Emphasise\.\*\* .*never a number, result or tool the outline does not show/)
  })

  it('says role titles are facts: play down is about framing, never a title or an employer, and progression is sub-text', () => {
    expect(text).toContain('Role titles are facts and cannot be changed or hidden')
    expect(text).toContain('It never changes or hides a role title, and it never removes an employer')
    expect(text).toContain('progression line')
    expect(text).toContain('Playing down only changes emphasis and framing')
  })

  it('never names a model', () => {
    expect(text).not.toMatch(/claude|opus|sonnet|haiku|gpt|gemini/i)
  })

  it('says the brief is direction, not evidence', () => {
    expect(text).toContain('The brief is direction, not evidence.')
  })
})

describe('applyProfileBudgets', () => {
  const b = CvBriefSchema.parse({ ...goodBrief, budgets: { ...goodBrief.budgets, education: 0 } })

  it('raises education to 1 when the profile has education', () => {
    expect(applyProfileBudgets(b, bigCandidates()).budgets.education).toBe(1)
  })

  it('leaves 0 alone when the profile has none, and never lowers a budget', () => {
    expect(applyProfileBudgets(b, { education: [] }).budgets.education).toBe(0)
    expect(applyProfileBudgets({ ...b, budgets: { ...b.budgets, education: 3 } }, bigCandidates()).budgets.education).toBe(3)
  })
})

describe('runBrief', () => {
  it('never returns education 0 for a profile that has education', async () => {
    mockJSON.mockResolvedValue(ok({ ...goodBrief, budgets: { ...goodBrief.budgets, education: 0 } }))
    const r = await runBrief(gathered(), ctx)
    expect(r.value.budgets.education).toBe(1)
  })

  it('runs the analysis role under the brief tag, attributed to the run', async () => {
    mockJSON.mockResolvedValue(ok(goodBrief))
    const r = await runBrief(gathered(), ctx)
    expect(mockJSON).toHaveBeenCalledTimes(1)
    expect(mockJSON).toHaveBeenCalledWith('p1', expect.stringContaining('Candidate outline'), CvBriefSchema, expect.objectContaining({
      role: 'analysis',
      feature: 'cv-gen-brief',
      attribution: { jobApplicationId: 'job-1', runId: 'run-1' },
      system: expect.stringContaining('BRIEF INSTRUCTIONS'),
    }))
    expect(r).toMatchObject({ model: 'm-analysis', retries: 0 })
    expect(r.value.budgets.experiences).toBe(4)
  })

  it('retries once when the answer does not match, naming the fields but not echoing the text', async () => {
    mockJSON.mockResolvedValueOnce(bad()).mockResolvedValueOnce(ok(goodBrief))
    const r = await runBrief(gathered(), ctx)
    expect(r.retries).toBe(1)
    expect(mockJSON).toHaveBeenCalledTimes(2)
    const retryPrompt = mockJSON.mock.calls[1][1]
    expect(retryPrompt).toContain('budgets.skills')
    expect(retryPrompt).not.toContain('SECRET PROFILE TEXT')
  })

  it('fails with invalid_output after the second bad answer', async () => {
    mockJSON.mockResolvedValue(bad('parse'))
    await expect(runBrief(gathered(), ctx)).rejects.toMatchObject({ name: 'LLMError', kind: 'invalid_output' })
    expect(mockJSON).toHaveBeenCalledTimes(2)
  })

  it('does not retry when there is no time left', async () => {
    mockJSON.mockResolvedValue(bad())
    await expect(runBrief(gathered(), { ...ctx, deadline: Date.now() + 1_000 })).rejects.toBeInstanceOf(LLMError)
    expect(mockJSON).toHaveBeenCalledTimes(1)
  })

  it('lets a provider error through for the runner to map', async () => {
    mockJSON.mockRejectedValue(new LLMError('slow down', 'rate_limit'))
    await expect(runBrief(gathered(), ctx)).rejects.toMatchObject({ kind: 'rate_limit' })
  })
})

describe('the select prompt file', () => {
  const text = readFileSync('src/lib/prompts/cv-gen-select.md', 'utf8')

  it('selects employers with a relevance score, lists the current employer first, and explains the bullet allocation', () => {
    expect(text).toContain('You choose employers, not single roles')
    expect(text).toContain('`relevance` score from 1')
    expect(text).toContain('list the current employer first')
    expect(text).toContain('in proportion to their relevance scores')
    expect(text).toContain('recency does not decide it')
    expect(text).toContain('Role titles are facts')
  })

  it('points at the section that holds the bullet total, and tells the model to score honestly with anchors', () => {
    expect(text).toContain('the number is under "# Bullets"')
    expect(text).not.toContain('the number is in the budgets')
    expect(text).not.toContain('same number')
    expect(text).toContain('score honestly')
    expect(text).toContain('5 = central')
    expect(text).toContain('3 = supports the story but is not central')
    expect(text).toContain('1 = barely relevant')
  })

  it('says one of several current employers must be included', () => {
    expect(text).toContain('at least one of them must be included')
  })

  it('never names a model', () => {
    expect(text).not.toMatch(/claude|opus|sonnet|haiku|gpt|gemini/i)
  })
})
