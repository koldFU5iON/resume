/**
 * Queues early assessments and drains them per profile (plan "Triggers").
 *
 * Plain module (not 'use server'): callable from Server Actions and Route
 * Handlers, and it takes `profileId` explicitly so it also works from the
 * bearer-token capture route.
 *
 * Design:
 * - `queueJobAssessment` inserts a `queued` row and schedules
 *   `drainProfileQueue(profileId)` with after(). Older rows of the same job
 *   that are still `queued` are marked failed / superseded first.
 * - `drainProfileQueue` runs the profile's queued rows oldest first, one at a
 *   time, until none are left. At most ASSESSMENT_CONCURRENCY_PER_PROFILE
 *   runs are in progress per profile at once: a drain whose admission finds
 *   the limit reached returns, and a running drain picks its row up. That
 *   keeps a batch capture of 20 jobs from hitting the user's LLM key and Jev
 *   20 times at once.
 * - The limit is hard: before every run, `admitNextRun` counts the profile's
 *   runs in progress (lease: startedAt within the last 5 minutes) and claims
 *   the next row in ONE transaction under a per-profile Postgres advisory
 *   lock, so drains on different instances can't both pass the count. The
 *   in-process counter is only a cheap pre-check that avoids a transaction.
 * - Time: after() runs within the route's maxDuration (set to 300s on every
 *   route segment that queues; see ROUTE_MAX_DURATION_S). The deadline is
 *   fixed when the job is queued (or from the request start, when the caller
 *   passes it). A run starts while at least MIN_RUN_START_MS is left, and the
 *   run itself checks each stage's worst case against the same deadline: a
 *   stage that wouldn't fit puts the row back to `queued` (run.ts) and the
 *   drain stops. Rows left queued are picked up by the next drain for the
 *   profile — which needs a new trigger (queueing, re-run); without one they
 *   expire after QUEUED_STALE_MS (see expireStaleQueued).
 * - Stranding: a drain that ends because the queue looked empty checks once
 *   more after releasing its slot, and drains again
 *   if rows remain (at most MAX_RESCHEDULES times), so a row queued while the
 *   last drain was finishing isn't left behind.
 * - Queued rows older than QUEUED_STALE_MS are failed at drain start with
 *   "timed out before it started", so a row the UI already shows as timed out
 *   never completes silently later.
 */

import { after } from 'next/server'
import { prisma } from '@/lib/db'
import { isAdminUser } from '@/lib/session'
import { isJevConfigured } from '@/modules/jev/client'
import { runJobAssessment, type RunClaim } from './run'
import { IN_PROGRESS_STALE_MS, IN_PROGRESS_STATUSES, PIPELINE_VERSION, QUEUED_STALE_MS } from './schema'

/** Hard limit on concurrent runs per profile, enforced by admitNextRun. */
export const ASSESSMENT_CONCURRENCY_PER_PROFILE = 2

/** Upper bound on runs per drain. */
export const MAX_RUNS_PER_DRAIN = 25

/**
 * maxDuration (seconds) exported by every route segment that queues
 * assessments: the capture routes and the dashboard pages whose Server
 * Actions trigger queueing. Keep them in sync with this value.
 */
export const ROUTE_MAX_DURATION_S = 300

/** Kept back from maxDuration for the response itself and clock skew. */
const DRAIN_SAFETY_MARGIN_MS = 15_000

/** Time from the request start (or queue time) until the drain must have finished. */
export const DRAIN_TIME_BUDGET_MS = ROUTE_MAX_DURATION_S * 1000 - DRAIN_SAFETY_MARGIN_MS

/**
 * A drain starts a new run only while at least this much time is left. It
 * covers the first stage's worst case (STAGE_WORST_MS.verify, 50s) plus slack, so a started
 * run can always finish a stage or re-queue cleanly; typical runs take 5–10s,
 * so nearly the whole budget is usable. Later stages check their own worst
 * case inside the run.
 */
export const MIN_RUN_START_MS = 60_000

/** How many times a drain re-runs itself after finding rows left behind. */
export const MAX_RESCHEDULES = 3

export const STALE_QUEUED_REASON = 'Timed out before it started — re-run'

export type AssessmentFlag = 'off' | 'admin' | 'all'

export type QueueReason =
  | 'created'
  | 'edited'
  | 'salary'
  | 'quick-capture'
  | 'capture'
  | 'job-hunt-import'
  | 'manual'

export type QueueResult =
  | { queued: true; assessmentId: string }
  | { queued: false; reason: 'disabled' | 'not_found' }

/** JOB_ASSESSMENT_V2: off | admin | all. Unset or unrecognised → admin. */
export function assessmentFlag(): AssessmentFlag {
  const v = process.env.JOB_ASSESSMENT_V2?.trim().toLowerCase()
  return v === 'off' || v === 'all' ? v : 'admin'
}

/** Whether the early assessment runs for this profile (kill switch + rollout flag). */
export async function isAssessmentEnabledFor(profileId: string): Promise<boolean> {
  if (!isJevConfigured()) return false
  const flag = assessmentFlag()
  if (flag === 'off') return false
  if (flag === 'all') return true
  const profile = await prisma.profile.findUnique({ where: { id: profileId }, select: { userId: true } })
  return profile ? isAdminUser(profile.userId) : false
}

/**
 * Queues an assessment of `jobId` for `profileId` and schedules the drain.
 * A no-op when the feature is off for this profile. Throws on DB errors:
 * trigger call sites wrap it (see `queueJobAssessmentSafely`).
 */
export interface QueueOptions {
  reason: QueueReason
  /**
   * Date.now() at the start of the request, when the caller knows it (e.g.
   * before a slow page extraction). The drain deadline counts from here;
   * default: now.
   */
  requestStartedAt?: number
}

/**
 * Cheap, synchronous pre-check (no DB): false when the assessment can't run
 * for anyone. Call sites use it to skip reads that only serve the trigger.
 */
export function assessmentMaybeEnabled(): boolean {
  return isJevConfigured() && assessmentFlag() !== 'off'
}

export async function queueJobAssessment(
  profileId: string,
  jobId: string,
  opts: QueueOptions,
): Promise<QueueResult> {
  if (!(await isAssessmentEnabledFor(profileId))) return { queued: false, reason: 'disabled' }

  const job = await prisma.jobApplication.findFirst({ where: { id: jobId, profileId }, select: { id: true } })
  if (!job) return { queued: false, reason: 'not_found' }

  const now = new Date()
  await prisma.jobAssessment.updateMany({
    where: { profileId, jobApplicationId: jobId, status: 'queued' },
    data: {
      status: 'failed',
      failureKind: 'superseded',
      failureReasons: ['Replaced by a newer assessment'],
      completedAt: now,
    },
  })

  const row = await prisma.jobAssessment.create({
    data: { profileId, jobApplicationId: jobId, pipelineVersion: PIPELINE_VERSION, status: 'queued' },
    select: { id: true },
  })

  scheduleDrain(profileId, opts.reason, (opts.requestStartedAt ?? Date.now()) + DRAIN_TIME_BUDGET_MS)
  return { queued: true, assessmentId: row.id }
}

/**
 * For trigger call sites: queues without ever throwing, so the original
 * action or route is never broken by the assessment.
 */
export async function queueJobAssessmentSafely(
  profileId: string,
  jobId: string,
  opts: QueueOptions,
): Promise<void> {
  try {
    await queueJobAssessment(profileId, jobId, opts)
  } catch (err) {
    console.error('[job-assessment] queue failed', {
      jobId, reason: opts.reason, error: err instanceof Error ? err.name : typeof err,
    })
  }
}

function scheduleDrain(profileId: string, reason: QueueReason, deadline: number): void {
  try {
    after(() => drainProfileQueue(profileId, { deadline }))
  } catch {
    // Outside a request scope (scripts): run detached instead.
    console.warn('[job-assessment] after() unavailable; draining detached', { reason })
    void drainProfileQueue(profileId, { deadline })
  }
}

/** Drains currently running in this instance, per profile. */
const activeDrains = new Map<string, number>()

/** Exposed for tests. */
export function activeDrainCount(profileId: string): number {
  return activeDrains.get(profileId) ?? 0
}

/** Advisory-lock key serialising admission per profile (see admitNextRun). */
export function admissionLockKey(profileId: string): string {
  return `job-assessment:${profileId}`
}

export type Admission =
  | { kind: 'claimed'; claim: RunClaim }
  | { kind: 'limit' }
  | { kind: 'empty' }

/**
 * Atomic per-profile admission: in one transaction holding a per-profile
 * advisory lock, count the runs in progress inside the lease window
 * (startedAt within IN_PROGRESS_STALE_MS: a crashed run stops counting after
 * that) and, below ASSESSMENT_CONCURRENCY_PER_PROFILE, claim the oldest
 * queued row (status 'checking', startedAt = now). Admissions for one profile
 * serialise on the lock across all instances, so the limit is hard.
 */
export async function admitNextRun(profileId: string): Promise<Admission> {
  return prisma.$transaction(async (tx) => {
    // Held until the transaction commits or rolls back.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${admissionLockKey(profileId)}))`
    const now = new Date()
    const running = await tx.jobAssessment.count({
      where: {
        profileId,
        status: { in: [...IN_PROGRESS_STATUSES] },
        startedAt: { gte: new Date(now.getTime() - IN_PROGRESS_STALE_MS) },
      },
    })
    if (running >= ASSESSMENT_CONCURRENCY_PER_PROFILE) return { kind: 'limit' }
    const next = await tx.jobAssessment.findFirst({
      where: { profileId, status: 'queued' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (!next) return { kind: 'empty' }
    const claimed = await tx.jobAssessment.updateMany({
      where: { id: next.id, status: 'queued' },
      data: { status: 'checking', startedAt: now },
    })
    // A queued row only changes under this lock or via supersede/expiry; if it
    // just did, report empty and let the post-drain re-check look again.
    return claimed.count === 1 ? { kind: 'claimed', claim: { id: next.id, startedAt: now } } : { kind: 'empty' }
  })
}

/** Fails queued rows nobody started within QUEUED_STALE_MS (the UI already shows them as timed out). */
function expireStaleQueued(profileId: string): Promise<unknown> {
  const now = Date.now()
  return prisma.jobAssessment.updateMany({
    where: { profileId, status: 'queued', createdAt: { lt: new Date(now - QUEUED_STALE_MS) } },
    data: {
      status: 'failed',
      failureKind: 'superseded',
      failureReasons: [STALE_QUEUED_REASON],
      completedAt: new Date(now),
    },
  })
}

/**
 * Why a drain stopped:
 * - empty     no queued row left (when it looked)
 * - limit     the profile already had the concurrency limit of runs going
 * - deadline  not enough time left to start a run, or a run re-queued itself
 * - cap       MAX_RUNS_PER_DRAIN reached
 * - stuck     an admitted claim was no longer ours, or a DB error
 */
type DrainExit = 'empty' | 'limit' | 'deadline' | 'cap' | 'stuck'

export interface DrainOptions {
  /** Epoch ms by which the drain must be done. Default: now + DRAIN_TIME_BUDGET_MS. */
  deadline?: number
  /** Internal: how many times this drain has re-run itself. */
  depth?: number
}

/**
 * Runs the profile's queued assessments, oldest first, one at a time.
 * Returns the number of runs it completed or failed. Never throws.
 */
export async function drainProfileQueue(profileId: string, opts: DrainOptions = {}): Promise<number> {
  const deadline = opts.deadline ?? Date.now() + DRAIN_TIME_BUDGET_MS
  const depth = opts.depth ?? 0
  if (activeDrainCount(profileId) >= ASSESSMENT_CONCURRENCY_PER_PROFILE) return 0
  activeDrains.set(profileId, activeDrainCount(profileId) + 1)

  let ran = 0
  let exit: DrainExit = 'cap'
  try {
    await expireStaleQueued(profileId)

    for (let i = 0; i < MAX_RUNS_PER_DRAIN; i++) {
      if (deadline - Date.now() < MIN_RUN_START_MS) { exit = 'deadline'; break }
      // Admission (count + claim) is atomic and re-done before every run, so
      // drains on other instances can't push the profile over the limit.
      const admission = await admitNextRun(profileId)
      if (admission.kind === 'limit') { exit = 'limit'; break }
      if (admission.kind === 'empty') { exit = 'empty'; break }
      const outcome = await runJobAssessment(admission.claim, { deadline })
      if (outcome === 'requeued') { exit = 'deadline'; break }
      if (outcome === 'not_claimed') { exit = 'stuck'; break }
      ran++
    }
  } catch (err) {
    exit = 'stuck'
    console.error('[job-assessment] drain failed', { error: err instanceof Error ? err.name : typeof err })
  } finally {
    const n = activeDrainCount(profileId) - 1
    if (n > 0) activeDrains.set(profileId, n)
    else activeDrains.delete(profileId)
  }

  // A row queued while this drain was finishing (its own drain saw this one
  // still holding a slot and returned) would otherwise wait for the next
  // trigger: look once more now the slot is free.
  // Only after 'empty': on 'limit' the running drains pick the rows up.
  if (exit === 'empty' && depth < MAX_RESCHEDULES) {
    try {
      const left = await prisma.jobAssessment.count({ where: { profileId, status: 'queued' } })
      if (left > 0) ran += await drainProfileQueue(profileId, { deadline, depth: depth + 1 })
    } catch (err) {
      console.error('[job-assessment] drain re-check failed', { error: err instanceof Error ? err.name : typeof err })
    }
  }
  return ran
}
