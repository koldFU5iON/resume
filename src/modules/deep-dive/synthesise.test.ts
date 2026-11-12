import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/llm/complete-json', () => ({ completeJSON: vi.fn() }))

import { completeJSON } from '@/modules/llm/complete-json'
import { finding, gatherFixture, modelReport, researchFixture } from './__fixtures__/inputs'
import type { DeepDiveResearch } from './schema'
import { DEEP_DIVE_FEATURES, DeepDiveReportSchema } from './schema'
import { enforceReportFacts, synthesise, synthesisPrompt } from './synthesise'

const mockJSON = vi.mocked(completeJSON)

beforeEach(() => vi.clearAllMocks())

const found = (...researchers: ('company' | 'pay' | 'practicalities')[]): DeepDiveResearch['findings'] =>
  researchers.map((r, i) => ({ ...finding(`f${i}`), researcher: r }))

const ev = (over: Record<string, unknown>) => ({ kind: 'finding', ref: '', detail: '', ...over })

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
    const out = enforceReportFacts(report, gatherFixture(), found('company'))
    expect(out.practicalities.sponsorship).toMatchObject({ register: 'licensed', needed: true })
  })

  it("keeps the model's sponsorship need when code can't tell", () => {
    const report = DeepDiveReportSchema.parse(modelReport())
    const g = gatherFixture({ sponsorship: { needed: null, jobCountries: [], register: 'not_applicable', sponsorStatus: null } })
    expect(enforceReportFacts(report, g, []).practicalities.sponsorship).toMatchObject({ register: 'not_applicable', needed: false })
  })

  it('drops evidence citing findings that do not exist', () => {
    const report = DeepDiveReportSchema.parse(modelReport({
      strengths: [{ point: 'p', evidence: [ev({ ref: '0' }), ev({ ref: '5' }), ev({ kind: 'register' })] }],
    }))
    expect(enforceReportFacts(report, gatherFixture(), found('company')).strengths[0].evidence).toEqual([
      { kind: 'finding', index: 0 },
      { kind: 'register' },
    ])
  })

  it('drops a market pay range with no pay finding behind it', () => {
    const market = (evidence: unknown[]) => DeepDiveReportSchema.parse(modelReport({
      pay: { stated: null, market: { min: 90000, max: 120000, currency: 'GBP', evidence }, ask: null, vsSearchProfile: 'x' },
    }))
    const f = found('company', 'pay')
    expect(enforceReportFacts(market([ev({ kind: 'jd', ref: 'great pay' })]), gatherFixture(), f).pay.market).toBeNull()
    expect(enforceReportFacts(market([ev({ ref: '3' })]), gatherFixture(), f).pay.market).toBeNull()
    expect(enforceReportFacts(market([ev({ ref: '0' })]), gatherFixture(), f).pay.market).toBeNull() // a company fact has no figures
    expect(enforceReportFacts(market([ev({ ref: '1' })]), gatherFixture(), f).pay.market).toMatchObject({ min: 90000 })
  })
})

describe('synthesise', () => {
  const ctx = { profileId: 'p1', jobApplicationId: 'job-1', runId: 'run-1', timeoutMs: 120_000, deadline: 1_900_000_000_000 }

  it('runs one JSON call with role analysis, the schema in the system prompt, generous caps and run attribution', async () => {
    mockJSON.mockResolvedValue({
      extracted: { ok: true, value: DeepDiveReportSchema.parse(modelReport()) }, finishReason: 'stop', rawText: '', model: 'analysis-model',
    })
    const res = await synthesise(gatherFixture(), researchFixture(), ctx)
    expect(res.model).toBe('analysis-model')
    expect(res.report.practicalities.sponsorship.register).toBe('licensed')
    const [profileId, , schema, opts] = mockJSON.mock.calls[0]
    expect(profileId).toBe('p1')
    expect(schema).toBe(DeepDiveReportSchema)
    expect(opts).toMatchObject({
      role: 'analysis',
      feature: DEEP_DIVE_FEATURES.synthesis,
      attribution: { jobApplicationId: 'job-1', runId: 'run-1' },
      timeoutMs: 120_000,
      deadline: 1_900_000_000_000,
    })
    expect(opts.model).toBeUndefined()
    expect(opts.webSearch).toBeUndefined()
    expect(opts.maxOutputTokens).toBeGreaterThanOrEqual(16_000)
    expect(opts.retryMaxOutputTokens).toBeGreaterThan(opts.maxOutputTokens!)
    expect(opts.system).toContain('"verdictSummary"')
    expect(opts.system).not.toContain('${')
  })

  it('throws invalid_output (logging finishReason, not the text) when the JSON is unusable', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockJSON.mockResolvedValue({
      extracted: { ok: false, reason: 'parse', error: new Error('x') }, finishReason: 'length', rawText: 'PRIVATE_PROFILE_MARKER', model: 'm',
    })
    await expect(synthesise(gatherFixture(), researchFixture(), ctx)).rejects.toMatchObject({ kind: 'invalid_output' })
    expect(err.mock.calls[0][1]).toMatchObject({ finishReason: 'length', reason: 'parse' })
    expect(JSON.stringify(err.mock.calls)).not.toContain('PRIVATE')
    err.mockRestore()
  })
})
