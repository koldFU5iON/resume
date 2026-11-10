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
 *   drains run per profile: a drain that finds the limit reached returns, and
 *   a running drain picks its row up. That keeps a batch capture of 20 jobs
 *   from hitting the user's LLM key and Jev's soft daily cap 20 times at once.
 * - The limit is checked in-process (drains in this instance) and in the DB
 *   (rows in progress that started in the last 5 minutes, any instance).
 */

import { after } from 'next/server'
import { prisma } from '@/lib/db'
import { isAdminUser } from '@/lib/session'
import { isJevConfigured } from '@/modules/jev/client'
import { runJobAssessment } from './run'
import { IN_PROGRESS_STALE_MS, IN_PROGRESS_STATUSES, PIPELINE_VERSION } from './schema'

/** Concurrent runs per profile (PR #330 review: askJev's daily cap is soft). */
export const ASSESSMENT_CONCURRENCY_PER_PROFILE = 2

/** Upper bound on runs per drain. */
export const MAX_RUNS_PER_DRAIN = 25

/**
 * A drain stops starting new runs after this long, so it ends inside the
 * route's max duration (300s on Vercel). Rows left queued are picked up by the
 * next drain for the profile.
 */
export const DRAIN_TIME_BUDGET_MS = 200_000

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
export async function queueJobAssessment(
  profileId: string,
  jobId: string,
  opts: { reason: QueueReason },
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

  scheduleDrain(profileId, opts.reason)
  return { queued: true, assessmentId: row.id }
}

/**
 * For trigger call sites: queues without ever throwing, so the original
 * action or route is never broken by the assessment.
 */
export async function queueJobAssessmentSafely(
  profileId: string,
  jobId: string,
  opts: { reason: QueueReason },
): Promise<void> {
  try {
    await queueJobAssessment(profileId, jobId, opts)
  } catch (err) {
    console.error('[job-assessment] queue failed', {
      jobId, reason: opts.reason, error: err instanceof Error ? err.name : typeof err,
    })
  }
}

function scheduleDrain(profileId: string, reason: QueueReason): void {
  try {
    after(() => drainProfileQueue(profileId))
  } catch {
    // Outside a request scope (scripts): run detached instead.
    console.warn('[job-assessment] after() unavailable; draining detached', { reason })
    void drainProfileQueue(profileId)
  }
}

/** Drains currently running in this instance, per profile. */
const activeDrains = new Map<string, number>()

/** Exposed for tests. */
export function activeDrainCount(profileId: string): number {
  return activeDrains.get(profileId) ?? 0
}

/**
 * Runs the profile's queued assessments, oldest first, one at a time.
 * Returns the number of runs it completed or failed. Never throws.
 */
export async function drainProfileQueue(profileId: string): Promise<number> {
  if (activeDrainCount(profileId) >= ASSESSMENT_CONCURRENCY_PER_PROFILE) return 0
  activeDrains.set(profileId, activeDrainCount(profileId) + 1)

  let ran = 0
  try {
    const running = await prisma.jobAssessment.count({
      where: {
        profileId,
        status: { in: [...IN_PROGRESS_STATUSES] },
        startedAt: { gte: new Date(Date.now() - IN_PROGRESS_STALE_MS) },
      },
    })
    if (running >= ASSESSMENT_CONCURRENCY_PER_PROFILE) return 0

    const t0 = Date.now()
    let lastUnclaimed: string | null = null
    for (let i = 0; i < MAX_RUNS_PER_DRAIN; i++) {
      if (Date.now() - t0 > DRAIN_TIME_BUDGET_MS) break
      const next = await prisma.jobAssessment.findFirst({
        where: { profileId, status: 'queued' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
      if (!next) break
      const outcome = await runJobAssessment(next.id)
      if (outcome === 'not_claimed') {
        // Another drain took it; move on. The same row twice means the claim
        // itself is failing, so stop rather than spin.
        if (lastUnclaimed === next.id) break
        lastUnclaimed = next.id
        continue
      }
      ran++
    }
  } catch (err) {
    console.error('[job-assessment] drain failed', { error: err instanceof Error ? err.name : typeof err })
  } finally {
    const n = activeDrainCount(profileId) - 1
    if (n > 0) activeDrains.set(profileId, n)
    else activeDrains.delete(profileId)
  }
  return ran
}
