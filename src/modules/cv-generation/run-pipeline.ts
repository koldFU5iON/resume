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
 * - Stages 3-4 (write, assemble) move it writing → assembling; review and land
 *   (stages 5-6) do not exist yet, so a run is told where to `stopAfter`
 *   ('selecting' or 'assembling'): it finishes as `complete` with
 *   `log.partial = true` (a preview run that creates no draft). The assembled
 *   CV is stored on the row.
 *
 * A run killed mid-way stays in its active status and reads as failed /
 * timeout after CV_GENERATION_STALE_MS (queries.ts).
 */

import { after } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getLLMConfigStatus } from '@/modules/llm/client'
import { LLMError } from '@/modules/llm/errors'
import { loadVault } from '@/modules/profile-map/load'
import { toProfileSnapshot } from '@/modules/profile/snapshot'
import { assembleCv, employerOrderOf } from './assemble'
import { runBrief } from './brief'
import type { CallUsage } from './call'
import { gatherCvInputs } from './gather'
import { getRunUsage } from './queries'
import { createCvGenerationRun, failRun, setStatus, updateActive, FAILURE_MESSAGES } from './run'
import {
  CHECK_NOTE_PREFIX,
  CV_GENERATION_FEATURES,
  TIME_BUDGET_MS,
  type CvGenerationFailureKind,
  type CvGenerationStage,
  type StageLogEntry,
} from './schema'
import { runSelect, selectionLogLines } from './select'
import { countOf } from './text'
import { runWrite, WriteStageError } from './write/run-write'

/** How far a run goes. Review and Land do not exist yet; later phases widen this. */
export type StopAfter = 'selecting' | 'assembling'

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

/** Stage tokens and cost: from the call results when the stage has them (race-free), else the usage rows of its feature. */
async function stageUsage(profileId: string, runId: string, feature: string, calls: CallUsage | undefined): Promise<Pick<StageLogEntry, 'tokens' | 'costUsd'>> {
  if (calls && calls.calls > 0) return { tokens: { input: calls.input, output: calls.output }, costUsd: calls.costUsd }
  return featureUsage(profileId, runId, feature)
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** The pipeline. Never throws: every failure ends on the row. */
export async function runCvGenerationStages(runId: string, profileId: string, opts: { stopAfter: StopAfter } = { stopAfter: 'assembling' }): Promise<void> {
  const entries: StageLogEntry[] = []
  const timings: Partial<Record<CvGenerationStage, number>> = {}
  let stage: CvGenerationStage = 'gather'
  let stageStart = Date.now()
  const runStart = Date.now()
  const deadline = runStart + TIME_BUDGET_MS.run

  const log = (partial = false) => ({ entries, partial })
  const begin = (s: CvGenerationStage) => { stage = s; stageStart = Date.now() }
  const end = (entry: Omit<StageLogEntry, 'stage' | 'startedAt' | 'durationMs'>) => {
    const durationMs = Date.now() - stageStart
    timings[stage] = durationMs
    entries.push({ stage, startedAt: new Date(stageStart).toISOString(), durationMs, ...entry })
  }
  const fail = async (kind: CvGenerationFailureKind, notes: string[] = [], sections: StageLogEntry['sections'] = [], spent?: CallUsage) => {
    timings[stage] = Date.now() - stageStart
    entries.push({
      stage, status: 'failed', model: null, startedAt: new Date(stageStart).toISOString(), durationMs: timings[stage] ?? null,
      tokens: { input: spent?.input ?? 0, output: spent?.output ?? 0 }, costUsd: spent && spent.calls > 0 ? spent.costUsd : null,
      notes: [FAILURE_MESSAGES[kind], ...notes], kept: [], dropped: [], retries: 0, flaggedClaims: [], sections,
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
    const activityCount = c.employers.reduce((n, e) => n + e.activities.length, 0)
    const roleCount = c.employers.reduce((n, e) => n + e.roles.length, 0)
    const analysisUsage = g.strategy.source === 'analysed' || g.strategy.source === 'none'
      ? await featureUsage(profileId, runId, CV_GENERATION_FEATURES.analyse)
      : { tokens: { input: 0, output: 0 }, costUsd: null }
    end({
      status: 'ok', model: null, ...analysisUsage,
      notes: [
        ...g.notes,
        `Profile: ${countOf(roleCount, 'role')} at ${countOf(c.employers.length, 'employer')} with ${countOf(activityCount, 'activity', 'activities')}; ${countOf(c.skills.length, 'skill')}, ${countOf(c.tools.length, 'tool')}, ${countOf(c.competencies.length, 'competency', 'competencies')}, ${countOf(c.certifications.length, 'certification')}, ${c.education.length} education, ${countOf(c.projects.length, 'project')}.`,
      ],
      kept: [], dropped: [], retries: 0, flaggedClaims: [], sections: [],
    })

    // 1. Brief
    if (!(await setStatus(profileId, runId, 'briefing', {
      inputsHash: g.inputsHash, deepDiveId: g.deepDiveId, stageTimings: json(timings), log: json(log()),
    }))) return
    begin('brief')
    const brief = await runBrief(g, { profileId, jobApplicationId: jobId, runId, deadline })
    end({
      status: 'ok', model: brief.model, ...(await stageUsage(profileId, runId, CV_GENERATION_FEATURES.brief, brief.usage)),
      notes: [], kept: [], dropped: [], retries: brief.retries, flaggedClaims: [], sections: [],
    })

    // 2. Select
    if (!(await setStatus(profileId, runId, 'selecting', {
      brief: json(brief.value), stageTimings: json(timings), log: json(log()),
    }))) return
    begin('select')
    const picked = await runSelect(g, brief.value, { profileId, jobApplicationId: jobId, runId, deadline })
    const lines = selectionLogLines(picked.selection)
    end({
      status: 'ok', model: picked.model, ...(await stageUsage(profileId, runId, CV_GENERATION_FEATURES.select, picked.usage)),
      notes: [
        ...picked.notes,
        ...(lines.notSelected > 0 ? [`${lines.notSelected === 1 ? '1 other profile item was' : `${lines.notSelected} other profile items were`} not selected.`] : []),
      ],
      kept: lines.kept, dropped: lines.dropped, retries: picked.retries, flaggedClaims: [], sections: [],
    })

    // Review and Land (stages 5-6) do not exist yet: stopping after Select or
    // Assemble finishes a preview run (log.partial) that creates no draft.
    if (opts.stopAfter === 'selecting') {
      await updateActive(profileId, runId, {
        status: 'complete',
        selection: json(picked.selection),
        completedAt: new Date(),
        stageTimings: json(timings),
        log: json(log(true)),
      })
      return
    }

    // 3. Write. The selection is stored as the stage starts, so the page shows
    // what is being written from.
    if (!(await setStatus(profileId, runId, 'writing', {
      selection: json(picked.selection), stageTimings: json(timings), log: json(log()),
    }))) return
    begin('write')
    const vault = await loadVault(profileId)
    const written = await runWrite(vault, brief.value, picked.selection, g.strategy, { profileId, jobApplicationId: jobId, runId, deadline })
    const writeMs = Date.now() - stageStart
    end({
      status: 'ok',
      model: written.models.length === 0 ? null : written.models.join(', '),
      tokens: { input: written.usage.input, output: written.usage.output },
      costUsd: written.usage.calls > 0 ? written.usage.costUsd : null,
      notes: [
        `Wrote ${countOf(written.sections.length, 'section')} in ${seconds(writeMs)} (${countOf(written.usage.calls, 'model call')}); the run's budget is ${seconds(TIME_BUDGET_MS.run)}.`,
        ...written.notes,
      ],
      kept: [], dropped: [],
      retries: written.sections.reduce((n, s) => n + s.log.retries, 0),
      flaggedClaims: [],
      sections: written.sections.map((s) => s.log),
    })

    // 4. Assemble: code only.
    if (!(await setStatus(profileId, runId, 'assembling', { stageTimings: json(timings), log: json(log()) }))) return
    begin('assemble')
    const assembled = assembleCv({
      name: vault.identity.props.name,
      headline: written.headline,
      sections: written.sections,
      employerOrder: employerOrderOf(picked.selection),
      checkNotes: written.checkNotes,
      snapshot: toProfileSnapshot(vault),
    })
    if (!assembled.ok) return await fail('invalid_output', ['The assembled CV has invalid blocks.', ...assembled.issues])
    const cv = assembled.assembled
    end({
      status: 'ok', model: null, tokens: { input: 0, output: 0 }, costUsd: null,
      notes: [
        `Assembled ${countOf(cv.sections.length, 'section')} in the default CV structure, with the contact placeholder in the header.`,
        ...(cv.warnings.length > 0 ? [`${countOf(cv.warnings.length, 'warning')} from the block and fact checks (see below).`] : ['No warnings from the block and fact checks.']),
        ...cv.checkNotes.map((n) => `${CHECK_NOTE_PREFIX}${n}`),
        `The whole run took ${seconds(Date.now() - runStart)} of its ${seconds(TIME_BUDGET_MS.run)} budget.`,
      ],
      kept: [], dropped: [], retries: 0, flaggedClaims: [], sections: [],
    })
    await updateActive(profileId, runId, {
      status: 'complete',
      assembled: json(cv),
      completedAt: new Date(),
      stageTimings: json(timings),
      log: json(log(true)),
    })
  } catch (err) {
    let cause = err
    let sections: StageLogEntry['sections'] = []
    let spent: CallUsage | undefined
    if (err instanceof WriteStageError) {
      cause = err.original
      sections = err.sectionLogs
      spent = err.usage
    }
    const kind = failureKindFor(cause)
    if (kind === 'error') console.error('[cv-generation] run failed', { runId, err: cause })
    const notes: string[] = []
    if (cause instanceof LLMError && kind === 'invalid_output') notes.push(cause.message)
    if (kind === 'timeout') notes.push(`Timed out in the ${stage} stage after ${seconds(Date.now() - stageStart)}; the whole run had taken ${seconds(Date.now() - runStart)} of its ${seconds(TIME_BUDGET_MS.run)} budget.`)
    await fail(kind, notes, sections, spent)
  }
}
