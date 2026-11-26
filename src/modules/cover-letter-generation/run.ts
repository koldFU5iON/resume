/**
 * The cover letter run row: admission and guarded status transitions,
 * modelled on cv-generation/run.ts with one difference: the run PAUSES at
 * `awaiting_choice` until the owner picks an angle.
 *
 * - A run is OPEN while it is processing and has progressed within
 *   PROCESSING_STALE_MS, or waits at awaiting_choice for at most
 *   ANGLES_VALID_MS (both measured from updatedAt, which every write bumps).
 *   Anything older reads as failed (timeout / expired, queries.ts) and is
 *   never written again.
 * - One open run per job; at most CONCURRENCY_PER_PROFILE PROCESSING runs per
 *   profile (a run waiting for a choice costs nothing, so it doesn't count).
 *   Admission holds a per-profile advisory lock.
 * - setStatus only moves forward through OPEN_STATUSES; complete and failed
 *   are final.
 *
 * Plain module: takes profileId explicitly. No model calls.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  ANGLES_VALID_MS,
  CONCURRENCY_PER_PROFILE,
  OPEN_STATUSES,
  PROCESSING_STALE_MS,
  PROCESSING_STATUSES,
  type CoverLetterFailureKind,
  type CoverLetterStatus,
} from './schema'

type Tx = Prisma.TransactionClient

export function lockKey(profileId: string): string {
  return `cover-letter-generation:${profileId}`
}

/** Rows that are still open now: processing and not stale, or awaiting a choice and not expired. */
export function openWhere(now = Date.now()): Prisma.CoverLetterGenerationWhereInput {
  return {
    OR: [
      { status: { in: [...PROCESSING_STATUSES] }, updatedAt: { gte: new Date(now - PROCESSING_STALE_MS) } },
      { status: 'awaiting_choice', updatedAt: { gte: new Date(now - ANGLES_VALID_MS) } },
    ],
  }
}

function processingWhere(now = Date.now()): Prisma.CoverLetterGenerationWhereInput {
  return { status: { in: [...PROCESSING_STATUSES] }, updatedAt: { gte: new Date(now - PROCESSING_STALE_MS) } }
}

export type CreateRunResult =
  | { kind: 'created'; runId: string }
  | { kind: 'existing'; runId: string; status: CoverLetterStatus }
  | { kind: 'limit' }
  | { kind: 'not_found' }

/**
 * Admits a new `queued` run of the job. An open run of the job is returned
 * instead, except that `fresh` ends one that is only waiting for a choice
 * (failed / superseded) and starts over.
 */
export async function createRun(profileId: string, jobId: string, opts: { fresh?: boolean } = {}): Promise<CreateRunResult> {
  const job = await prisma.jobApplication.findFirst({ where: { id: jobId, profileId }, select: { id: true } })
  if (!job) return { kind: 'not_found' }

  return prisma.$transaction(async (tx: Tx): Promise<CreateRunResult> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(profileId)}))`
    const open = await tx.coverLetterGeneration.findFirst({
      where: { profileId, jobApplicationId: jobId, ...openWhere() },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    })
    if (open) {
      if (!(opts.fresh && open.status === 'awaiting_choice')) return { kind: 'existing', runId: open.id, status: open.status as CoverLetterStatus }
      await tx.coverLetterGeneration.updateMany({
        where: { id: open.id, profileId, status: 'awaiting_choice' },
        data: { status: 'failed', failureKind: 'superseded', failureMessage: FAILURE_MESSAGES.superseded, completedAt: new Date() },
      })
    }
    const processing = await tx.coverLetterGeneration.count({ where: { profileId, ...processingWhere() } })
    if (processing >= CONCURRENCY_PER_PROFILE) return { kind: 'limit' }
    const row = await tx.coverLetterGeneration.create({
      data: { profileId, jobApplicationId: jobId, status: 'queued' },
      select: { id: true },
    })
    return { kind: 'created', runId: row.id }
  })
}

/** The job's open run, or null. A plain read: admission re-checks under its lock. */
export async function findOpenRun(profileId: string, jobId: string): Promise<{ id: string; status: CoverLetterStatus } | null> {
  const row = await prisma.coverLetterGeneration.findFirst({
    where: { profileId, jobApplicationId: jobId, ...openWhere() },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  })
  return row ? { id: row.id, status: row.status as CoverLetterStatus } : null
}

/** The statuses a run may move to `target` from (strictly earlier open ones; any open one for final states). */
export function allowedFrom(target: CoverLetterStatus): readonly CoverLetterStatus[] {
  if (target === 'queued') return []
  if (target === 'complete' || target === 'failed') return OPEN_STATUSES
  const at = (OPEN_STATUSES as readonly CoverLetterStatus[]).indexOf(target)
  return at <= 0 ? [] : OPEN_STATUSES.slice(0, at)
}

export type RunData = Omit<Prisma.CoverLetterGenerationUncheckedUpdateManyInput, 'id' | 'profileId' | 'jobApplicationId' | 'status'>

/** Moves an open run forward to `status` with `data`. False when it is gone, final, stale, or already at or past `status`. */
export async function setStatus(profileId: string, id: string, status: CoverLetterStatus, data: RunData = {}): Promise<boolean> {
  const from = allowedFrom(status)
  if (from.length === 0) return false
  const res = await prisma.coverLetterGeneration.updateMany({
    where: { id, profileId, status: { in: [...from] }, ...openWhere() },
    data: { ...data, status },
  })
  return res.count === 1
}

/** Writes data to an open run without changing its status. */
export async function updateOpen(profileId: string, id: string, data: RunData): Promise<boolean> {
  const res = await prisma.coverLetterGeneration.updateMany({ where: { id, profileId, ...openWhere() }, data })
  return res.count === 1
}

export const FAILURE_MESSAGES: Record<CoverLetterFailureKind, string> = {
  no_llm_key: 'No LLM API key configured. Add one in Settings → LLM.',
  no_description: 'The job has no description to write a cover letter for.',
  timeout: 'The cover letter took too long and was stopped. Try again.',
  rate_limited: 'Your LLM provider is rate limiting requests. Try again shortly.',
  overloaded: 'Your LLM provider is unavailable right now. Try again shortly.',
  refusal: 'The model declined to write the cover letter.',
  invalid_output: 'The model returned output that could not be used. Try again.',
  draft_exists: 'This job’s cover letter already has a draft waiting. Accept or discard it first. The written letter is kept in the log.',
  document_limit: 'This job already holds the most writing desk documents. Delete one you no longer need, then try again.',
  expired: 'These angles were waiting too long for a choice. Start again for fresh suggestions.',
  superseded: 'New angles were requested, so these were set aside.',
  error: 'The cover letter generation failed. Try again.',
}

/** Ends an open run as failed. Best effort: never throws. */
export async function failRun(
  profileId: string,
  id: string,
  kind: CoverLetterFailureKind,
  extra: { message?: string; data?: RunData } = {},
): Promise<boolean> {
  try {
    const res = await prisma.coverLetterGeneration.updateMany({
      where: { id, profileId, ...openWhere() },
      data: { ...(extra.data ?? {}), status: 'failed', failureKind: kind, failureMessage: extra.message ?? FAILURE_MESSAGES[kind], completedAt: new Date() },
    })
    return res.count === 1
  } catch (err) {
    console.error('[cover-letter-generation] could not record failure', { id, err })
    return false
  }
}
