/**
 * Starting and running a CV generation (docs/cv-generation.md, stages 0-2).
 *
 * Plain module (not 'use server'): it takes `profileId` explicitly so the
 * session route and any later caller share it.
 *
 * - `startCvGeneration` admits a run (run.ts: one live run per job, two per
 *   profile) and executes the pipeline in after(); every route segment that
 *   calls it sets maxDuration = CV_GENERATION_ROUTE_MAX_DURATION_S.
 * - `runCvGenerationStages` moves the row gathering → briefing → selecting
 *   with the guarded `setStatus` (a stage never runs twice, a finished or
 *   stale row is never written), logs one entry per stage as it ends, and
 *   ends the row on any failure. It never throws.
 * - Stages 3-6 (write, assemble, review, land) do not exist yet, so a run is
 *   told to `stopAfter: 'selecting'`: it finishes as `complete` with
 *   `log.partial = true` (a preview run that creates no draft).
 *
 * A run killed mid-way stays in its active status and reads as failed /
 * timeout after CV_GENERATION_STALE_MS (queries.ts).
 */

import { after } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getLLMConfigStatus } from '@/modules/llm/client'
import { LLMError } from '@/modules/llm/errors'
import { runBrief } from './brief'
import { gatherCvInputs } from './gather'
import { getRunUsage } from './queries'
import { createCvGenerationRun, failRun, setStatus, updateActive, FAILURE_MESSAGES } from './run'
import {
  CV_GENERATION_FEATURES,
  TIME_BUDGET_MS,
  type CvGenerationFailureKind,
  type CvGenerationStage,
  type StageLogEntry,
} from './schema'
import { runSelect, selectionLogLines } from './select'

/** How far a run goes. Only the Select stage exists so far; later phases widen this. */
export type StopAfter = 'selecting'

export type StartCvGenerationResult =
  | { kind: 'started'; runId: string }
  /** A run of this job is already active; its id. */
  | { kind: 'existing'; runId: string }
  /** The profile already has the maximum number of active runs. */
  | { kind: 'limit' }
  | { kind: 'not_found' }

/**
 * Admits and starts a run of `jobId`. The pipeline runs in after(), so the
 * caller returns at once (202 + runId). A missing key or description is not
 * refused here: the run starts and ends failed (no_llm_key / no_description),
 * so the log page shows why.
 */
export async function startCvGeneration(
  profileId: string,
  jobId: string,
  opts: { stopAfter: StopAfter },
): Promise<StartCvGenerationResult> {
  const result = await createCvGenerationRun(profileId, jobId)
  if (result.kind === 'created') {
    const runId = result.runId
    after(() => runCvGenerationStages(runId, profileId, opts))
    return { kind: 'started', runId }
  }
  return result
}

/** Maps an error to the run's failureKind. */
export function failureKindFor(err: unknown): CvGenerationFailureKind {
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

/** Tokens and cost of one feature's calls in this run (best effort: null cost when unpriced). */
async function featureUsage(profileId: string, runId: string, feature: string): Promise<Pick<StageLogEntry, 'tokens' | 'costUsd'>> {
  try {
    const bucket = (await getRunUsage(profileId, runId)).byFeature[feature]
    if (!bucket) return { tokens: { input: 0, output: 0 }, costUsd: null }
    return {
      tokens: { input: bucket.inputTokens, output: bucket.outputTokens },
      costUsd: bucket.requests > 0 && bucket.estimateComplete ? bucket.estimatedCostUsd : null,
    }
  } catch (err) {
    console.error('[cv-generation] could not read run usage', { runId, err })
    return { tokens: { input: 0, output: 0 }, costUsd: null }
  }
}

const json = (v: unknown) => v as Prisma.InputJsonValue

/** The pipeline. Never throws: every failure ends on the row. */
export async function runCvGenerationStages(runId: string, profileId: string, opts: { stopAfter: StopAfter } = { stopAfter: 'selecting' }): Promise<void> {
  const entries: StageLogEntry[] = []
  const timings: Partial<Record<CvGenerationStage, number>> = {}
  let stage: CvGenerationStage = 'gather'
  let stageStart = Date.now()
  const deadline = Date.now() + TIME_BUDGET_MS.run

  const log = (partial = false) => ({ entries, partial })
  const begin = (s: CvGenerationStage) => { stage = s; stageStart = Date.now() }
  const end = (entry: Omit<StageLogEntry, 'stage' | 'startedAt' | 'durationMs'>) => {
    const durationMs = Date.now() - stageStart
    timings[stage] = durationMs
    entries.push({ stage, startedAt: new Date(stageStart).toISOString(), durationMs, ...entry })
  }
  const fail = async (kind: CvGenerationFailureKind, notes: string[] = []) => {
    timings[stage] = Date.now() - stageStart
    entries.push({
      stage, status: 'failed', model: null, startedAt: new Date(stageStart).toISOString(), durationMs: timings[stage] ?? null,
      tokens: { input: 0, output: 0 }, costUsd: null, notes: [FAILURE_MESSAGES[kind], ...notes], kept: [], dropped: [], retries: 0, flaggedClaims: [],
    })
    await failRun(profileId, runId, kind, null, { stageTimings: timings, log: log() })
  }

  try {
    const row = await prisma.cvGeneration.findFirst({ where: { id: runId, profileId }, select: { jobApplicationId: true } })
    if (!row) return
    const jobId = row.jobApplicationId

    // 0. Gather
    if (!(await setStatus(profileId, runId, 'gathering', { startedAt: new Date() }))) return
    begin('gather')
    if (!(await getLLMConfigStatus(profileId)).configured) return await fail('no_llm_key')
    const g = await gatherCvInputs(profileId, jobId, { runId })
    if (!g.ok) return await fail(g.kind === 'no_description' ? 'no_description' : 'error', g.kind === 'not_found' ? [g.message] : [])
    const c = g.candidates
    const activityCount = c.experiences.reduce((n, e) => n + e.activities.length, 0)
    const analysisUsage = g.strategy.source === 'analysed' || g.strategy.source === 'none'
      ? await featureUsage(profileId, runId, CV_GENERATION_FEATURES.analyse)
      : { tokens: { input: 0, output: 0 }, costUsd: null }
    end({
      status: 'ok', model: null, ...analysisUsage,
      notes: [
        ...g.notes,
        `Profile: ${c.experiences.length} roles with ${activityCount} activities, ${c.skills.length} skills, ${c.tools.length} tools, ${c.competencies.length} competencies, ${c.certifications.length} certifications, ${c.education.length} education, ${c.projects.length} projects.`,
      ],
      kept: [], dropped: [], retries: 0, flaggedClaims: [],
    })

    // 1. Brief
    if (!(await setStatus(profileId, runId, 'briefing', {
      inputsHash: g.inputsHash, deepDiveId: g.deepDiveId, stageTimings: json(timings), log: json(log()),
    }))) return
    begin('brief')
    const brief = await runBrief(g, { profileId, jobApplicationId: jobId, runId, deadline })
    end({
      status: 'ok', model: brief.model, ...(await featureUsage(profileId, runId, CV_GENERATION_FEATURES.brief)),
      notes: [], kept: [], dropped: [], retries: brief.retries, flaggedClaims: [],
    })

    // 2. Select
    if (!(await setStatus(profileId, runId, 'selecting', {
      brief: json(brief.value), stageTimings: json(timings), log: json(log()),
    }))) return
    begin('select')
    const picked = await runSelect(g, brief.value, { profileId, jobApplicationId: jobId, runId, deadline })
    const lines = selectionLogLines(picked.selection)
    end({
      status: 'ok', model: picked.model, ...(await featureUsage(profileId, runId, CV_GENERATION_FEATURES.select)),
      notes: [
        ...picked.notes,
        ...(lines.notSelected > 0 ? [`${lines.notSelected} other profile items were not selected.`] : []),
      ],
      kept: lines.kept, dropped: lines.dropped, retries: picked.retries, flaggedClaims: [],
    })

    // Stages 3-6 do not exist yet, so the only place to stop is after Select:
    // finish as a preview run (log.partial) that creates no draft.
    if (opts.stopAfter === 'selecting') {
      await updateActive(profileId, runId, {
        status: 'complete',
        selection: json(picked.selection),
        completedAt: new Date(),
        stageTimings: json(timings),
        log: json(log(true)),
      })
    }
  } catch (err) {
    const kind = failureKindFor(err)
    if (kind === 'error') console.error('[cv-generation] run failed', { runId, err })
    await fail(kind, err instanceof LLMError && kind === 'invalid_output' ? [err.message] : [])
  }
}
