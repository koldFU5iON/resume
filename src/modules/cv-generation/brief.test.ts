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
import { briefPrompt, runBrief } from './brief'
import { CvBriefSchema, parseBrief } from './schema'
import { gathered } from './__fixtures__/gathered'

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
    expect(text).toContain('Roles (most recent first)')
    expect(text).not.toContain('Activity 0 of role 0')
  })
})

describe('runBrief', () => {
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
