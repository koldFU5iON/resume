/**
 * Backfill: assess existing "not started" jobs that have no early assessment
 * yet, in small batches the user starts from Settings.
 *
 * - Candidates: the profile's non-archived jobs with status "not started"
 *   that have no `complete` run for the current PIPELINE_VERSION and no
 *   pending run. Newest first, in the job list's order (lastUpdated).
 * - Skipped ("need attention"): jobs that would be candidates but have a run
 *   of the current version that failed with a kind that would fail again
 *   (PERSISTENT_FAILURE_KINDS: thin details, a broken LLM key, an error).
 *   Re-running them in every batch would spend Jev calls for nothing, and
 *   enrichment bumps lastUpdated, so they would float to the top each time.
 *   The user can still Re-run them by hand; editing a job re-queues it too.
 *   Transient kinds (rate_limited, overloaded, daily_cap, superseded, which
 *   includes stale-queued expiry) stay eligible.
 * - Batch size: min(BACKFILL_BATCH_SIZE, Jev calls left today /
 *   JEV_CALLS_PER_RUN_ESTIMATE, candidates). The batch is small so every row
 *   starts within the QUEUED_STALE_MS window, and it never plans past the
 *   daily cap, where every run would fail with daily_cap.
 * - One batch at a time: a new batch is refused while any run is pending. The
 *   check and the insert run in one transaction holding a per-profile
 *   advisory lock, so a double submit can't queue two batches. Queue
 *   continuation (continuation.ts) finishes a batch without further triggers.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { jevCallsRemainingToday } from '@/modules/jev/client'
import { getLLMConfigStatus } from '@/modules/llm/client'
import { insertQueuedAssessments, scheduleBatchDrains } from './queue'
import {
  IN_PROGRESS_STALE_MS,
  IN_PROGRESS_STATUSES,
  PIPELINE_VERSION,
  QUEUED_STALE_MS,
  type FailureKind,
} from './schema'

/** Most jobs queued per batch. */
export const BACKFILL_BATCH_SIZE = 20

/** Jev calls one run makes at most (verify, verify again after a fetch, judge). */
export const JEV_CALLS_PER_RUN_ESTIMATE = 3

/** JobApplication.status of the jobs a backfill covers (the schema default). */
export const BACKFILL_JOB_STATUS = 'not started'

/** Failure kinds that would fail the same way again: the backfill skips these jobs. */
export const PERSISTENT_FAILURE_KINDS = ['verification', 'no_llm_key', 'error'] as const satisfies readonly FailureKind[]

/** What capped the batch: the batch size, today's Jev calls, or nothing (all candidates fit). */
export type BackfillLimit = 'batch' | 'daily_cap' | 'none'

/** Advisory-lock key serialising backfill starts per profile. */
export function backfillLockKey(profileId: string): string {
  return `job-assessment-backfill:${profileId}`
}

/** Runs still queued or in progress, and not stale (see queries.ts isStale). */
export function pendingRunWhere(now: Date): Prisma.JobAssessmentWhereInput {
  return {
    OR: [
      { status: 'queued', createdAt: { gte: new Date(now.getTime() - QUEUED_STALE_MS) } },
      {
        status: { in: [...IN_PROGRESS_STATUSES] },
        startedAt: { gte: new Date(now.getTime() - IN_PROGRESS_STALE_MS) },
      },
    ],
  }
}

const persistentFailureWhere: Prisma.JobAssessmentWhereInput = {
  pipelineVersion: PIPELINE_VERSION,
  status: 'failed',
  failureKind: { in: [...PERSISTENT_FAILURE_KINDS] },
}

/** "Not started" jobs with no current result and nothing pending. */
function unassessedWhere(profileId: string, now: Date): Prisma.JobApplicationWhereInput {
  return {
    profileId,
    archivedAt: null,
    status: BACKFILL_JOB_STATUS,
    assessments: {
      none: { OR: [{ pipelineVersion: PIPELINE_VERSION, status: 'complete' }, pendingRunWhere(now)] },
    },
  }
}

/** The profile's jobs a backfill should assess. */
export function backfillCandidateWhere(profileId: string, now: Date): Prisma.JobApplicationWhereInput {
  return { AND: [unassessedWhere(profileId, now), { assessments: { none: persistentFailureWhere } }] }
}

/** The profile's jobs the backfill skips because their runs keep failing. */
export function backfillSkippedWhere(profileId: string, now: Date): Prisma.JobApplicationWhereInput {
  return { AND: [unassessedWhere(profileId, now), { assessments: { some: persistentFailureWhere } }] }
}

/** Jobs in the next batch, and what limited it. */
export function planBatch(eligible: number, remainingCalls: number): { size: number; limitedBy: BackfillLimit } {
  const byCap = Math.floor(Math.max(0, remainingCalls) / JEV_CALLS_PER_RUN_ESTIMATE)
  const size = Math.max(0, Math.min(BACKFILL_BATCH_SIZE, byCap, eligible))
  if (size >= eligible) return { size, limitedBy: 'none' }
  return { size, limitedBy: byCap < BACKFILL_BATCH_SIZE ? 'daily_cap' : 'batch' }
}

export interface BackfillStatus {
  /** Jobs a backfill would assess (pending and skipped ones excluded). */
  eligible: number
  /** Jobs skipped because their runs keep failing (Re-run by hand). */
  skipped: number
  /** The profile's runs queued or in progress (any trigger). */
  pending: number
  /** Jev calls left today. */
  remainingCalls: number
  /** Jobs the next batch would queue. */
  nextBatch: number
  limitedBy: BackfillLimit
  /** JEV_CALLS_PER_RUN_ESTIMATE, for the UI copy. */
  callsPerJob: number
}

export async function getBackfillStatus(profileId: string): Promise<BackfillStatus> {
  const now = new Date()
  const [eligible, skipped, pending, remainingCalls] = await Promise.all([
    prisma.jobApplication.count({ where: backfillCandidateWhere(profileId, now) }),
    prisma.jobApplication.count({ where: backfillSkippedWhere(profileId, now) }),
    prisma.jobAssessment.count({ where: { profileId, ...pendingRunWhere(now) } }),
    jevCallsRemainingToday(profileId),
  ])
  const { size, limitedBy } = planBatch(eligible, remainingCalls)
  return {
    eligible, skipped, pending, remainingCalls, nextBatch: size, limitedBy, callsPerJob: JEV_CALLS_PER_RUN_ESTIMATE,
  }
}

export type BackfillStart =
  /** `remaining`: eligible jobs not in this batch. */
  | { ok: true; queued: number; remaining: number; limitedBy: BackfillLimit }
  | { ok: false; error: string }

/**
 * Queues the next batch for the profile. The caller checks the feature flag.
 * Throws on DB errors.
 */
export async function startBackfill(
  profileId: string,
  opts: { requestStartedAt?: number } = {},
): Promise<BackfillStart> {
  // Without a key every run spends a Jev call and then fails at the facts step.
  const { configured } = await getLLMConfigStatus(profileId)
  if (!configured) return { ok: false, error: 'Add an LLM key in Settings first.' }

  const result = await prisma.$transaction(async (tx): Promise<BackfillStart> => {
    // Held until commit: a second start waits here, then sees this batch as pending.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${backfillLockKey(profileId)}))`
    const now = new Date()
    const pending = await tx.jobAssessment.count({ where: { profileId, ...pendingRunWhere(now) } })
    if (pending > 0) return { ok: false, error: 'Assessments are still running. Try again when they finish.' }

    const where = backfillCandidateWhere(profileId, now)
    const [eligible, remainingCalls] = await Promise.all([
      tx.jobApplication.count({ where }),
      jevCallsRemainingToday(profileId),
    ])
    const { size, limitedBy } = planBatch(eligible, remainingCalls)
    if (size === 0) return { ok: true, queued: 0, remaining: eligible, limitedBy }

    const jobs = await tx.jobApplication.findMany({
      where,
      orderBy: [{ lastUpdated: 'desc' }, { id: 'desc' }],
      take: size,
      select: { id: true },
    })
    const ids = await insertQueuedAssessments(tx, profileId, jobs.map((j) => j.id))
    return { ok: true, queued: ids.length, remaining: Math.max(0, eligible - ids.length), limitedBy }
  }, { timeout: 15_000 })

  // After commit, so the drains see the rows.
  if (result.ok) scheduleBatchDrains(profileId, result.queued, { reason: 'backfill', requestStartedAt: opts.requestStartedAt })
  return result
}
