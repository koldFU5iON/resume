/**
 * Read side of the early assessment: the newest run per job, as a typed view
 * model for the UI. Stale runs (an after() callback killed mid-run, or a
 * queued row whose drain never ran) read as failed / error; nothing is
 * written here.
 */

import { cache } from 'react'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { REPLACED_DESCRIPTION } from './enrich'
import { assessmentMaybeEnabled, isAssessmentEnabledFor } from './queue'
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
  /** Informational lines from combine (signals.combine.notes), e.g. "Contract role". Complete runs only. */
  notes: string[]
  /** Fields the run filled in from the job page (JobAssessment.enrichedFields). */
  enrichedFields: string[]
  /** The truncated job description was replaced with the full text from the job page. */
  descriptionReplaced: boolean
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
  enrichedFields: true,
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
  enrichedFields: string[]
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

/** `signals->'combine'->'notes'` as stored by run.ts; anything else reads as no notes. */
function parseNotes(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((n): n is string => typeof n === 'string') : []
}

export function toAssessmentView(row: AssessmentRow, now: Date = new Date(), notes: unknown = null): AssessmentView {
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
    notes: parseNotes(notes),
    enrichedFields: row.enrichedFields,
    descriptionReplaced: row.enrichedFields.includes(REPLACED_DESCRIPTION),
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

/**
 * Notes live inside the `signals` JSON (signals.combine.notes), next to the
 * raw Jev answers. Reading only that path keeps the large `signals` blob out
 * of list loads (they re-run every 3 s while a run is in progress).
 */
async function loadNotes(profileId: string, ids: readonly string[]): Promise<Map<string, unknown>> {
  if (ids.length === 0) return new Map()
  const rows = await prisma.$queryRaw<{ id: string; notes: unknown }[]>`
    SELECT "id", "signals"->'combine'->'notes' AS "notes"
    FROM "JobAssessment"
    WHERE "profileId" = ${profileId} AND "status" = 'complete' AND "id" IN (${Prisma.join([...ids])})`
  return new Map(rows.map((r) => [r.id, r.notes]))
}

const completeIds = (rows: readonly { id: string; status: string }[]) =>
  rows.filter((r) => r.status === 'complete').map((r) => r.id)

/**
 * The newest assessment per job, keyed by job id. Jobs with none are absent.
 *
 * Two queries whatever the history size: DISTINCT ON picks the newest run
 * id per job in Postgres (Prisma's `distinct` would fetch every past run and
 * dedupe in JS) and reads its notes at the same time, then the view columns
 * are fetched for those ids only.
 */
export async function getLatestAssessments(
  profileId: string,
  jobIds: readonly string[],
): Promise<Record<string, AssessmentView>> {
  if (jobIds.length === 0) return {}
  const latest = await prisma.$queryRaw<{ id: string; notes: unknown }[]>`
    SELECT DISTINCT ON ("jobApplicationId") "id",
      CASE WHEN "status" = 'complete' THEN "signals"->'combine'->'notes' END AS "notes"
    FROM "JobAssessment"
    WHERE "profileId" = ${profileId} AND "jobApplicationId" IN (${Prisma.join([...jobIds])})
    ORDER BY "jobApplicationId", "createdAt" DESC, "id" DESC`
  if (latest.length === 0) return {}
  const rows = await prisma.jobAssessment.findMany({
    where: { profileId, id: { in: latest.map((r) => r.id) } },
    select: VIEW_SELECT,
  })
  const notes = new Map(latest.map((r) => [r.id, r.notes]))
  const now = new Date()
  const out: Record<string, AssessmentView> = {}
  for (const row of rows) out[row.jobApplicationId] = toAssessmentView(row, now, notes.get(row.id))
  return out
}

/** The newest assessment of one job, or null. */
export async function getLatestAssessment(profileId: string, jobId: string): Promise<AssessmentView | null> {
  const row = await prisma.jobAssessment.findFirst({
    where: { profileId, jobApplicationId: jobId },
    orderBy: { createdAt: 'desc' },
    select: VIEW_SELECT,
  })
  if (!row) return null
  const notes = await loadNotes(profileId, completeIds([row]))
  return toAssessmentView(row, new Date(), notes.get(row.id))
}

/**
 * Whether the early assessment is on for this profile (TYPESAFE_API_KEY set
 * and the JOB_ASSESSMENT_V2 rollout flag). Deduped per request, so a page and
 * its loaders can both ask. Pages pass only the resulting boolean to the
 * client; no env detail leaves the server.
 */
export const isEarlyAssessmentEnabled = cache(isAssessmentEnabledFor)

/**
 * The newest assessment per job for the job list, or {} when the feature is
 * off for this profile (the UI then shows nothing new: spec kill switch).
 */
export async function getEarlyAssessmentsForJobs(
  profileId: string,
  jobIds: readonly string[],
): Promise<Record<string, AssessmentView>> {
  if (!(await isEarlyAssessmentEnabled(profileId))) return {}
  return getLatestAssessments(profileId, jobIds)
}

/** The newest assessment of one job for its detail page, or null when there is none or the feature is off. */
export async function getEarlyAssessmentForJob(profileId: string, jobId: string): Promise<AssessmentView | null> {
  if (!assessmentMaybeEnabled()) return null
  if (!(await isEarlyAssessmentEnabled(profileId))) return null
  return getLatestAssessment(profileId, jobId)
}
