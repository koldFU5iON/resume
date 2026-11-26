/**
 * Starting and running a cover letter generation (issue #471) in two phases,
 * each in after() so the route answers at once:
 *
 * 1. `startCoverLetter` → Gather → Angles → the run waits at
 *    `awaiting_choice` with suggested angles and personal questions.
 * 2. `chooseCoverLetterAngle` (the owner's angle or own angle, answers, tone,
 *    length) → Write → Review → Land: the letter lands as a writing desk
 *    DRAFT in the job's cover letter document.
 *
 * A waiting draft is refused before either phase spends anything. The run
 * functions never throw: every failure ends on the row (failRun). Plain
 * module: takes profileId explicitly.
 */

import { after } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getLLMConfigStatus } from '@/modules/llm/client'
import { LLMError } from '@/modules/llm/errors'
import { usageOfError, type CallUsage } from '@/modules/cv-generation/call'
import { gatherCoverLetterInputs } from './gather'
import { checkLandingTarget, landLetter } from './land'
import { rememberChoice } from './preferences'
import { createRun, failRun, findOpenRun, lockKey, openWhere, setStatus, updateOpen, FAILURE_MESSAGES } from './run'
import {
  ANGLES_VALID_MS,
  ChoiceSchema,
  CONCURRENCY_PER_PROFILE,
  PROCESSING_STALE_MS,
  PROCESSING_STATUSES,
  StoredAnglesSchema,
  TIME_BUDGET_MS,
  parseLog,
  parseStored,
  type CoverLetterChoice,
  type CoverLetterFailureKind,
  type CoverLetterStage,
  type CoverLetterStatus,
  type LogEntry,
} from './schema'
import { runAngles, runReview, runWrite } from './stages'

const json = (v: unknown) => v as Prisma.InputJsonValue

export function failureKindFor(err: unknown): CoverLetterFailureKind {
  if (!(err instanceof LLMError)) return 'error'
  switch (err.kind) {
    case 'not_configured': return 'no_llm_key'
    case 'timeout': return 'timeout'
    case 'rate_limit': return 'rate_limited'
    case 'unavailable': return 'overloaded'
    case 'safety': return 'refusal'
    case 'invalid_output': return 'invalid_output'
    default: return 'error'
  }
}

/** Collects log entries for one phase, appended to what the run already logged. */
function phaseLog(previous: LogEntry[]) {
  const entries = [...previous]
  let stage: CoverLetterStage = 'gather'
  let started = Date.now()
  return {
    entries,
    begin(s: CoverLetterStage) { stage = s; started = Date.now() },
    end(e: { status: LogEntry['status']; model?: string | null; usage?: CallUsage | null; retries?: number; notes: string[] }) {
      entries.push({
        stage, status: e.status, model: e.model ?? null, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started,
        tokens: { input: e.usage?.input ?? 0, output: e.usage?.output ?? 0 },
        costUsd: e.usage && e.usage.calls > 0 ? e.usage.costUsd : null,
        retries: e.retries ?? 0, notes: e.notes,
      })
    },
    get stage() { return stage },
  }
}

// ── Phase 1: suggest angles ───────────────────────────────────────────────

export type StartResult =
  | { kind: 'started'; runId: string }
  | { kind: 'existing'; runId: string; status: CoverLetterStatus }
  | { kind: 'limit' }
  | { kind: 'not_found' }
  | { kind: 'draft_exists'; documentId: string }

export async function startCoverLetter(profileId: string, jobId: string, opts: { fresh?: boolean } = {}): Promise<StartResult> {
  const open = await findOpenRun(profileId, jobId)
  if (open && !(opts.fresh && open.status === 'awaiting_choice')) return { kind: 'existing', runId: open.id, status: open.status }
  const landing = await checkLandingTarget(profileId, jobId)
  if (landing.kind === 'draft_exists') return landing
  const created = await createRun(profileId, jobId, opts)
  if (created.kind !== 'created') return created
  after(() => runSuggestPhase(created.runId, profileId))
  return { kind: 'started', runId: created.runId }
}

export async function runSuggestPhase(runId: string, profileId: string): Promise<void> {
  const log = phaseLog([])
  const fail = async (kind: CoverLetterFailureKind, notes: string[] = [], usage?: CallUsage) => {
    log.end({ status: 'failed', usage, notes: [FAILURE_MESSAGES[kind], ...notes] })
    await failRun(profileId, runId, kind, { data: { log: json(log.entries) } })
  }
  try {
    const row = await prisma.coverLetterGeneration.findFirst({ where: { id: runId, profileId }, select: { jobApplicationId: true } })
    if (!row) return
    const jobId = row.jobApplicationId
    const deadline = Date.now() + TIME_BUDGET_MS.suggestPhase
    if (!(await setStatus(profileId, runId, 'gathering', { startedAt: new Date() }))) return
    log.begin('gather')
    if (!(await getLLMConfigStatus(profileId)).configured) return await fail('no_llm_key')
    const landing = await checkLandingTarget(profileId, jobId)
    if (landing.kind === 'limit') return await fail('document_limit')
    const g = await gatherCoverLetterInputs(profileId, jobId)
    if (!g.ok) return await fail(g.kind === 'no_description' ? 'no_description' : 'error')
    log.end({ status: 'ok', notes: g.value.notes })

    if (!(await setStatus(profileId, runId, 'suggesting', { deepDiveId: g.value.deepDiveId, log: json(log.entries) }))) return
    log.begin('angles')
    const writingDeskDocumentId = landing.kind === 'ok' ? landing.documentId : null
    let angles: Awaited<ReturnType<typeof runAngles>>
    try {
      angles = await runAngles(g.value, { profileId, jobApplicationId: jobId, runId, deadline, writingDeskDocumentId })
    } catch (err) {
      return await fail(failureKindFor(err), [], usageOfError(err))
    }
    log.end({ status: 'ok', model: angles.model, usage: angles.usage, retries: angles.retries, notes: angles.notes })
    await setStatus(profileId, runId, 'awaiting_choice', { angles: json(angles.value), log: json(log.entries) })
  } catch (err) {
    console.error('[cover-letter-generation] suggest phase failed', { runId, err })
    await fail('error')
  }
}

// ── Phase 2: write from the owner's choice ────────────────────────────────

export type ChooseResult =
  | { kind: 'started'; runId: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'not_found' }
  /** The run isn't waiting for a choice (already chosen, finished, or its angles expired). */
  | { kind: 'not_waiting'; status: CoverLetterStatus }
  | { kind: 'draft_exists'; documentId: string }
  | { kind: 'limit' }

/** Starts phase 2 for a run of `jobId` that waits for a choice. The run must be the profile's and that job's. */
export async function chooseCoverLetterAngle(profileId: string, jobId: string, runId: string, input: unknown): Promise<ChooseResult> {
  const parsed = ChoiceSchema.safeParse(input)
  if (!parsed.success) return { kind: 'invalid', message: parsed.error.issues[0]?.message ?? 'Invalid choice' }
  const choice = parsed.data

  const row = await prisma.coverLetterGeneration.findFirst({
    where: { id: runId, profileId, jobApplicationId: jobId },
    select: { jobApplicationId: true, status: true, angles: true, updatedAt: true },
  })
  if (!row) return { kind: 'not_found' }
  const waiting = row.status === 'awaiting_choice' && row.updatedAt.getTime() >= Date.now() - ANGLES_VALID_MS
  if (!waiting) return { kind: 'not_waiting', status: row.status === 'awaiting_choice' ? 'failed' : (row.status as CoverLetterStatus) }
  const angles = parseStored(StoredAnglesSchema, row.angles)
  if ('index' in choice.angle && (!angles || choice.angle.index >= angles.angles.length)) {
    return { kind: 'invalid', message: 'That angle does not exist. Pick one of the suggestions or write your own.' }
  }
  const landing = await checkLandingTarget(profileId, row.jobApplicationId)
  if (landing.kind === 'draft_exists') return landing

  // Admission: the move to `writing` and the concurrency count happen under the profile's lock.
  const admitted = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(profileId)}))`
    const processing = await tx.coverLetterGeneration.count({
      where: { profileId, status: { in: [...PROCESSING_STATUSES] }, updatedAt: { gte: new Date(Date.now() - PROCESSING_STALE_MS) } },
    })
    if (processing >= CONCURRENCY_PER_PROFILE) return 'limit' as const
    const moved = await tx.coverLetterGeneration.updateMany({
      where: { id: runId, profileId, status: 'awaiting_choice', ...openWhere() },
      data: { status: 'writing', choice: json(choice) },
    })
    return moved.count === 1 ? ('ok' as const) : ('gone' as const)
  })
  if (admitted === 'limit') return { kind: 'limit' }
  if (admitted === 'gone') return { kind: 'not_waiting', status: 'failed' }

  if (choice.remember) await rememberChoice(profileId, choice)
  after(() => runWritePhase(runId, profileId))
  return { kind: 'started', runId }
}

export async function runWritePhase(runId: string, profileId: string): Promise<void> {
  const row = await prisma.coverLetterGeneration.findFirst({
    where: { id: runId, profileId },
    select: { jobApplicationId: true, angles: true, choice: true, log: true },
  })
  if (!row) return
  const log = phaseLog(parseLog(row.log))
  let keep: Record<string, Prisma.InputJsonValue> = {}
  const fail = async (kind: CoverLetterFailureKind, notes: string[] = [], usage?: CallUsage) => {
    log.end({ status: 'failed', usage, notes: [FAILURE_MESSAGES[kind], ...notes] })
    await failRun(profileId, runId, kind, { data: { ...keep, log: json(log.entries) } })
  }
  try {
    const jobId = row.jobApplicationId
    const choice = ChoiceSchema.safeParse(row.choice)
    if (!choice.success) return await fail('error', ['The stored choice could not be read.'])
    const angles = parseStored(StoredAnglesSchema, row.angles)
    const deadline = Date.now() + TIME_BUDGET_MS.writePhase

    log.begin('write')
    const g = await gatherCoverLetterInputs(profileId, jobId)
    if (!g.ok) return await fail(g.kind === 'no_description' ? 'no_description' : 'error')
    const landing = await checkLandingTarget(profileId, jobId)
    const ctx = { profileId, jobApplicationId: jobId, runId, deadline, writingDeskDocumentId: landing.kind === 'ok' ? landing.documentId : null }
    let written: Awaited<ReturnType<typeof runWrite>>
    try {
      written = await runWrite(g.value, angles, choice.data as CoverLetterChoice, ctx)
    } catch (err) {
      return await fail(failureKindFor(err), [], usageOfError(err))
    }
    log.end({ status: 'ok', model: written.model, usage: written.usage, retries: written.retries, notes: written.notes })
    keep = { letter: json(written.written) }

    if (!(await setStatus(profileId, runId, 'reviewing', { letter: json(written.written), log: json(log.entries) }))) return
    log.begin('review')
    const reviewed = await runReview(g.value, angles, choice.data as CoverLetterChoice, written.written, ctx)
    log.end({ status: reviewed.review.skipped ? 'skipped' : 'ok', model: reviewed.review.model, usage: reviewed.usage, notes: reviewed.notes })
    keep = { letter: json(reviewed.written), review: json(reviewed.review) }

    if (!(await setStatus(profileId, runId, 'landing', { ...keep, log: json(log.entries) }))) return
    log.begin('land')
    const landed = await landLetter(profileId, g.value.job, reviewed.written.markdown, {
      isOpen: async () => (await prisma.coverLetterGeneration.count({ where: { id: runId, profileId, status: 'landing', ...openWhere() } })) === 1,
      onTarget: (documentId) => updateOpen(profileId, runId, { writingDeskDocumentId: documentId }),
    })
    switch (landed.kind) {
      case 'landed':
        log.end({ status: 'ok', notes: [landed.created ? 'Created the job’s cover letter document and put the letter there as a draft.' : 'Put the letter in the job’s cover letter document as a draft.'] })
        await setStatus(profileId, runId, 'complete', { writingDeskDocumentId: landed.documentId, completedAt: new Date(), log: json(log.entries) })
        return
      case 'draft_exists': return await fail('draft_exists')
      case 'limit': return await fail('document_limit')
      case 'aborted': return
      case 'error': return await fail('error', [landed.message])
    }
  } catch (err) {
    console.error('[cover-letter-generation] write phase failed', { runId, err })
    await fail('error')
  }
}
