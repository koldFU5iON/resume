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
import { briefPrompt, runBrief } from './brief'
import { TEMPERATURE, CvBriefSchema, deriveItemName, parseBrief } from './schema'
import { gathered } from './__fixtures__/gathered'
import { leads, em } from './__fixtures__/candidates'

const mockJSON = vi.mocked(completeJSON)
const goodBrief = {
  hiddenQuestion: '  Can they ship a platform migration?  ',
  leadWith: leads(['a', 'b', 'c', 'd', 'e', 'f']),
  emphasise: [em('Release management', 'core')],
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
    // Too high comes down to the ceiling, too low comes up to the floor (caps.ts).
    expect(b.budgets).toEqual({ experiences: 4, skills: 12, tools: 6, competencies: 8, certifications: 6, education: 3, projects: 2 })
  })

  it('never goes below the floors: a stored brief with small numbers reads as the floors', () => {
    const small = { experiences: 1, skills: 3, tools: 2, competencies: 5, certifications: 3, education: 0, projects: 0 }
    expect(CvBriefSchema.parse({ ...goodBrief, budgets: small }).budgets).toEqual({ experiences: 4, skills: 12, tools: 6, competencies: 8, certifications: 6, education: 1, projects: 0 })
  })

  it('reads the old string shape of lead-with and emphasise, deriving the name', () => {
    const old = CvBriefSchema.parse({
      ...goodBrief,
      leadWith: ['Unity: storytelling for a developer platform across 8 years', 'Led the \u201cOne Marketing Request Form\u201d programme', 'Platform migration delivery'],
      emphasise: [{ item: 'Automation: ARM workflow and asset generation', why: 'core' }, { item: 'Release management', why: 'x' }],
    })
    expect(old.leadWith.map((l) => l.name)).toEqual(['Unity', 'One Marketing Request Form', 'Platform migration delivery'])
    expect(old.leadWith[0].framing).toBe('Unity: storytelling for a developer platform across 8 years')
    expect(old.emphasise[0]).toEqual({ name: 'Automation', framing: 'Automation: ARM workflow and asset generation', why: 'core' })
  })

  it('reads the new {name, framing} shape as given', () => {
    const b = CvBriefSchema.parse({ ...goodBrief, leadWith: [{ name: 'Unity', framing: 'storytelling for a developer platform' }], emphasise: [{ name: 'Automation', framing: 'workflow automation', why: 'core' }] })
    expect(b.leadWith).toEqual([{ name: 'Unity', framing: 'storytelling for a developer platform' }])
    expect(b.emphasise[0].name).toBe('Automation')
  })

  it('derives a name from the first capitalised phrase, or the first words of a plain sentence', () => {
    expect(deriveItemName('Built the Weta Tools & Games launch for creators')).toBe('Weta Tools & Games')
    expect(deriveItemName('platform migration work that mattered a great deal to everyone')).toBe('platform migration work that mattered a')
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

describe('runBrief', () => {
  it('never returns education 0 for a profile that has education', async () => {
    mockJSON.mockResolvedValue(ok({ ...goodBrief, budgets: { ...goodBrief.budgets, education: 0 } }))
    const r = await runBrief(gathered(), ctx)
    expect(r.value.budgets.education).toBe(1)
  })

  it('samples at the named low temperature, and records why when it had to retry', async () => {
    mockJSON.mockResolvedValueOnce(bad()).mockResolvedValueOnce(ok(goodBrief))
    const r = await runBrief(gathered(), ctx)
    expect(TEMPERATURE.brief).toBe(0.2)
    for (const c of mockJSON.mock.calls) expect(c[3]).toMatchObject({ temperature: TEMPERATURE.brief })
    expect(r.retryReasons).toEqual([expect.stringMatching(/the answer was rejected/)])
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

  it('adds the desk document to the attribution when it is known (and only then)', async () => {
    mockJSON.mockResolvedValue(ok(goodBrief))
    await runBrief(gathered(), { ...ctx, writingDeskDocumentId: 'doc-1' })
    expect(mockJSON.mock.calls[0][3]).toMatchObject({ attribution: { jobApplicationId: 'job-1', runId: 'run-1', writingDeskDocumentId: 'doc-1' } })
    mockJSON.mockClear()
    await runBrief(gathered(), { ...ctx, writingDeskDocumentId: null })
    expect((mockJSON.mock.calls[0][3] as { attribution: object }).attribution).toEqual({ jobApplicationId: 'job-1', runId: 'run-1' })
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

describe('tolerant Brief reader and name derivation', () => {
  it('defaults a missing framing to the name instead of failing the Brief', () => {
    const b = CvBriefSchema.parse({ ...goodBrief, leadWith: [{ name: 'Unity' }], emphasise: [{ name: 'Automation', why: 'core' }] })
    expect(b.leadWith[0]).toEqual({ name: 'Unity', framing: 'Unity' })
    expect(b.emphasise[0].framing).toBe('Automation')
  })
  it('does not read an apostrophe as an opening quote', () => {
    expect(deriveItemName("Weta's games and Unity's tools")).not.toMatch(/^s /)
    expect(deriveItemName("Led the 'Request Form' programme")).toBe('Request Form')
  })
})
