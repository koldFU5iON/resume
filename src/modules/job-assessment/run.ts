/**
 * The early-assessment stage machine (plan "Pipeline"):
 *
 *   claim (queued → checking)
 *   verify ── fail + URL ──► enrich (fetching) ──► verifyRetry ── fail ──► failed / verification
 *     │ pass                                         │ pass
 *     ▼◄─────────────────────────────────────────────┘
 *   facts (assessing) → judge → combine → complete
 *
 * Runs inside after(), so it never throws: every error ends the row in
 * `failed` with a failureKind and a plain-words reason. Every terminal write
 * carries completedAt, processTimeMs, queueTimeMs and stageTimings (skipped
 * stages are left out). A failed Jev or LLM call is an error, never an answer.
 */

import type { Prisma } from '@prisma/client'
import type { Questions } from '@typesafe-ai/sdk'
import { prisma } from '@/lib/db'
import { askJev, JevError, type JevResult, type JevState } from '@/modules/jev/client'
import { LLMError } from '@/modules/llm/errors'
import { buildProfileSnapshot } from '@/modules/profile/snapshot'
import { normalizeSearchProfile } from '@/modules/search-profile/schema'
import { buildCandidateState, cutAtSentence } from './candidate-state'
import { combineAssessment, MissingAnswerError } from './combine'
import { toCountryCode } from './countries'
import { enrichJob, type EnrichJob } from './enrich'
import { extractJobFacts } from './facts'
import {
  buildJudgePreferences,
  buildJudgeQuestions,
  buildJudgeState,
  buildVerifyQuestions,
  buildVerifyState,
} from './questions'
import type { FailureKind, JobFacts } from './schema'
import { codeChecks, evaluateVerify, VERIFY_REASONS, type VerifyResult } from './verify'

/**
 * Per-call bound for Jev inside after(): 20s per attempt, one retry, and a
 * server Retry-After honoured only up to 5s. Worst case ≈ 45s per call.
 */
export const JEV_CALL_BOUNDS = { timeoutMs: 20_000, maxRetries: 1, maxRetryAfterMs: 5_000 } as const

/**
 * Job description cap in the judge state. With the candidate state at ≤ 32k
 * chars, this keeps the whole state near 18k tokens, well inside Jev's 32k
 * per-question limit (plan §4: stay under ~24k).
 */
export const JUDGE_DESCRIPTION_MAX_CHARS = 40_000

export type Stage = 'verify' | 'enrich' | 'verifyRetry' | 'facts' | 'judge' | 'combine'
export type StageTimings = Partial<Record<Stage, number>>

/** What happened to the row: `not_claimed` = someone else had it, or it wasn't queued. */
export type RunOutcome = 'not_claimed' | 'complete' | 'failed'

const JOB_SELECT = {
  id: true, url: true, title: true, company: true, jobDescription: true, countries: true, salaryBand: true,
} as const

/** Adds the wall-clock time of `fn` to `timings[stage]`, even when it throws. */
export async function timed<T>(timings: StageTimings, stage: Stage, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now()
  try {
    return await fn()
  } finally {
    timings[stage] = (timings[stage] ?? 0) + (Date.now() - t0)
  }
}

/** A failure that ends the run with a known kind and reasons. */
class RunFailure extends Error {
  constructor(public readonly kind: FailureKind, public readonly reasons: string[]) {
    super(reasons[0] ?? kind)
    this.name = 'RunFailure'
  }
}

/** Maps any error to a failure kind and safe, user-facing reasons (no secrets, no job text). */
export function classifyFailure(err: unknown): { kind: FailureKind; reasons: string[] } {
  if (err instanceof RunFailure) return { kind: err.kind, reasons: err.reasons }
  if (err instanceof JevError) {
    switch (err.kind) {
      case 'not_configured':
        return { kind: 'not_configured', reasons: ['The assessment service is not configured'] }
      case 'daily_cap':
        return { kind: 'daily_cap', reasons: ['Daily assessment limit reached — re-run tomorrow'] }
      case 'rate_limited':
        return { kind: 'rate_limited', reasons: ['The assessment service is busy — re-run in a few minutes'] }
      case 'overloaded':
        return { kind: 'overloaded', reasons: ['The assessment service is overloaded — re-run in a few minutes'] }
      default:
        return { kind: 'error', reasons: [`The assessment service failed (${err.kind})`] }
    }
  }
  if (err instanceof LLMError) {
    if (err.kind === 'not_configured') {
      return { kind: 'no_llm_key', reasons: ['Add an LLM key in Settings to assess jobs'] }
    }
    return { kind: 'error', reasons: [`Reading the job description failed (${err.kind})`] }
  }
  if (err instanceof MissingAnswerError) {
    return { kind: 'error', reasons: ['The assessment service returned an incomplete answer'] }
  }
  return { kind: 'error', reasons: ['Unexpected error during the assessment'] }
}

/** Mutable record of what the run produced, written on every terminal path. */
interface RunContext {
  timings: StageTimings
  signals: Record<string, unknown>
  request: Record<string, unknown>
  jevModel: string | null
  enrichedFields: string[]
  facts: JobFacts | null
  factsHash: string | null
}

function recordJev(ctx: RunContext, stage: string, res: Pick<JevResult<Questions>, 'answers' | 'request' | 'model'>): void {
  ctx.signals[stage] = res.answers
  ctx.request[stage] = res.request
  ctx.jevModel = res.model
}

/** Code checks, then (only when they pass) the Jev verify request. */
async function verifyJob(profileId: string, job: EnrichJob, ctx: RunContext, stage: 'verify' | 'verifyRetry'): Promise<VerifyResult> {
  const v = { title: job.title, company: job.company, description: job.jobDescription }
  const issues = codeChecks(v)
  if (issues.length > 0) return { pass: false, reasons: issues }
  const res = await askJev(
    profileId,
    { state: { ...buildVerifyState({ description: job.jobDescription ?? '' }) }, questions: buildVerifyQuestions() },
    { feature: 'job-assessment-verify', ...JEV_CALL_BOUNDS },
  )
  recordJev(ctx, stage, res)
  return evaluateVerify(v, res.answers)
}

/**
 * Facts with the location falling back to the job row's countries when the
 * description named none (spec §1). The stored facts stay as extracted.
 */
export function withCountryFallback(facts: JobFacts, rowCountries: readonly string[]): JobFacts {
  if (facts.location.countries.length > 0) return facts
  const codes = [...new Set(rowCountries.map((c) => toCountryCode(c)).filter((c): c is string => Boolean(c)))]
  if (codes.length === 0) return facts
  return { ...facts, location: { ...facts.location, countries: codes } }
}

const TOO_SHORT_PREFIX = VERIFY_REASONS.descriptionShort(0).split(' (')[0]

/**
 * Verification failed because the description is incomplete: Jev says it's a
 * teaser or truncated, or the code check says it's too short. Then enrichment
 * may replace it with a clearly better one from the job page.
 */
export function descriptionIncomplete(reasons: readonly string[]): boolean {
  return reasons.some((r) => r === VERIFY_REASONS.incomplete || r.startsWith(TOO_SHORT_PREFIX))
}

async function setStatus(id: string, status: 'fetching' | 'assessing'): Promise<void> {
  await prisma.jobAssessment.update({ where: { id }, data: { status } })
}

function json(value: unknown): Prisma.InputJsonValue | undefined {
  return value === null || value === undefined ? undefined : (value as Prisma.InputJsonValue)
}

function hasKeys(o: Record<string, unknown>): boolean {
  return Object.keys(o).length > 0
}

/**
 * Runs one queued assessment to completion. Claims the row first (exits when
 * it isn't `queued`), so a row is never run twice. Never throws.
 */
export async function runJobAssessment(assessmentId: string): Promise<RunOutcome> {
  const startedAt = new Date()
  let claimed = false
  let createdAt: Date | null = null
  const ctx: RunContext = {
    timings: {}, signals: {}, request: {}, jevModel: null, enrichedFields: [], facts: null, factsHash: null,
  }

  const timing = () => {
    const completedAt = new Date()
    return {
      completedAt,
      processTimeMs: completedAt.getTime() - startedAt.getTime(),
      queueTimeMs: createdAt ? Math.max(0, startedAt.getTime() - createdAt.getTime()) : null,
      stageTimings: ctx.timings as Prisma.InputJsonValue,
    }
  }

  const partial = () => ({
    enrichedFields: ctx.enrichedFields,
    jevModel: ctx.jevModel,
    signals: hasKeys(ctx.signals) ? json(ctx.signals) : undefined,
    request: hasKeys(ctx.request) ? json(ctx.request) : undefined,
    facts: json(ctx.facts),
    factsHash: ctx.factsHash,
  })

  try {
    const claim = await prisma.jobAssessment.updateMany({
      where: { id: assessmentId, status: 'queued' },
      data: { status: 'checking', startedAt },
    })
    if (claim.count === 0) return 'not_claimed'
    claimed = true

    const row = await prisma.jobAssessment.findUniqueOrThrow({
      where: { id: assessmentId },
      select: { profileId: true, jobApplicationId: true, createdAt: true },
    })
    createdAt = row.createdAt
    const { profileId } = row

    let job: EnrichJob | null = await prisma.jobApplication.findFirst({
      where: { id: row.jobApplicationId, profileId },
      select: JOB_SELECT,
    })
    if (!job) throw new RunFailure('error', ['The job no longer exists'])

    // ── Verify (→ enrich → verify again) ──
    let verify = await timed(ctx.timings, 'verify', () => verifyJob(profileId, job!, ctx, 'verify'))
    if (!verify.pass) {
      if (!job.url) throw new RunFailure('verification', verify.reasons)
      await setStatus(assessmentId, 'fetching')
      const failedVerify = verify
      const enriched = await timed(ctx.timings, 'enrich', () =>
        enrichJob(profileId, job!, { replaceDescription: descriptionIncomplete(failedVerify.reasons) }),
      ).catch((err: unknown) => {
        // Without a key nothing can be fetched; keep the verification reasons visible.
        if (err instanceof LLMError && err.kind === 'not_configured') {
          throw new RunFailure('no_llm_key', [...failedVerify.reasons, 'Add an LLM key in Settings to fetch the missing details'])
        }
        throw err
      })
      ctx.enrichedFields = enriched.filled
      if (enriched.filled.length === 0) {
        // Nothing changed, so verifying again would give the same answer.
        throw new RunFailure('verification', [...verify.reasons, ...(enriched.error ? [enriched.error] : [])])
      }
      job = enriched.job
      verify = await timed(ctx.timings, 'verifyRetry', () => verifyJob(profileId, job!, ctx, 'verifyRetry'))
      if (!verify.pass) throw new RunFailure('verification', verify.reasons)
    }

    // ── Facts ──
    await setStatus(assessmentId, 'assessing')
    const factsResult = await timed(ctx.timings, 'facts', () => extractJobFacts(profileId, job!))
    ctx.facts = factsResult.facts
    ctx.factsHash = factsResult.factsHash

    // ── Judge ──
    const judged = await timed(ctx.timings, 'judge', async () => {
      const [snapshot, profileRow, settings] = await Promise.all([
        buildProfileSnapshot(profileId),
        // ProfileSnapshot has no summary; buildCandidateState takes it alongside.
        prisma.profile.findUnique({ where: { id: profileId }, select: { summary: true } }),
        prisma.userSettings.findUnique({ where: { profileId }, select: { searchProfile: true } }),
      ])
      const searchProfile = normalizeSearchProfile(settings?.searchProfile)
      const candidate = buildCandidateState({ ...snapshot, summary: profileRow?.summary ?? null })
      const preferences = buildJudgePreferences(searchProfile)
      const state = buildJudgeState({
        candidate: candidate.state,
        job: {
          title: job!.title,
          company: job!.company ?? '',
          description: cutAtSentence(job!.jobDescription ?? '', JUDGE_DESCRIPTION_MAX_CHARS),
        },
        preferences,
      })
      const questions = buildJudgeQuestions({
        facts: factsResult.facts,
        roleKeys: candidate.timeline.map((r) => r.key),
        preferences,
        dealbreakers: searchProfile.eligibility.dealbreakers,
      })
      // Plain JSON data; its interfaces just lack the index signature JevState wants.
      const res = await askJev(profileId, { state: state as unknown as JevState, questions }, {
        feature: 'job-assessment-judge', ...JEV_CALL_BOUNDS,
      })
      recordJev(ctx, 'judge', res)
      return { res, candidate, searchProfile }
    })

    // ── Combine ──
    const result = await timed(ctx.timings, 'combine', async () =>
      combineAssessment({
        facts: withCountryFallback(factsResult.facts, job!.countries),
        answers: judged.res.answers,
        timeline: judged.candidate.timeline,
        eligibility: judged.searchProfile.eligibility,
        searchProfile: judged.searchProfile,
        today: new Date(),
      }),
    )
    // Derived values with no column of their own, kept for tuning and the UI.
    ctx.signals.combine = { notes: result.notes, years: result.years, breakdown: result.breakdown }

    // ── Persist ──
    await prisma.jobAssessment.update({
      where: { id: assessmentId },
      data: {
        ...partial(),
        status: 'complete',
        score: result.score,
        level: result.level,
        blocked: result.blocked,
        blockers: result.blockers as unknown as Prisma.InputJsonValue,
        strengths: result.strengths,
        gaps: result.gaps,
        unsettled: result.unsettled,
        ...timing(),
      },
    })
    return 'complete'
  } catch (err) {
    if (!claimed) {
      console.error('[job-assessment] claim failed', { assessmentId, error: errorName(err) })
      return 'not_claimed'
    }
    const { kind, reasons } = classifyFailure(err)
    if (kind === 'error') {
      console.error('[job-assessment] run failed', { assessmentId, error: errorName(err) })
    }
    try {
      await prisma.jobAssessment.update({
        where: { id: assessmentId },
        data: { ...partial(), status: 'failed', failureKind: kind, failureReasons: reasons, ...timing() },
      })
    } catch (writeErr) {
      console.error('[job-assessment] could not record failure', { assessmentId, error: errorName(writeErr) })
    }
    return 'failed'
  }
}

/** Error class and kind only: messages can carry provider detail or job text. */
function errorName(err: unknown): string {
  if (err instanceof JevError) return `JevError:${err.kind}`
  if (err instanceof LLMError) return `LLMError:${err.kind}`
  if (err instanceof Error) return err.name
  return typeof err
}
