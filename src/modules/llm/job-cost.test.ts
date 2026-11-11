import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    jobApplication: { findFirst: vi.fn() },
    llmUsageLog: { findMany: vi.fn() },
    cVDocument: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/db'
import { buildJobCostSummary, getJobCostSummary, summarizeRows, type UsageRow } from './job-cost'
import { estimateRowCostUsd, PRICING_RATES_AS_OF } from './pricing'

const row = (over: Partial<UsageRow>): UsageRow => ({
  provider: 'anthropic', model: 'claude-sonnet-5-5', feature: 'job-fit',
  promptTokens: 1_000, completionTokens: 100,
  cacheReadTokens: null, cacheWriteTokens: null, serverToolCalls: 0,
  usageKnown: true, status: 'ok', errorKind: null, latencyMs: 1_000, cvDocumentId: null, runId: null,
  ...over,
})

// One job: assessment run (Jev + facts), job fit, then CV 1 generated twice
// (a regeneration) and ATS-checked, and CV 2 generated once.
const rows: UsageRow[] = [
  row({ provider: 'typesafe', model: 'jev-1.14.0', feature: 'job-assessment-verify', promptTokens: 2_000, completionTokens: 5, runId: 'a1' }),
  row({ provider: 'typesafe', model: 'jev-1.14.0', feature: 'job-assessment-judge:failed', promptTokens: 0, completionTokens: 0, usageKnown: false, runId: 'a1' }),
  row({ model: 'claude-haiku-5-5', feature: 'job-assessment-facts', runId: 'a1' }),
  row({ feature: 'job-fit' }),
  row({ feature: 'cv-job-analysis', cvDocumentId: 'cv-1', runId: 'g1' }),
  row({ feature: 'cv-generate', cvDocumentId: 'cv-1', runId: 'g1', promptTokens: 10_000, completionTokens: 2_000 }),
  row({ feature: 'cv-recruiter-scan', cvDocumentId: 'cv-1', runId: 'g1' }),
  row({ feature: 'cv-generate', cvDocumentId: 'cv-1', runId: 'g2', promptTokens: 10_000, completionTokens: 2_000 }),
  row({ feature: 'ats-interpret', cvDocumentId: 'cv-1', runId: 'ats1' }),
  row({ feature: 'cv-generate', cvDocumentId: 'cv-2', runId: 'g3', promptTokens: 10_000, completionTokens: 2_000 }),
]
const cvs = [{ id: 'cv-1', status: 'draft' }, { id: 'cv-2', status: 'failed' }, { id: 'cv-3', status: 'draft' }]

describe('estimateRowCostUsd', () => {
  it('prices cache reads and writes at their own rates out of the total input', () => {
    // Sonnet 5.5: $2 in, $10 out, $0.10 cache read, $2.50 cache write per MTok.
    const usd = estimateRowCostUsd({
      provider: 'anthropic', model: 'claude-sonnet-5-5',
      promptTokens: 1_000_000, completionTokens: 100_000, cacheReadTokens: 600_000, cacheWriteTokens: 100_000,
    })
    expect(usd).toBeCloseTo(0.3 * 2 + 0.1 * 10 + 0.6 * 0.1 + 0.1 * 2.5, 10)
  })

  it('returns null for an unpriced model instead of guessing', () => {
    expect(estimateRowCostUsd({ provider: 'openai', model: 'gpt-x', promptTokens: 1, completionTokens: 1, cacheReadTokens: null, cacheWriteTokens: null })).toBeNull()
  })
})

describe('buildJobCostSummary', () => {
  const s = buildJobCostSummary('job-1', rows, cvs)

  it('totals the full workflow, including failed and unknown-usage calls', () => {
    expect(s.workflow).toMatchObject({ requests: 10, failedRequests: 1, unknownUsageRequests: 1, runs: 5 })
    expect(s.workflow.latencyMs).toEqual({ total: 10_000, avg: 1_000 })
    expect(s.workflow.estimateComplete).toBe(false)
  })

  it('separates generation-call cost from the full workflow', () => {
    expect(s.generationCalls).toMatchObject({ requests: 3, inputTokens: 30_000, outputTokens: 6_000, runs: 3 })
    expect(s.generationCalls.estimatedCostUsd).toBeCloseTo(3 * (0.01 * 2 + 0.002 * 10), 10)
    expect(s.generationCalls.estimateComplete).toBe(true)
    expect(s.workflow.estimatedCostUsd).toBeGreaterThan(s.generationCalls.estimatedCostUsd)
  })

  it('groups by CV (attempts included), with job-level calls apart and CVs with no usage listed', () => {
    const byCv = Object.fromEntries(s.byCv.map((b) => [String(b.cvDocumentId), b]))
    expect(byCv['cv-1']).toMatchObject({ requests: 5, runs: 3, status: 'draft' })
    expect(byCv['cv-2']).toMatchObject({ requests: 1, status: 'failed' })
    expect(byCv['cv-3']).toMatchObject({ requests: 0, estimatedCostUsd: 0 })
    expect(byCv['null']).toMatchObject({ requests: 4, status: null })
    expect(s.byCv.at(-1)!.cvDocumentId).toBeNull()
  })

  it('folds failed calls into their feature', () => {
    expect(s.byFeature.find((f) => f.feature === 'job-assessment-judge')).toMatchObject({ requests: 1, failedRequests: 1 })
    expect(s.byFeature.some((f) => f.feature.endsWith(':failed'))).toBe(false)
  })

  it('labels the money as an estimate and reports no actual charges or accepted-CV cost', () => {
    expect(s.pricing).toMatchObject({ kind: 'estimate', currency: 'USD', ratesAsOf: PRICING_RATES_AS_OF })
    expect(s.pricing.notes.join(' ')).toMatch(/100K tokens/)
    expect(s.actualChargesUsd).toBeNull()
    expect(s.costPerAcceptedCv).toBeNull()
  })
})

describe('summarizeRows', () => {
  it('keeps unreported cache/tool columns null, and flags unpriced models and web searches', () => {
    const b = summarizeRows([row({ serverToolCalls: null }), row({ provider: 'openai', model: 'gpt-x', serverToolCalls: 3 })])
    expect(b.cacheReadTokens).toBeNull()
    expect(b.serverToolCalls).toBe(3)
    expect(b.unpricedModels).toEqual(['openai/gpt-x'])
    expect(b.estimateComplete).toBe(false)
  })
})

describe('failed calls in the summary', () => {
  it('counts BYOK error rows and legacy Jev :failed rows, grouped by kind', () => {
    const b = summarizeRows([
      row({ status: 'error', errorKind: 'timeout', usageKnown: false, promptTokens: 0, completionTokens: 0 }),
      row({ status: 'error', errorKind: 'timeout', usageKnown: false, promptTokens: 0, completionTokens: 0 }),
      row({ provider: 'typesafe', model: 'jev-1.14.0', feature: 'job-assessment-judge:failed', usageKnown: false }),
      row({}),
    ])
    expect(b).toMatchObject({ requests: 4, failedRequests: 3, unknownUsageRequests: 3, failuresByKind: { timeout: 2, unknown: 1 } })
  })
})

describe('getJobCostSummary', () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns null for a job the profile doesn't own, without reading usage", async () => {
    vi.mocked(prisma.jobApplication.findFirst).mockResolvedValueOnce(null)
    expect(await getJobCostSummary('p1', 'job-x')).toBeNull()
    expect(prisma.jobApplication.findFirst).toHaveBeenCalledWith({ where: { id: 'job-x', profileId: 'p1' }, select: { id: true } })
    expect(prisma.llmUsageLog.findMany).not.toHaveBeenCalled()
  })

  it("reads only the profile's explicitly attributed rows for the job", async () => {
    vi.mocked(prisma.jobApplication.findFirst).mockResolvedValueOnce({ id: 'job-1' } as never)
    vi.mocked(prisma.llmUsageLog.findMany).mockResolvedValueOnce(rows as never)
    vi.mocked(prisma.cVDocument.findMany).mockResolvedValueOnce(cvs as never)
    const s = await getJobCostSummary('p1', 'job-1')
    expect(s?.workflow.requests).toBe(10)
    expect(vi.mocked(prisma.llmUsageLog.findMany).mock.calls[0][0]).toMatchObject({ where: { profileId: 'p1', jobApplicationId: 'job-1' } })
  })
})
