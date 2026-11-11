// Read-only per-job usage summary built from explicitly attributed
// LlmUsageLog rows (see ./attribution.ts). Rows written before attribution
// existed have no job id and are never matched here — nothing is inferred
// from timestamps.

import { prisma } from '@/lib/db'
import { JEV_FAILED_FEATURE_SUFFIX } from '@/modules/jev/constants'
import {
  estimateRowCostUsd,
  PRICING_CURRENCY,
  PRICING_RATES_AS_OF,
  PRICING_SOURCE,
  rateFor,
} from './pricing'

/** The feature tag of the call that writes a CV draft. */
export const CV_GENERATION_FEATURE = 'cv-generate'

export type UsageRow = {
  provider: string
  model: string
  feature: string | null
  promptTokens: number
  completionTokens: number
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  serverToolCalls: number | null
  usageKnown: boolean
  latencyMs: number
  cvDocumentId: string | null
  runId: string | null
}

export type UsageBucket = {
  requests: number
  /** Calls that failed (app-billed rows marked `:failed`); usage unknown. */
  failedRequests: number
  /** Rows whose token counts are placeholders, not provider-reported. */
  unknownUsageRequests: number
  inputTokens: number
  outputTokens: number
  /** Sums of reported values; null when no row in the bucket reported any. */
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  serverToolCalls: number | null
  runs: number
  latencyMs: { total: number; avg: number }
  /** Estimate from list prices (see `pricing`); never an actual charge. */
  estimatedCostUsd: number
  /**
   * False when the estimate is missing something: unpriced models, rows with
   * unknown usage, or server tool calls (web search/fetch) that have no rate.
   */
  estimateComplete: boolean
  unpricedModels: string[]
}

export type JobCostSummary = {
  jobApplicationId: string
  /** Full workflow: every attributed call for the job (assessment, fit, CVs, letters, …). */
  workflow: UsageBucket
  /** Only the CV draft calls (`cv-generate`), across all CVs and attempts. */
  generationCalls: UsageBucket
  byFeature: (UsageBucket & { feature: string })[]
  /** Per CV; `cvDocumentId: null` holds job-level calls not tied to a CV. */
  byCv: (UsageBucket & { cvDocumentId: string | null; status: string | null })[]
  /**
   * Cost per accepted CV. CVs have no "accepted" state yet (statuses are
   * generating / draft / failed), so this stays null rather than counting
   * drafts as accepted.
   */
  costPerAcceptedCv: null
  /** Actual charges are not known: BYOK calls are billed by the provider to the user. */
  actualChargesUsd: null
  pricing: { kind: 'estimate'; source: string; currency: typeof PRICING_CURRENCY; ratesAsOf: string; notes: string[] }
}

function baseFeature(feature: string | null): string {
  const f = feature ?? 'unknown'
  return f.endsWith(JEV_FAILED_FEATURE_SUFFIX) ? f.slice(0, -JEV_FAILED_FEATURE_SUFFIX.length) : f
}

const addNullable = (a: number | null, b: number | null) => (b === null ? a : (a ?? 0) + b)

/** Pure aggregation of usage rows into one bucket. */
export function summarizeRows(rows: readonly UsageRow[]): UsageBucket {
  const unpriced = new Set<string>()
  const runs = new Set<string>()
  let cost = 0
  let complete = true
  const b: UsageBucket = {
    requests: 0, failedRequests: 0, unknownUsageRequests: 0,
    inputTokens: 0, outputTokens: 0,
    cacheReadTokens: null, cacheWriteTokens: null, serverToolCalls: null,
    runs: 0, latencyMs: { total: 0, avg: 0 },
    estimatedCostUsd: 0, estimateComplete: true, unpricedModels: [],
  }
  for (const r of rows) {
    b.requests++
    if (r.feature?.endsWith(JEV_FAILED_FEATURE_SUFFIX)) b.failedRequests++
    if (!r.usageKnown) { b.unknownUsageRequests++; complete = false }
    b.inputTokens += r.promptTokens
    b.outputTokens += r.completionTokens
    b.cacheReadTokens = addNullable(b.cacheReadTokens, r.cacheReadTokens)
    b.cacheWriteTokens = addNullable(b.cacheWriteTokens, r.cacheWriteTokens)
    b.serverToolCalls = addNullable(b.serverToolCalls, r.serverToolCalls)
    if (r.serverToolCalls) complete = false // per-call tool fees have no rate here
    b.latencyMs.total += r.latencyMs
    if (r.runId) runs.add(r.runId)
    const rowCost = estimateRowCostUsd(r)
    if (rowCost === null) {
      unpriced.add(`${r.provider}/${r.model}`)
      complete = false
    } else {
      cost += rowCost
    }
  }
  b.runs = runs.size
  b.latencyMs.avg = b.requests ? Math.round(b.latencyMs.total / b.requests) : 0
  b.estimatedCostUsd = cost
  b.estimateComplete = complete
  b.unpricedModels = [...unpriced].sort()
  return b
}

function groupBy<K>(rows: readonly UsageRow[], key: (r: UsageRow) => K): Map<K, UsageRow[]> {
  const m = new Map<K, UsageRow[]>()
  for (const r of rows) {
    const k = key(r)
    const list = m.get(k)
    if (list) list.push(r)
    else m.set(k, [r])
  }
  return m
}

/** Pure: builds the summary from a job's rows and its CVs. */
export function buildJobCostSummary(
  jobApplicationId: string,
  rows: readonly UsageRow[],
  cvs: readonly { id: string; status: string }[],
): JobCostSummary {
  const statusById = new Map(cvs.map((c) => [c.id, c.status]))
  const byCvRows = groupBy(rows, (r) => r.cvDocumentId)
  // Every CV of the job appears, even ones with no attributed usage yet.
  for (const c of cvs) if (!byCvRows.has(c.id)) byCvRows.set(c.id, [])

  const notes = [
    'Estimated from list prices; not an invoice. Your provider bills your own API key directly.',
    'Web search/fetch calls are counted but not priced.',
    ...new Set(rows.map((r) => rateFor(r.provider, r.model)?.note).filter((n): n is string => Boolean(n))),
  ]

  return {
    jobApplicationId,
    workflow: summarizeRows(rows),
    generationCalls: summarizeRows(rows.filter((r) => baseFeature(r.feature) === CV_GENERATION_FEATURE)),
    byFeature: [...groupBy(rows, (r) => baseFeature(r.feature))]
      .map(([feature, list]) => ({ feature, ...summarizeRows(list) }))
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd || a.feature.localeCompare(b.feature)),
    byCv: [...byCvRows]
      .map(([cvDocumentId, list]) => ({
        cvDocumentId,
        status: cvDocumentId ? statusById.get(cvDocumentId) ?? null : null,
        ...summarizeRows(list),
      }))
      .sort((a, b) => (a.cvDocumentId === null ? 1 : b.cvDocumentId === null ? -1 : a.cvDocumentId.localeCompare(b.cvDocumentId))),
    costPerAcceptedCv: null,
    actualChargesUsd: null,
    pricing: { kind: 'estimate', source: PRICING_SOURCE, currency: PRICING_CURRENCY, ratesAsOf: PRICING_RATES_AS_OF, notes },
  }
}

/**
 * Usage and estimated cost for one job, grouped by feature and CV. Returns
 * null when the job doesn't belong to the profile. Read-only.
 */
export async function getJobCostSummary(profileId: string, jobId: string): Promise<JobCostSummary | null> {
  const job = await prisma.jobApplication.findFirst({ where: { id: jobId, profileId }, select: { id: true } })
  if (!job) return null

  const [rows, cvs] = await Promise.all([
    prisma.llmUsageLog.findMany({
      where: { profileId, jobApplicationId: jobId },
      select: {
        provider: true, model: true, feature: true,
        promptTokens: true, completionTokens: true,
        cacheReadTokens: true, cacheWriteTokens: true, serverToolCalls: true,
        usageKnown: true, latencyMs: true, cvDocumentId: true, runId: true,
      },
    }),
    prisma.cVDocument.findMany({ where: { profileId, jobApplicationId: jobId }, select: { id: true, status: true } }),
  ])
  return buildJobCostSummary(jobId, rows, cvs)
}
