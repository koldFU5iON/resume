/**
 * The CV generation run row: admission and guarded status transitions.
 *
 * Plain module (not 'use server'): it takes `profileId` explicitly so a route,
 * a Server Action and the pipeline can share it. Copies the semantics of
 * deep-dive/run.ts:
 *
 * - `createCvGenerationRun` admits a run under a per-profile advisory lock:
 *   one active run per job (a second request gets the running one back) and at
 *   most CV_GENERATION_CONCURRENCY_PER_PROFILE active runs per profile. It
 *   only inserts the `queued` row; running the pipeline is a later phase.
 * - `setStatus` moves an active run forward, never backwards and never out of
 *   a finished state. Rows are never written after they reach complete or
 *   failed. A run killed mid-way stays in its active status and reads as
 *   failed / timeout after CV_GENERATION_STALE_MS (queries.ts).
 *
 * No LLM calls here.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  ACTIVE_STATUSES,
  CV_GENERATION_CONCURRENCY_PER_PROFILE,
  CV_GENERATION_STALE_MS,
  type CvGenerationFailureKind,
  type CvGenerationStatus,
} from './schema'

export type CreateCvGenerationRunResult =
  | { kind: 'created'; runId: string }
  /** A run of this job is already active; its id. */
  | { kind: 'existing'; runId: string }
  /** The profile already has the maximum number of active runs. */
  | { kind: 'limit' }
  | { kind: 'not_found' }

/** Advisory-lock key serialising admission per profile. */
export function cvGenerationLockKey(profileId: string): string {
  return `cv-generation:${profileId}`
}

/** Admits and inserts a `queued` run of `jobId`. */
export async function createCvGenerationRun(
  profileId: string,
  jobId: string,
  opts: { deepDiveId?: string | null } = {},
): Promise<CreateCvGenerationRunResult> {
  const job = await prisma.jobApplication.findFirst({ where: { id: jobId, profileId }, select: { id: true } })
  if (!job) return { kind: 'not_found' }

  return prisma.$transaction(async (tx): Promise<CreateCvGenerationRunResult> => {
    // Held until the transaction ends; admissions for one profile serialise across instances.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cvGenerationLockKey(profileId)}))`
    const liveSince = new Date(Date.now() - CV_GENERATION_STALE_MS)
    const active = { status: { in: [...ACTIVE_STATUSES] }, createdAt: { gte: liveSince } }

    const running = await tx.cvGeneration.findFirst({
      where: { profileId, jobApplicationId: jobId, ...active },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (running) return { kind: 'existing', runId: running.id }

    const count = await tx.cvGeneration.count({ where: { profileId, ...active } })
    if (count >= CV_GENERATION_CONCURRENCY_PER_PROFILE) return { kind: 'limit' }

    const row = await tx.cvGeneration.create({
      data: { profileId, jobApplicationId: jobId, status: 'queued', deepDiveId: opts.deepDiveId ?? null },
      select: { id: true },
    })
    return { kind: 'created', runId: row.id }
  })
}

/** The id of the job's live (active and not stale) run, or null. A plain read: admission (createCvGenerationRun) re-checks under its lock. */
export async function findActiveCvGeneration(profileId: string, jobId: string): Promise<string | null> {
  const row = await prisma.cvGeneration.findFirst({
    where: { profileId, jobApplicationId: jobId, status: { in: [...ACTIVE_STATUSES] }, createdAt: { gte: new Date(Date.now() - CV_GENERATION_STALE_MS) } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  return row?.id ?? null
}

/** Whether the run can still be written: active and not stale. False for a finished, killed or stale run. */
export async function isRunActive(profileId: string, id: string): Promise<boolean> {
  const n = await prisma.cvGeneration.count({
    where: { id, profileId, status: { in: [...ACTIVE_STATUSES] }, createdAt: { gte: new Date(Date.now() - CV_GENERATION_STALE_MS) } },
  })
  return n > 0
}

/**
 * The statuses a run may move to `target` from: active statuses strictly
 * earlier in the pipeline. `complete` and `failed` are reachable from any
 * active status; nothing leaves them, and nothing moves to `queued`.
 */
export function allowedFrom(target: CvGenerationStatus): readonly CvGenerationStatus[] {
  if (target === 'queued') return []
  if (target === 'complete' || target === 'failed') return ACTIVE_STATUSES
  return ACTIVE_STATUSES.slice(0, (ACTIVE_STATUSES as readonly CvGenerationStatus[]).indexOf(target))
}

/** Fields a caller may write: never the owner, the job or the status (use `setStatus` for that). */
export type CvGenerationRunData = Omit<
  Prisma.CvGenerationUncheckedUpdateManyInput,
  'id' | 'profileId' | 'jobApplicationId' | 'status'
>

/**
 * Updates a run of `profileId` that is still active; a finished row is never
 * written again. A run past CV_GENERATION_STALE_MS already reads as failed
 * (queries.ts), so it is not written either: a stalled run that resumes late
 * cannot flip to complete after the user has started another.
 */
export async function updateActive(
  profileId: string,
  id: string,
  data: CvGenerationRunData & { status?: CvGenerationStatus },
): Promise<boolean> {
  const res = await prisma.cvGeneration.updateMany({
    where: {
      id,
      profileId,
      status: { in: [...ACTIVE_STATUSES] },
      createdAt: { gte: new Date(Date.now() - CV_GENERATION_STALE_MS) },
    },
    data,
  })
  return res.count === 1
}

/**
 * Moves a run to `status`, together with `data`. False when the run is gone,
 * finished, or already at or past `status` (a stage never runs twice), in
 * which case nothing is written and the caller stops.
 */
export async function setStatus(
  profileId: string,
  id: string,
  status: CvGenerationStatus,
  data: CvGenerationRunData = {},
): Promise<boolean> {
  const from = allowedFrom(status)
  if (from.length === 0) return false
  const res = await prisma.cvGeneration.updateMany({
    where: {
      id,
      profileId,
      status: { in: [...from] },
      createdAt: { gte: new Date(Date.now() - CV_GENERATION_STALE_MS) },
    },
    data: { ...data, status },
  })
  return res.count === 1
}

export const FAILURE_MESSAGES: Record<CvGenerationFailureKind, string> = {
  no_llm_key: 'No LLM API key configured. Add one in Settings → LLM.',
  no_description: 'The job has no description to write a CV for.',
  timeout: 'The CV generation took too long and was stopped. Try again.',
  rate_limited: 'Your LLM provider is rate limiting requests. Try again shortly.',
  overloaded: 'Your LLM provider is unavailable right now. Try again shortly.',
  refusal: 'The model declined to write the CV.',
  invalid_output: 'The model returned output that could not be used. Try again.',
  draft_exists: 'This job’s CV document already has a draft waiting. Accept or discard it first. The generated CV is kept in the log.',
  document_limit: 'This job already holds the most writing desk documents. Delete one you no longer need, then generate again.',
  error: 'The CV generation failed. Try again.',
}

/** Ends an active run as failed. Best effort: it never throws. */
export async function failRun(
  profileId: string,
  id: string,
  kind: CvGenerationFailureKind,
  message: string | null,
  extra: { stageTimings?: object; log?: object; /** More columns to keep on the failed row, e.g. the generated CV when Land failed. */ data?: CvGenerationRunData } = {},
): Promise<boolean> {
  try {
    return await updateActive(profileId, id, {
      ...(extra.data ?? {}),
      status: 'failed',
      failureKind: kind,
      failureMessage: message ?? FAILURE_MESSAGES[kind],
      completedAt: new Date(),
      ...(extra.stageTimings ? { stageTimings: extra.stageTimings as Prisma.InputJsonValue } : {}),
      ...(extra.log ? { log: extra.log as Prisma.InputJsonValue } : {}),
    })
  } catch (err) {
    console.error('[cv-generation] could not record failure', { id, err })
    return false
  }
}
