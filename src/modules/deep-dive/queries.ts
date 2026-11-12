/**
 * Read side of the deep dive: the newest run of a job as a view model.
 * A run stuck in an active status past DEEP_DIVE_STALE_MS reads as failed /
 * timeout; nothing is written here.
 */

import { prisma } from '@/lib/db'
import { summarizeRows, type UsageBucket } from '@/modules/llm/job-cost'
import { currentInputsHash } from './gather'
import {
  ACTIVE_STATUSES,
  DEEP_DIVE_STALE_MS,
  VERDICTS,
  type DeepDiveFailureKind,
  type DeepDiveReport,
  type DeepDiveResearch,
  type DeepDiveStatus,
} from './schema'

export const STALE_RUN_MESSAGE = 'The deep dive stopped before it finished. Run it again.'

export type DeepDiveView = {
  id: string
  jobId: string
  status: DeepDiveStatus
  failureKind: DeepDiveFailureKind | null
  failureMessage: string | null
  verdict: string | null
  worthTailoredCv: boolean | null
  /** Present when complete. */
  report: DeepDiveReport | null
  research: DeepDiveResearch | null
  researchModel: string | null
  synthesisModel: string | null
  sourceAssessmentId: string | null
  /** Complete runs only: the profile, job or early assessment changed since the run. Null when not checked. */
  outOfDate: boolean | null
  /** Usage of this run's LLM calls (rows with runId = id); an estimate, billed to the user's own key. */
  usage: UsageBucket
  stageTimings: unknown
  createdAt: Date
  startedAt: Date | null
  completedAt: Date | null
}

type Row = {
  id: string
  jobApplicationId: string
  status: string
  failureKind: string | null
  failureMessage: string | null
  verdict: string | null
  worthTailoredCv: boolean | null
  report: unknown
  research: unknown
  researchModel: string | null
  synthesisModel: string | null
  sourceAssessmentId: string | null
  inputsHash: string | null
  stageTimings: unknown
  createdAt: Date
  startedAt: Date | null
  completedAt: Date | null
}

/** Whether an active run has been going longer than any real run can. */
export function isStaleRun(row: Pick<Row, 'status' | 'createdAt'>, now: Date): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(row.status) && now.getTime() - row.createdAt.getTime() > DEEP_DIVE_STALE_MS
}

/**
 * A stored report, or null when absent or unreadable. Stored reports are
 * already-transformed schema output (evidence as a union), so they can't be
 * re-parsed with the model-facing schema; this checks the shape's anchor.
 */
export function parseReport(value: unknown): DeepDiveReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const verdict = (value as { verdict?: unknown }).verdict
  return typeof verdict === 'string' && (VERDICTS as readonly string[]).includes(verdict) ? (value as DeepDiveReport) : null
}

/** Pure: view of a row. `currentHash` is the inputs hash a run would get now (complete runs only). */
export function toDeepDiveView(row: Row, usage: UsageBucket, currentHash: string | null | undefined, now: Date = new Date()): DeepDiveView {
  const stale = isStaleRun(row, now)
  const status = (stale ? 'failed' : row.status) as DeepDiveStatus
  return {
    id: row.id,
    jobId: row.jobApplicationId,
    status,
    failureKind: stale ? 'timeout' : (row.failureKind as DeepDiveFailureKind | null),
    failureMessage: stale ? STALE_RUN_MESSAGE : row.failureMessage,
    verdict: row.verdict,
    worthTailoredCv: row.worthTailoredCv,
    report: status === 'complete' ? parseReport(row.report) : null,
    research: (row.research as DeepDiveResearch | null) ?? null,
    researchModel: row.researchModel,
    synthesisModel: row.synthesisModel,
    sourceAssessmentId: row.sourceAssessmentId,
    outOfDate: status === 'complete' && row.inputsHash && currentHash !== undefined
      ? currentHash !== row.inputsHash
      : null,
    usage,
    stageTimings: row.stageTimings,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  }
}

const ROW_SELECT = {
  id: true, jobApplicationId: true, status: true, failureKind: true, failureMessage: true,
  verdict: true, worthTailoredCv: true, report: true, research: true,
  researchModel: true, synthesisModel: true, sourceAssessmentId: true, inputsHash: true,
  stageTimings: true, createdAt: true, startedAt: true, completedAt: true,
} as const

/** Usage of one run: its LLM rows, grouped by runId. */
export async function getRunUsage(profileId: string, runId: string): Promise<UsageBucket> {
  const rows = await prisma.llmUsageLog.findMany({
    where: { profileId, runId },
    select: {
      provider: true, model: true, feature: true,
      promptTokens: true, completionTokens: true,
      cacheReadTokens: true, cacheWriteTokens: true, serverToolCalls: true,
      usageKnown: true, status: true, errorKind: true, latencyMs: true, cvDocumentId: true, runId: true,
    },
  })
  return summarizeRows(rows)
}

/** The newest deep dive of one of the profile's jobs, or null when it has none. */
export async function getLatestDeepDive(profileId: string, jobId: string): Promise<DeepDiveView | null> {
  const row = await prisma.jobDeepDive.findFirst({
    where: { profileId, jobApplicationId: jobId },
    orderBy: { createdAt: 'desc' },
    select: ROW_SELECT,
  })
  if (!row) return null
  const [usage, hash] = await Promise.all([
    getRunUsage(profileId, row.id),
    row.status === 'complete' ? currentInputsHash(profileId, jobId) : Promise.resolve(undefined),
  ])
  return toDeepDiveView(row, usage, hash)
}
