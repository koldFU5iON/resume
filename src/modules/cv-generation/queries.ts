/**
 * Read side of CV generation: a run as a view model for the generation log.
 * A run stuck in an active status past CV_GENERATION_STALE_MS reads as failed
 * / timeout; nothing is written here. Every query filters by profileId.
 */

import { prisma } from '@/lib/db'
import { summarizeRows, type UsageBucket, type UsageRow } from '@/modules/llm/job-cost'
import {
  CV_GENERATION_STALE_MS,
  asFailureKind,
  asStatus,
  isActiveStatus,
  isPartialLog,
  parseAssembled,
  parseBrief,
  parseCvGenerationLog,
  parseReview,
  parseSelection,
  parseStageTimings,
  type CvAssembled,
  type CvBrief,
  type CvReview,
  type CvGenerationFailureKind,
  type CvGenerationStage,
  type CvGenerationStatus,
  type CvSelection,
  type StageLogEntry,
} from './schema'

export const STALE_RUN_MESSAGE = 'The CV generation stopped before it finished. Run it again.'

export type CvGenerationUsage = {
  total: UsageBucket
  /** Per feature tag (cv-gen-brief, …), for stages without their own cost in the log. */
  byFeature: Record<string, UsageBucket>
}

export type CvGenerationView = {
  id: string
  jobId: string
  status: CvGenerationStatus
  failureKind: CvGenerationFailureKind | null
  failureMessage: string | null
  writingDeskDocumentId: string | null
  deepDiveId: string | null
  /** The stage log, in pipeline order; empty when none has been written yet. */
  log: StageLogEntry[]
  stageTimings: Partial<Record<CvGenerationStage, number>>
  /** Runs stored before Phase 4a that stopped after Select or Assemble (a preview run: no review, no draft). New runs are never partial. */
  partial: boolean
  /** The Brief stage's output; null until that stage ends, or when the stored value is unreadable. */
  brief: CvBrief | null
  /** The Select stage's output (kept ids and labels, what was dropped); null likewise. */
  selection: CvSelection | null
  /** The assembled CV (markdown, sections, warnings, check notes); null before Assemble ends, on runs stored before Phase 3, or when unreadable. */
  assembled: CvAssembled | null
  /** The Review stage's output (edits applied and discarded, concerns for the coach, skipped flag); null before Review ends, on runs stored before Phase 4a, or when unreadable. */
  review: CvReview | null
  /** The earlier run whose brief and selection this run reused; null for a fresh Brief and Select. */
  selectionReusedFromRunId: string | null
  /** Usage of this run's LLM calls (rows with runId = id); an estimate, billed to the user's own key. */
  usage: CvGenerationUsage
  createdAt: Date
  startedAt: Date | null
  completedAt: Date | null
}

type Row = {
  id: string
  jobApplicationId: string
  writingDeskDocumentId: string | null
  deepDiveId: string | null
  status: string
  failureKind: string | null
  failureMessage: string | null
  stageTimings: unknown
  log: unknown
  brief: unknown
  selection: unknown
  assembled?: unknown
  review?: unknown
  selectionReusedFromRunId?: string | null
  createdAt: Date
  startedAt: Date | null
  completedAt: Date | null
}

/** Whether an active run has been going longer than any real run can. */
export function isStaleRun(row: Pick<Row, 'status' | 'createdAt'>, now: Date): boolean {
  return isActiveStatus(row.status) && now.getTime() - row.createdAt.getTime() > CV_GENERATION_STALE_MS
}

/** A row's status as readers see it: a stale active run reads as failed; an unknown status too. */
export function effectiveStatus(row: Pick<Row, 'status' | 'createdAt'>, now: Date): CvGenerationStatus {
  return isStaleRun(row, now) ? 'failed' : asStatus(row.status)
}

/** Pure: usage rows → total and per-feature buckets. */
export function summarizeRunUsage(rows: readonly UsageRow[]): CvGenerationUsage {
  const byFeatureRows = new Map<string, UsageRow[]>()
  for (const r of rows) {
    const key = r.feature ?? 'unknown'
    const list = byFeatureRows.get(key)
    if (list) list.push(r)
    else byFeatureRows.set(key, [r])
  }
  return {
    total: summarizeRows(rows),
    byFeature: Object.fromEntries([...byFeatureRows].map(([k, v]) => [k, summarizeRows(v)])),
  }
}

/** Pure: view of a row. */
export function toCvGenerationView(row: Row, usage: CvGenerationUsage, now: Date = new Date()): CvGenerationView {
  const stale = isStaleRun(row, now)
  return {
    id: row.id,
    jobId: row.jobApplicationId,
    status: effectiveStatus(row, now),
    failureKind: stale ? 'timeout' : asFailureKind(row.failureKind),
    failureMessage: stale ? STALE_RUN_MESSAGE : row.failureMessage,
    writingDeskDocumentId: row.writingDeskDocumentId,
    deepDiveId: row.deepDiveId,
    log: parseCvGenerationLog(row.log),
    stageTimings: parseStageTimings(row.stageTimings),
    partial: isPartialLog(row.log),
    brief: parseBrief(row.brief),
    selection: parseSelection(row.selection),
    assembled: parseAssembled(row.assembled),
    review: parseReview(row.review),
    selectionReusedFromRunId: row.selectionReusedFromRunId ?? null,
    usage,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  }
}

const ROW_SELECT = {
  id: true, jobApplicationId: true, writingDeskDocumentId: true, deepDiveId: true,
  status: true, failureKind: true, failureMessage: true,
  stageTimings: true, log: true, brief: true, selection: true, assembled: true, review: true, selectionReusedFromRunId: true, createdAt: true, startedAt: true, completedAt: true,
} as const

/** Usage of one run: its LLM rows, grouped by runId. */
export async function getRunUsage(profileId: string, runId: string): Promise<CvGenerationUsage> {
  const rows = await prisma.llmUsageLog.findMany({
    where: { profileId, runId },
    select: {
      provider: true, model: true, feature: true,
      promptTokens: true, completionTokens: true,
      cacheReadTokens: true, cacheWriteTokens: true, serverToolCalls: true,
      usageKnown: true, status: true, errorKind: true, latencyMs: true, cvDocumentId: true, runId: true,
    },
  })
  return summarizeRunUsage(rows)
}

/** The newest CV generation of one of the profile's jobs, or null when it has none. */
export async function getLatestCvGeneration(profileId: string, jobId: string): Promise<CvGenerationView | null> {
  const row = await prisma.cvGeneration.findFirst({
    where: { profileId, jobApplicationId: jobId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: ROW_SELECT,
  })
  return row ? toCvGenerationView(row, await getRunUsage(profileId, row.id)) : null
}

/** One run of the profile, by id, or null when it isn't theirs. */
export async function getCvGeneration(profileId: string, runId: string): Promise<CvGenerationView | null> {
  const row = await prisma.cvGeneration.findFirst({
    where: { id: runId, profileId },
    select: ROW_SELECT,
  })
  return row ? toCvGenerationView(row, await getRunUsage(profileId, row.id)) : null
}

/** Whether the profile has any CV generation run for the job (the writing desk offers "View last generation" when it does). */
export async function hasCvGeneration(profileId: string, jobId: string): Promise<boolean> {
  const row = await prisma.cvGeneration.findFirst({ where: { profileId, jobApplicationId: jobId }, select: { id: true } })
  return row !== null
}
