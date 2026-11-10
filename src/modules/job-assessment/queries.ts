/**
 * Read side of the early assessment: the newest run per job, as a typed view
 * model for the UI. Stale runs (an after() callback killed mid-run, or a
 * queued row whose drain never ran) read as failed / error; nothing is
 * written here.
 */

import { prisma } from '@/lib/db'
import {
  IN_PROGRESS_STALE_MS,
  IN_PROGRESS_STATUSES,
  QUEUED_STALE_MS,
  type AssessmentLevel,
  type AssessmentStatus,
  type Blocker,
  type FailureKind,
} from './schema'

export const STALE_RUN_REASON = 'Assessment timed out — re-run'

export interface AssessmentView {
  id: string
  jobId: string
  status: AssessmentStatus
  level: AssessmentLevel | null
  score: number | null
  blocked: boolean
  /** Ordered hard → unconfirmed → stretch → warn. */
  blockers: Blocker[]
  strengths: string[]
  gaps: string[]
  unsettled: string[]
  failureKind: FailureKind | null
  failureReasons: string[]
  jevModel: string | null
  pipelineVersion: string
  processTimeMs: number | null
  completedAt: Date | null
  createdAt: Date
}

const VIEW_SELECT = {
  id: true,
  jobApplicationId: true,
  status: true,
  level: true,
  score: true,
  blocked: true,
  blockers: true,
  strengths: true,
  gaps: true,
  unsettled: true,
  failureKind: true,
  failureReasons: true,
  jevModel: true,
  pipelineVersion: true,
  processTimeMs: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
} as const

export interface AssessmentRow {
  id: string
  jobApplicationId: string
  status: string
  level: string | null
  score: number | null
  blocked: boolean
  blockers: unknown
  strengths: string[]
  gaps: string[]
  unsettled: string[]
  failureKind: string | null
  failureReasons: string[]
  jevModel: string | null
  pipelineVersion: string
  processTimeMs: number | null
  startedAt: Date | null
  completedAt: Date | null
  createdAt: Date
}

const STATUSES: readonly AssessmentStatus[] = ['queued', 'checking', 'fetching', 'assessing', 'complete', 'failed']
const LEVELS: readonly AssessmentLevel[] = ['weak', 'consider', 'pursue', 'priority']
const SEVERITIES = new Set(['hard', 'unconfirmed', 'stretch', 'warn'])

function parseBlockers(value: unknown): Blocker[] {
  if (!Array.isArray(value)) return []
  return value.filter((b): b is Blocker =>
    typeof b === 'object' && b !== null &&
    typeof (b as Blocker).kind === 'string' &&
    SEVERITIES.has((b as Blocker).severity) &&
    typeof (b as Blocker).label === 'string',
  )
}

/** Whether a row is stuck: in progress for > 5 min, or queued for > 15 min. */
export function isStale(row: Pick<AssessmentRow, 'status' | 'startedAt' | 'createdAt'>, now: Date): boolean {
  const age = (d: Date) => now.getTime() - d.getTime()
  if ((IN_PROGRESS_STATUSES as readonly string[]).includes(row.status)) {
    return age(row.startedAt ?? row.createdAt) > IN_PROGRESS_STALE_MS
  }
  if (row.status === 'queued') return age(row.createdAt) > QUEUED_STALE_MS
  return false
}

export function toAssessmentView(row: AssessmentRow, now: Date = new Date()): AssessmentView {
  const view: AssessmentView = {
    id: row.id,
    jobId: row.jobApplicationId,
    status: STATUSES.includes(row.status as AssessmentStatus) ? (row.status as AssessmentStatus) : 'failed',
    level: LEVELS.includes(row.level as AssessmentLevel) ? (row.level as AssessmentLevel) : null,
    score: row.score,
    blocked: row.blocked,
    blockers: parseBlockers(row.blockers),
    strengths: row.strengths,
    gaps: row.gaps,
    unsettled: row.unsettled,
    failureKind: (row.failureKind as FailureKind | null) ?? null,
    failureReasons: row.failureReasons,
    jevModel: row.jevModel,
    pipelineVersion: row.pipelineVersion,
    processTimeMs: row.processTimeMs,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  }
  if (isStale(row, now)) {
    return { ...view, status: 'failed', failureKind: 'error', failureReasons: [STALE_RUN_REASON] }
  }
  return view
}

/** The newest assessment per job, keyed by job id. Jobs with none are absent. */
export async function getLatestAssessments(
  profileId: string,
  jobIds: readonly string[],
): Promise<Record<string, AssessmentView>> {
  if (jobIds.length === 0) return {}
  const rows = await prisma.jobAssessment.findMany({
    where: { profileId, jobApplicationId: { in: [...jobIds] } },
    orderBy: { createdAt: 'desc' },
    distinct: ['jobApplicationId'],
    select: VIEW_SELECT,
  })
  const now = new Date()
  const out: Record<string, AssessmentView> = {}
  for (const row of rows) out[row.jobApplicationId] = toAssessmentView(row, now)
  return out
}

/** The newest assessment of one job, or null. */
export async function getLatestAssessment(profileId: string, jobId: string): Promise<AssessmentView | null> {
  const row = await prisma.jobAssessment.findFirst({
    where: { profileId, jobApplicationId: jobId },
    orderBy: { createdAt: 'desc' },
    select: VIEW_SELECT,
  })
  return row ? toAssessmentView(row) : null
}
