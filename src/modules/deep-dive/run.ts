/**
 * Starting and running a deep dive (spec §3, §8).
 *
 * Plain module (not 'use server'): it takes `profileId` explicitly so the
 * session route, the bearer-token route and the Server Action share it.
 *
 * - `startDeepDive` admits a run under a per-profile advisory lock: one
 *   active run per job (a second request gets the running one back) and at
 *   most DEEP_DIVE_CONCURRENCY_PER_PROFILE active runs per profile. It
 *   inserts a `queued` row and runs the pipeline in after(); every route
 *   segment that calls it sets maxDuration = DEEP_DIVE_ROUTE_MAX_DURATION_S.
 * - `runDeepDive` is the pipeline: gather → research → synthesis. The row id
 *   is the runId on every LLM call. Blocked jobs are allowed (no gate).
 * - A run killed mid-way (after() cut off) stays in its active status and
 *   reads as failed / timeout after DEEP_DIVE_STALE_MS (queries.ts); it also
 *   stops counting towards the limits then.
 * - Rows are never written after they reach complete or failed.
 */

import { after } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getLLMConfigStatus } from '@/modules/llm/client'
import { LLMError } from '@/modules/llm/errors'
import { supportsWebSearch } from '@/modules/llm/web-search'
import { gatherDeepDiveInputs, type GatherResult } from './gather'
import { runResearch } from './research'
import { synthesise } from './synthesise'
import {
  ACTIVE_STATUSES,
  COMPANY_RESEARCH_TTL_MS,
  DEEP_DIVE_CONCURRENCY_PER_PROFILE,
  DEEP_DIVE_STALE_MS,
  TIME_BUDGET_MS,
  flattenFindings,
  type DeepDiveFailureKind,
  type DeepDiveResearch,
  type DeepDiveStatus,
} from './schema'

export type StartDeepDiveResult =
  | { kind: 'started'; deepDiveId: string }
  /** A run of this job is already active; its id. */
  | { kind: 'existing'; deepDiveId: string }
  /** The profile already has the maximum number of active runs. */
  | { kind: 'limit' }
  | { kind: 'not_found' }
  | { kind: 'no_description' }
  | { kind: 'no_llm_key' }

/** Advisory-lock key serialising admission per profile. */
export function deepDiveLockKey(profileId: string): string {
  return `deep-dive:${profileId}`
}

/**
 * Admits and starts a deep dive of `jobId`. The pipeline runs in after(), so
 * the caller returns at once (202 + deepDiveId).
 */
export async function startDeepDive(profileId: string, jobId: string): Promise<StartDeepDiveResult> {
  const job = await prisma.jobApplication.findFirst({
    where: { id: jobId, profileId },
    select: { jobDescription: true },
  })
  if (!job) return { kind: 'not_found' }
  if (!job.jobDescription?.trim()) return { kind: 'no_description' }
  if (!(await getLLMConfigStatus(profileId)).configured) return { kind: 'no_llm_key' }

  const result = await prisma.$transaction(async (tx): Promise<StartDeepDiveResult> => {
    // Held until the transaction ends; admissions for one profile serialise across instances.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${deepDiveLockKey(profileId)}))`
    const liveSince = new Date(Date.now() - DEEP_DIVE_STALE_MS)
    const active = { status: { in: [...ACTIVE_STATUSES] }, createdAt: { gte: liveSince } }

    const running = await tx.jobDeepDive.findFirst({
      where: { profileId, jobApplicationId: jobId, ...active },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (running) return { kind: 'existing', deepDiveId: running.id }

    const count = await tx.jobDeepDive.count({ where: { profileId, ...active } })
    if (count >= DEEP_DIVE_CONCURRENCY_PER_PROFILE) return { kind: 'limit' }

    const row = await tx.jobDeepDive.create({
      data: { profileId, jobApplicationId: jobId, status: 'queued' },
      select: { id: true },
    })
    return { kind: 'started', deepDiveId: row.id }
  })

  if (result.kind === 'started') {
    const deepDiveId = result.deepDiveId
    after(() => runDeepDive(profileId, jobId, deepDiveId))
  }
  return result
}

/** Maps an LLMError kind to the run's failureKind. */
export function failureKindFor(err: unknown): DeepDiveFailureKind {
  if (!(err instanceof LLMError)) return 'error'
  switch (err.kind) {
    case 'not_configured': return 'no_llm_key'
    case 'timeout': return 'timeout'
    case 'rate_limit': return 'rate_limited'
    case 'unavailable': return 'overloaded'
    case 'safety': return 'refusal'
    default: return 'error'
  }
}

const FAILURE_MESSAGES: Record<DeepDiveFailureKind, string> = {
  no_llm_key: 'No LLM API key configured. Add one in Settings → LLM.',
  no_description: 'The job has no description to analyse.',
  timeout: 'The deep dive took too long and was stopped. Try again.',
  rate_limited: 'Your LLM provider is rate limiting requests. Try again shortly.',
  overloaded: 'Your LLM provider is unavailable right now. Try again shortly.',
  refusal: 'The model declined to write the report.',
  error: 'The deep dive failed. Try again.',
}

/** Updates a run that is still active; a finished row is never written again. */
async function updateActive(id: string, data: Prisma.JobDeepDiveUncheckedUpdateManyInput): Promise<boolean> {
  const res = await prisma.jobDeepDive.updateMany({
    where: { id, status: { in: [...ACTIVE_STATUSES] } },
    data,
  })
  return res.count === 1
}

function setStatus(id: string, status: DeepDiveStatus, data: Prisma.JobDeepDiveUncheckedUpdateManyInput = {}) {
  return updateActive(id, { ...data, status })
}

async function fail(id: string, kind: DeepDiveFailureKind, message: string | null, timings: object): Promise<void> {
  await updateActive(id, {
    status: 'failed',
    failureKind: kind,
    failureMessage: message ?? FAILURE_MESSAGES[kind],
    completedAt: new Date(),
    stageTimings: timings as Prisma.InputJsonValue,
  }).catch((err) => console.error('[deep-dive] could not record failure', { id, err }))
}

/**
 * Stores fresh company findings for other runs (and users) to reuse. Best
 * effort. Only web-sourced findings are shared: a job-ad quote belongs to this
 * job's ad. An agency's ad isn't cached at all, since the researcher may have
 * researched the hiring company rather than the agency the job is linked to.
 */
async function cacheCompanyResearch(g: GatherResult, research: DeepDiveResearch, now: Date): Promise<void> {
  const company = research.researchers.company
  if (!g.companyId || g.brief.isRecruitmentAgency || company.status !== 'ok' || !company.model) return
  const findings = company.findings.filter((f) => f.sourceUrl !== null)
  if (findings.length === 0) return
  try {
    await prisma.companyResearch.create({
      data: {
        companyId: g.companyId,
        topic: 'company',
        findings: findings as unknown as Prisma.InputJsonValue,
        model: company.model,
        expiresAt: new Date(now.getTime() + COMPANY_RESEARCH_TTL_MS),
      },
    })
  } catch (err) {
    console.error('[deep-dive] could not cache company research', { companyId: g.companyId, err })
  }
}

/** The pipeline. Never throws: every failure ends on the row. */
export async function runDeepDive(profileId: string, jobId: string, deepDiveId: string): Promise<void> {
  const timings: { gather?: number; research?: Record<string, number>; synthesis?: number } = {}
  try {
    // 1. Gather
    let t = Date.now()
    if (!(await setStatus(deepDiveId, 'gathering', { startedAt: new Date() }))) return
    const gathered = await gatherDeepDiveInputs(profileId, jobId)
    timings.gather = Date.now() - t
    if (!gathered.ok) {
      await fail(deepDiveId, gathered.kind === 'no_description' ? 'no_description' : 'error', gathered.message, timings)
      return
    }
    const g = gathered

    // 2. Research (no profile data: researchers get the public brief only)
    const config = await getLLMConfigStatus(profileId)
    if (!config.configured) {
      await fail(deepDiveId, 'no_llm_key', null, timings)
      return
    }
    if (!(await setStatus(deepDiveId, 'researching', {
      inputsHash: g.inputsHash,
      sourceAssessmentId: g.earlyAssessment?.id ?? null,
    }))) return
    t = Date.now()
    const now = new Date()
    const { researchers, timings: researchTimings } = await runResearch(g.brief, {
      profileId,
      jobApplicationId: jobId,
      runId: deepDiveId,
      webSearch: !!config.provider && supportsWebSearch(config.provider),
      cachedCompanyResearch: g.cachedCompanyResearch,
      deadline: t + TIME_BUDGET_MS.research,
      today: now,
    })
    timings.research = researchTimings
    const research: DeepDiveResearch = { researchers, findings: flattenFindings(researchers) }
    await cacheCompanyResearch(g, research, now)
    const researchModel = Object.values(researchers).find((r) => r.status === 'ok' && r.model)?.model ?? null

    // 3. Synthesis
    if (!(await setStatus(deepDiveId, 'synthesising', {
      research: research as unknown as Prisma.InputJsonValue,
      researchModel,
    }))) return
    t = Date.now()
    let synthesis
    try {
      synthesis = await synthesise(g, research, {
        profileId,
        jobApplicationId: jobId,
        runId: deepDiveId,
        timeoutMs: TIME_BUDGET_MS.synthesis,
      })
    } finally {
      timings.synthesis = Date.now() - t
    }

    await updateActive(deepDiveId, {
      status: 'complete',
      report: synthesis.report as unknown as Prisma.InputJsonValue,
      synthesisModel: synthesis.model,
      verdict: synthesis.report.verdict,
      worthTailoredCv: synthesis.report.worthTailoredCv.answer,
      completedAt: new Date(),
      stageTimings: timings as Prisma.InputJsonValue,
    })
  } catch (err) {
    const kind = failureKindFor(err)
    if (kind === 'error') console.error('[deep-dive] run failed', { deepDiveId, err })
    await fail(deepDiveId, kind, null, timings)
  }
}
