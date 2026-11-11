import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/llm/client', () => ({ completeStructured: vi.fn() }))

import { completeStructured } from '@/modules/llm/client'
import { finding, gatherFixture, modelReport, researchFixture } from './__fixtures__/inputs'
import { DEEP_DIVE_FEATURES, DeepDiveReportSchema } from './schema'
import { enforceReportFacts, synthesise, synthesisPrompt } from './synthesise'

const mockStructured = vi.mocked(completeStructured)

beforeEach(() => vi.clearAllMocks())

const ev = (over: Record<string, unknown>) => ({ kind: 'finding', quote: null, ref: null, text: null, index: null, ...over })

describe('synthesisPrompt', () => {
  it('puts the inputs in the cache-friendly order of spec §3.3', () => {
    const prompt = synthesisPrompt(gatherFixture(), researchFixture())
    const order = ['# Candidate', '# Job', '# Early assessment', '# Sponsorship facts', '# Findings']
    const positions = order.map((h) => prompt.indexOf(h))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('includes the profile, goals and notes (synthesis is the only step that sees them)', () => {
    const prompt = synthesisPrompt(gatherFixture(), researchFixture())
    expect(prompt).toContain('PRIVATE_PROFILE_MARKER')
    expect(prompt).toContain('PRIVATE_GOALS_MARKER')
    expect(prompt).toContain('PRIVATE_NOTES_MARKER')
    expect(prompt).toContain('Salary floor (GBP): 95000, target 110000')
  })

  it('numbers findings, names topics without research, and carries early blockers', () => {
    const prompt = synthesisPrompt(gatherFixture(), researchFixture([finding('Acme has 200 staff'), finding('Office in Leeds')]))
    expect(prompt).toContain('[0] (company/t, medium) Acme has 200 staff')
    expect(prompt).toContain('[1] (company/t, medium) Office in Leeds')
    expect(prompt).toContain('pay: failed (rate_limit)')
    expect(prompt).toContain('practicalities: nothing found')
    expect(prompt).toContain('[unconfirmed] Right to work in GB')
  })

  it('says when there is no early assessment', () => {
    expect(synthesisPrompt(gatherFixture({ earlyAssessment: null }), researchFixture())).toContain('No early assessment')
  })
})

describe('enforceReportFacts', () => {
  it('copies the register result and known sponsorship need from code', () => {
    const report = DeepDiveReportSchema.parse(modelReport())
    const out = enforceReportFacts(report, gatherFixture(), 1)
    expect(out.practicalities.sponsorship).toMatchObject({ register: 'licensed', needed: true })
  })

  it("keeps the model's sponsorship need when code can't tell", () => {
    const report = DeepDiveReportSchema.parse(modelReport())
    const g = gatherFixture({ sponsorship: { needed: null, jobCountries: [], register: 'not_applicable', sponsorStatus: null } })
    expect(enforceReportFacts(report, g, 0).practicalities.sponsorship).toMatchObject({ register: 'not_applicable', needed: false })
  })

  it('drops evidence citing findings that do not exist', () => {
    const report = DeepDiveReportSchema.parse(modelReport({
      strengths: [{ point: 'p', evidence: [ev({ index: 0 }), ev({ index: 5 }), ev({ kind: 'register' })] }],
    }))
    expect(enforceReportFacts(report, gatherFixture(), 1).strengths[0].evidence).toEqual([
      { kind: 'finding', index: 0 },
      { kind: 'register' },
    ])
  })

  it('drops a market pay range with no finding behind it', () => {
    const market = (evidence: unknown[]) => DeepDiveReportSchema.parse(modelReport({
      pay: { stated: null, market: { min: 90000, max: 120000, currency: 'GBP', evidence }, ask: null, vsSearchProfile: 'x' },
    }))
    expect(enforceReportFacts(market([ev({ kind: 'jd', quote: 'great pay' })]), gatherFixture(), 1).pay.market).toBeNull()
    expect(enforceReportFacts(market([ev({ index: 3 })]), gatherFixture(), 1).pay.market).toBeNull()
    expect(enforceReportFacts(market([ev({ index: 0 })]), gatherFixture(), 1).pay.market).toMatchObject({ min: 90000 })
  })
})

describe('synthesise', () => {
  it('runs one structured call with role analysis, a generous output cap and run attribution', async () => {
    mockStructured.mockResolvedValue({ object: DeepDiveReportSchema.parse(modelReport()), model: 'analysis-model' } as never)
    const res = await synthesise(gatherFixture(), researchFixture(), { profileId: 'p1', jobApplicationId: 'job-1', runId: 'run-1', timeoutMs: 120_000 })
    expect(res.model).toBe('analysis-model')
    expect(res.report.practicalities.sponsorship.register).toBe('licensed')
    const [profileId, , schema, opts] = mockStructured.mock.calls[0]
    expect(profileId).toBe('p1')
    expect(schema).toBe(DeepDiveReportSchema)
    expect(opts).toMatchObject({
      role: 'analysis',
      feature: DEEP_DIVE_FEATURES.synthesis,
      attribution: { jobApplicationId: 'job-1', runId: 'run-1' },
      timeoutMs: 120_000,
    })
    expect(opts.model).toBeUndefined()
    expect(opts.webSearch).toBeUndefined()
    expect(opts.maxOutputTokens).toBeGreaterThanOrEqual(16_000)
  })
})
