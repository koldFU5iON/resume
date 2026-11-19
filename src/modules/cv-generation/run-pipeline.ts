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
 * - Stages 3-4 (write, assemble) move it writing → assembling.
 * - Stage 5 (review, write/review.ts) is ONE 'analysis' call that may edit the
 *   CV after code re-checks each edit; it never fails the run (a failure or
 *   `review: false` skips it, logged). Stage 6 (land, land.ts) creates the draft
 *   in the job's CV document. A run now ends `complete` (never `partial`);
 *   `log.partial` is only read from runs stored before Phase 4a.
 * - A run whose inputs are unchanged since the newest complete run of the job
 *   reuses that run's Brief and Select (reuse.ts) unless `fresh` is set.
 *
 * A run killed mid-way stays in its active status and reads as failed /
 * timeout after CV_GENERATION_STALE_MS (queries.ts).
 */

import { statedYears } from './write/years'
import { notesOf } from '@/modules/profile-map/build'
import { after } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getLLMConfigStatus } from '@/modules/llm/client'
import { LLMError } from '@/modules/llm/errors'
import { loadVault } from '@/modules/profile-map/load'
import { toProfileSnapshot } from '@/modules/profile/snapshot'
import { headerFacts } from './header-facts'
import { assembleCv, bodyWordCount, employerOrderOf, lengthNote, recheckMarkdown } from './assemble'
import { runBrief } from './brief'
import type { CallUsage } from './call'
import { gatherCvInputs } from './gather'
import { checkLandingTarget, landCv } from './land'
import { getRunUsage } from './queries'
import { createCvGenerationRun, failRun, findActiveCvGeneration, isRunActive, setStatus, updateActive, FAILURE_MESSAGES } from './run'
import { computeReuseKey, findReusableSelection, reuseNote } from './reuse'
import {
  CHECK_NOTE_PREFIX,
  CV_GENERATION_FEATURES,
  LAND_RESERVE_MS,
  TIME_BUDGET_MS,
  type CvBrief,
  type CvReview,
  type CvSelection,
  type CvGenerationFailureKind,
  type CvGenerationStage,
  type StageLogEntry,
} from './schema'
import { runSelect, selectionLogLines } from './select'
import { countOf } from './text'
import { evidenceFromVault } from './write/evidence'
import { withThinProjectConcerns } from './write/thin'
import { shortened } from './write/bullets'
import { runReview } from './write/review'
import { runWrite, WriteStageError } from './write/run-write'

/** What a caller may ask for (the route's body, schema.ts StartCvGenerationBodySchema). */
export type RunOptions = {
  /** Force a new Brief and Select instead of reusing the stored ones. */
  fresh?: boolean
  /** false skips the Review call: the CV lands unreviewed. Default true. */
  review?: boolean
}

export type StartCvGenerationResult =
  | { kind: 'started'; runId: string }
  /** A run of this job is already active; its id. */
  | { kind: 'existing'; runId: string }
  /** The profile already has the maximum number of active runs. */
  | { kind: 'limit' }
  | { kind: 'not_found' }
  /** The job's CV document already has a draft waiting: nothing was started and nothing was spent. */
  | { kind: 'draft_exists'; documentId: string }

/**
 * Admits and starts a run of `jobId`. The pipeline runs in after(), so the
 * caller returns at once (202 + runId). A missing key or description is not
 * refused here: the run starts and ends failed (no_llm_key / no_description),
 * so the log page shows why. A pending draft on the target document IS refused
 * here, before any run exists or any model is called.
 */
export async function startCvGeneration(
  profileId: string,
  jobId: string,
  opts: RunOptions = {},
): Promise<StartCvGenerationResult> {
  // An already running run of this job is answered first (a second click is not a conflict); no run is created and nothing is spent here.
  const active = await findActiveCvGeneration(profileId, jobId)
  if (active) return { kind: 'existing', runId: active }
  const landing = await checkLandingTarget(profileId, jobId)
  if (landing.kind === 'draft_exists') return landing
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
export async function runCvGenerationStages(runId: string, profileId: string, opts: RunOptions = {}): Promise<void> {
  const entries: StageLogEntry[] = []
  const timings: Partial<Record<CvGenerationStage, number>> = {}
  let stage: CvGenerationStage = 'gather'
  let stageStart = Date.now()
  const runStart = Date.now()
  const deadline = runStart + TIME_BUDGET_MS.run
  const wantReview = opts.review !== false

  // New runs are never partial (a preview run is only something an older run can be).
  // The reuse key and origin are set once Gather has ended: they are what a later run compares to reuse this run's brief and selection.
  let reuseKey: string | undefined
  let reuseOrigin: { runId: string; at: string } | undefined
  const log = () => ({ entries, partial: false, ...(reuseKey ? { reuseKey } : {}), ...(reuseOrigin ? { reuseOrigin } : {}) })
  const begin = (s: CvGenerationStage) => { stage = s; stageStart = Date.now() }
  const end = (entry: Omit<StageLogEntry, 'stage' | 'startedAt' | 'durationMs'>) => {
    const durationMs = Date.now() - stageStart
    timings[stage] = durationMs
    entries.push({ stage, startedAt: new Date(stageStart).toISOString(), durationMs, ...entry })
  }
  /** Data kept on a failed row so nothing generated is lost (set once the CV exists). */
  let keep: NonNullable<Parameters<typeof failRun>[4]>['data'] = {}
  const fail = async (kind: CvGenerationFailureKind, notes: string[] = [], sections: StageLogEntry['sections'] = [], spent?: CallUsage) => {
    timings[stage] = Date.now() - stageStart
    entries.push({
      stage, status: 'failed', model: null, startedAt: new Date(stageStart).toISOString(), durationMs: timings[stage] ?? null,
      tokens: { input: spent?.input ?? 0, output: spent?.output ?? 0 }, costUsd: spent && spent.calls > 0 ? spent.costUsd : null,
      notes: [FAILURE_MESSAGES[kind], ...notes], kept: [], dropped: [], retries: 0, retryReasons: [], flaggedClaims: [], sections,
    })
    await failRun(profileId, runId, kind, null, { stageTimings: timings, log: log(), data: keep })
  }
  const noUsage = { tokens: { input: 0, output: 0 }, costUsd: null } as const

  try {
    const row = await prisma.cvGeneration.findFirst({ where: { id: runId, profileId }, select: { jobApplicationId: true } })
    if (!row) return
    const jobId = row.jobApplicationId

    // 0. Gather
    if (!(await setStatus(profileId, runId, 'gathering', { startedAt: new Date() }))) return
    begin('gather')
    if (!(await getLLMConfigStatus(profileId)).configured) return await fail('no_llm_key')
    // Before any spend: a job already at its document limit with no CV document to reuse cannot land.
    const landing = await checkLandingTarget(profileId, jobId)
    if (landing.kind === 'limit') return await fail('document_limit')
    // The desk document the draft will go to, when it already exists: the calls below carry it in their usage attribution.
    const writingDeskDocumentId = landing.kind === 'ok' ? landing.documentId : null
    const g = await gatherCvInputs(profileId, jobId, { runId })
    if (!g.ok) return await fail(g.kind === 'no_description' ? 'no_description' : 'error', g.kind === 'not_found' ? [g.message] : [])
    const c = g.candidates
    const activityCount = c.employers.reduce((n, e) => n + e.activities.length, 0)
    const roleCount = c.employers.reduce((n, e) => n + e.roles.length, 0)
    const analysisUsage = g.strategy.source === 'analysed' || g.strategy.source === 'none'
      ? await featureUsage(profileId, runId, CV_GENERATION_FEATURES.analyse)
      : { ...noUsage }
    reuseKey = await computeReuseKey(profileId, g.inputsHash)
    const reuse = opts.fresh ? null : await findReusableSelection(profileId, jobId, { inputsHash: g.inputsHash, reuseKey })
    // The run that made the brief and selection this run holds (itself, unless it reuses): the reuse window runs from there.
    reuseOrigin = reuse ? { runId: reuse.runId, at: reuse.at.toISOString() } : { runId, at: new Date(runStart).toISOString() }
    end({
      status: 'ok', model: null, ...analysisUsage,
      notes: [
        ...g.notes,
        `Profile: ${countOf(roleCount, 'role')} at ${countOf(c.employers.length, 'employer')} with ${countOf(activityCount, 'activity', 'activities')}; ${countOf(c.skills.length, 'skill')}, ${countOf(c.tools.length, 'tool')}, ${countOf(c.competencies.length, 'competency', 'competencies')}, ${countOf(c.certifications.length, 'certification')}, ${c.education.length} education, ${countOf(c.projects.length, 'project')}.`,
        ...(opts.fresh ? ['A fresh brief and selection were requested, so none are reused.'] : []),
      ],
      kept: [], dropped: [], retries: 0, retryReasons: [], flaggedClaims: [], sections: [],
    })

    // 1. Brief (or the stored one)
    if (!(await setStatus(profileId, runId, 'briefing', {
      inputsHash: g.inputsHash, deepDiveId: g.deepDiveId, stageTimings: json(timings), log: json(log()),
    }))) return
    begin('brief')
    let briefValue: CvBrief
    if (reuse) {
      briefValue = reuse.brief
      end({ status: 'skipped', model: null, ...noUsage, notes: [reuseNote(reuse.at)], kept: [], dropped: [], retries: 0, retryReasons: [], flaggedClaims: [], sections: [] })
    } else {
      const brief = await runBrief(g, { profileId, jobApplicationId: jobId, runId, deadline, writingDeskDocumentId })
      briefValue = brief.value
      end({
        status: 'ok', model: brief.model, ...(await stageUsage(profileId, runId, CV_GENERATION_FEATURES.brief, brief.usage)),
        notes: [], kept: [], dropped: [], retries: brief.retries, retryReasons: brief.retryReasons ?? [], flaggedClaims: [], sections: [],
      })
    }

    // 2. Select (or the stored one)
    if (!(await setStatus(profileId, runId, 'selecting', {
      brief: json(briefValue), selectionReusedFromRunId: reuse?.runId ?? null, stageTimings: json(timings), log: json(log()),
    }))) return
    begin('select')
    let selection: CvSelection
    if (reuse) {
      selection = reuse.selection
      end({ status: 'skipped', model: null, ...noUsage, notes: [reuseNote(reuse.at)], kept: [], dropped: [], retries: 0, retryReasons: [], flaggedClaims: [], sections: [] })
    } else {
      const picked = await runSelect(g, briefValue, { profileId, jobApplicationId: jobId, runId, deadline, writingDeskDocumentId })
      selection = picked.selection
      const lines = selectionLogLines(picked.selection)
      end({
        status: 'ok', model: picked.model, ...(await stageUsage(profileId, runId, CV_GENERATION_FEATURES.select, picked.usage)),
        notes: [
          ...picked.notes,
          ...(lines.notSelected > 0 ? [`${lines.notSelected === 1 ? '1 other profile item was' : `${lines.notSelected} other profile items were`} not selected.`] : []),
        ],
        kept: lines.kept, dropped: lines.dropped, retries: picked.retries, retryReasons: picked.retryReasons ?? [], flaggedClaims: [], sections: [],
      })
    }

    // 3. Write. The selection is stored as the stage starts, so the page shows
    // what is being written from.
    if (!(await setStatus(profileId, runId, 'writing', {
      selection: json(selection), stageTimings: json(timings), log: json(log()),
    }))) return
    begin('write')
    const vault = await loadVault(profileId)
    const written = await runWrite(vault, briefValue, selection, g.strategy, { profileId, jobApplicationId: jobId, runId, deadline, writingDeskDocumentId })
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
      retryReasons: [],
      flaggedClaims: [],
      sections: written.sections.map((s) => s.log),
    })

    // 4. Assemble: code only.
    if (!(await setStatus(profileId, runId, 'assembling', { stageTimings: json(timings), log: json(log()) }))) return
    begin('assemble')
    const snapshot = toProfileSnapshot(vault)
    const assembled = assembleCv({
      name: vault.identity.props.name,
      headline: written.headline,
      headerFacts: headerFacts(vault, new Date()),
      sections: written.sections,
      employerOrder: employerOrderOf(selection),
      checkNotes: written.checkNotes,
      snapshot,
    })
    if (!assembled.ok) return await fail('invalid_output', ['The assembled CV has invalid blocks.', ...assembled.issues])
    const cv = assembled.assembled
    keep = { assembled: json(cv) } // from here on a failure keeps the CV on the row
    const tooLong = lengthNote(cv.markdown)
    end({
      status: 'ok', model: null, tokens: { input: 0, output: 0 }, costUsd: null,
      notes: [
        `Assembled ${countOf(cv.sections.length, 'section')} (about ${bodyWordCount(cv.markdown)} words) in the default CV structure, with the contact placeholder in the header.`,
        ...(cv.warnings.length > 0 ? [`${countOf(cv.warnings.length, 'warning')} from the block and fact checks (see below).`] : ['No warnings from the block and fact checks.']),
        ...cv.checkNotes.map((n) => `${CHECK_NOTE_PREFIX}${n}`),
        ...(tooLong ? [tooLong] : []),
        `The whole run took ${seconds(Date.now() - runStart)} of its ${seconds(TIME_BUDGET_MS.run)} budget.`,
      ],
      kept: [], dropped: [], retries: 0, retryReasons: [], flaggedClaims: [], sections: [],
    })

    // 5. Review: one call that may edit the CV (after code re-checks) and lists concerns for the coach. Never fails the run.
    if (!(await setStatus(profileId, runId, 'reviewing', { assembled: json(cv), stageTimings: json(timings), log: json(log()) }))) return
    begin('review')
    let finalCv = cv
    let review: CvReview
    const reviewEvidence = evidenceFromVault(vault, selection)
    if (!wantReview) {
      const reason = 'The review was turned off for this run, so the CV lands unreviewed.'
      review = withThinProjectConcerns({ skipped: true, skipReason: reason, model: null, tokens: { input: 0, output: 0 }, costUsd: null, applied: [], discarded: [], concerns: [] }, reviewEvidence, briefValue)
      end({ status: 'skipped', model: null, ...noUsage, notes: [reason], kept: [], dropped: [], retries: 0, retryReasons: [], flaggedClaims: [], sections: [] })
    } else {
      const outcome = await runReview(
        {
          assembled: cv, selection, brief: briefValue, strategy: g.strategy, evidence: reviewEvidence,
          yearsOfExperience: statedYears(notesOf(vault, 'experience').map((e) => e.props.startDate), new Date()),
          validate: (markdown) => recheckMarkdown(markdown, snapshot).errors,
        },
        { profileId, jobApplicationId: jobId, runId, writingDeskDocumentId, deadline: deadline - LAND_RESERVE_MS },
      )
      // A lead-with project with no text gets a coach concern in code, whether or not the reviewer raised it (or ran at all).
      review = withThinProjectConcerns(outcome.review, reviewEvidence, briefValue)
      if (outcome.assembled !== cv) {
        // Edits were applied: the warnings are those of the edited text.
        const checked = recheckMarkdown(outcome.assembled.markdown, snapshot)
        finalCv = { ...outcome.assembled, warnings: checked.warnings }
      }
      const r = review
      end({
        status: r.skipped ? 'skipped' : 'ok', model: r.model, tokens: r.tokens, costUsd: r.costUsd,
        notes: r.skipped
          ? outcome.notes
          : [
              `Applied ${countOf(r.applied.length, 'edit')}, discarded ${r.discarded.length}; ${countOf(r.concerns.length, 'concern')} for the coach.`,
              ...r.applied.map((a) => `Applied: ${a.action} ${a.sectionId}${a.bulletId ? ` ${a.bulletId}` : ''}: “${shortened(a.before, 60)}”${a.after ? ` → “${shortened(a.after, 60)}”` : ''} (${a.reason || 'no reason given'}).${a.note ? ` ${a.note}` : ''}`),
              ...r.discarded.map((d) => `Discarded: ${d.action} ${d.sectionId}${d.bulletId ? ` ${d.bulletId}` : ''}: ${d.why}.`),
              ...outcome.notes,
            ],
        kept: [], dropped: [], retries: 0, retryReasons: [], flaggedClaims: [], sections: [],
      })
    }
    keep = { assembled: json(finalCv), review: json(review) }

    // 6. Land: a draft in the job's CV document. Nothing live is overwritten.
    if (!(await setStatus(profileId, runId, 'landing', { assembled: json(finalCv), review: json(review), stageTimings: json(timings), log: json(log()) }))) return
    begin('land')
    const landed = await landCv(profileId, { id: jobId, company: g.job.company, title: g.job.title }, finalCv.markdown, {
      isActive: () => isRunActive(profileId, runId),
      // false = the row can no longer be written (the run is stale or was killed): Land stops before it writes a draft.
      onTarget: async (documentId) => {
        const wrote = await updateActive(profileId, runId, { writingDeskDocumentId: documentId })
        if (wrote) keep = { ...keep, writingDeskDocumentId: documentId }
        return wrote
      },
    })
    if (landed.kind === 'aborted') {
      // Nothing can be written to a dead run's row, so there is nothing to fail: say so in the server log and stop.
      console.warn('[cv-generation] the run is no longer active; the draft was not written', { runId, documentId: landed.documentId })
      return
    }
    if (landed.kind !== 'landed') {
      if (landed.kind === 'draft_exists') return await fail('draft_exists', ['A draft appeared in the document while the CV was being generated. The generated CV is kept on this run (see below); nothing was written to the document.'])
      if (landed.kind === 'limit') return await fail('document_limit')
      return await fail('error', [landed.message])
    }
    end({
      status: 'ok', model: null, ...noUsage,
      notes: [`${landed.created ? 'Created a new CV document' : 'Reused the CV document from the earlier run'} and saved the CV as a draft in it, for you to accept or discard. {{contact}} is filled in when you accept.`],
      kept: [], dropped: [], retries: 0, retryReasons: [], flaggedClaims: [], sections: [],
    })
    await updateActive(profileId, runId, {
      status: 'complete',
      writingDeskDocumentId: landed.documentId,
      assembled: json(finalCv),
      review: json(review),
      completedAt: new Date(),
      stageTimings: json(timings),
      log: json(log()),
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
