/**
 * Stage 0, Gather (docs/cv-generation.md). No model call of its own: it loads
 * the profile (contact details left out), the job and the strategy input.
 *
 * Strategy precedence: the newest COMPLETE deep dive's report, else
 * `JobApplication.jobAnalysis` (written from the early Jev assessment), else
 * the existing `analyseJob` as a last resort (the one place Gather can spend
 * a call; it is logged under its own tag, cv-job-analysis, and raced against
 * TIME_BUDGET_MS.analyse so a hang cannot hold the run). A deep dive that is
 * out of date for the job (its inputsHash no longer matches what a run would
 * get now) is noted in the log, and a job analysis written after it wins.
 * The master CV and career vertical are never read.
 *
 * Every selectable item carries its database id (candidates.ts) so Select can
 * only return real ones. Every query filters by profileId.
 */

import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { analyseJob } from '@/modules/cv/analyse-job'
import type { JobAnalysis } from '@/modules/jobs/schema'
import { currentInputsHash } from '@/modules/deep-dive/gather'
import { parseReport } from '@/modules/deep-dive/queries'
import { DESCRIPTION_MAX_CHARS } from '@/modules/job-assessment/schema'
import { loadVault } from '@/modules/profile-map/load'
import { serializeProfileForLLM, toProfileSnapshot } from '@/modules/profile/snapshot'
import { buildCandidates, profileOutline, type Candidates } from './candidates'
import { TIME_BUDGET_MS } from './schema'
import { emptyStrategy, fromJobAnalysis, sourceNote, strategyFromAnalysis, strategyFromReport, type Strategy } from './strategy'

export type GatherResult =
  | {
      ok: true
      job: { id: string; title: string; company: string | null; description: string }
      candidates: Candidates
      /** Titles and names only; what the Brief reads of the profile. */
      outline: string
      strategy: Strategy
      /** The deep dive whose strategy was used; null for the other sources. */
      deepDiveId: string | null
      inputsHash: string
      notes: string[]
    }
  | { ok: false; kind: 'not_found' | 'no_description'; message: string }

/** sha256 of what shapes the run: profile text, job description, strategy and where it came from. */
export function computeInputsHash(parts: {
  profileText: string
  jobDescription: string
  strategy: Strategy
  deepDiveId: string | null
}): string {
  return createHash('sha256')
    .update(JSON.stringify([parts.profileText, parts.jobDescription, parts.strategy, parts.deepDiveId]))
    .digest('hex')
}

type DeepDiveInput = { id: string; strategy: Strategy; inputsHash: string | null; at: Date }

/** The newest complete deep dive of the job and its strategy, or null (none, or its report is unreadable). */
async function deepDiveStrategy(profileId: string, jobId: string): Promise<DeepDiveInput | null> {
  const row = await prisma.jobDeepDive.findFirst({
    where: { profileId, jobApplicationId: jobId, status: 'complete' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, report: true, inputsHash: true, createdAt: true, completedAt: true },
  })
  const report = row ? parseReport(row.report) : null
  return row && report
    ? { id: row.id, strategy: strategyFromReport(report), inputsHash: row.inputsHash ?? null, at: row.completedAt ?? row.createdAt }
    : null
}

/** True only when the deep dive's inputs hash is known to differ from the current one; unknown is not "out of date". */
async function isDeepDiveOutOfDate(profileId: string, jobId: string, dd: DeepDiveInput): Promise<boolean> {
  if (!dd.inputsHash) return false
  try {
    const current = await currentInputsHash(profileId, jobId)
    return current !== null && current !== dd.inputsHash
  } catch (err) {
    console.error('[cv-generation] could not check whether the deep dive is out of date', { jobId, err })
    return false
  }
}

/** `analyseJob` raced against a deadline; null on failure or timeout. */
async function analyseWithDeadline(
  profileId: string,
  jobId: string,
  runId: string,
): Promise<{ analysis: JobAnalysis | null; timedOut: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), TIME_BUDGET_MS.analyse)
  })
  try {
    const won = await Promise.race([analyseJob(profileId, jobId, { runId }).catch(() => null), timeout])
    return won === 'timeout' ? { analysis: null, timedOut: true } : { analysis: won, timedOut: false }
  } finally {
    clearTimeout(timer)
  }
}

export async function gatherCvInputs(profileId: string, jobId: string, ctx: { runId: string }): Promise<GatherResult> {
  const job = await prisma.jobApplication.findFirst({
    where: { id: jobId, profileId },
    select: { id: true, title: true, company: true, jobDescription: true, jobAnalysis: true, jobAnalysedAt: true },
  })
  if (!job) return { ok: false, kind: 'not_found', message: 'Job not found.' }
  const description = job.jobDescription?.trim().slice(0, DESCRIPTION_MAX_CHARS) ?? ''
  if (!description) return { ok: false, kind: 'no_description', message: 'The job has no description to write a CV for.' }

  const vault = await loadVault(profileId)
  const snapshot = toProfileSnapshot(vault)
  const profileText = serializeProfileForLLM(snapshot)
  const candidates = buildCandidates(vault)

  const notes: string[] = []
  let strategy: Strategy | null = null
  let deepDiveId: string | null = null

  let sourceLine: string | null = null
  let switched = false
  const dd = await deepDiveStrategy(profileId, jobId)
  if (dd) {
    strategy = dd.strategy
    deepDiveId = dd.id
    if (await isDeepDiveOutOfDate(profileId, jobId, dd)) {
      notes.push('The deep dive is out of date for this job: the profile, the job or the assessment changed since it ran.')
      const analysis = strategyFromAnalysis(job.jobAnalysis, 'job-analysis')
      if (analysis && job.jobAnalysedAt && job.jobAnalysedAt > dd.at) {
        strategy = analysis
        deepDiveId = null
        switched = true
        sourceLine = 'Used the job analysis instead of the out-of-date deep dive: it is newer.'
      } else {
        sourceLine = 'Used the out-of-date deep dive anyway: there is no newer job analysis.'
      }
    }
  } else {
    strategy = strategyFromAnalysis(job.jobAnalysis, 'job-analysis')
  }
  // A deep dive's cvStrategy carries no must-have / nice-to-have lists. The job's
  // requirements still matter (Select picks against them; the writers allow a
  // claimed tool in a bullet only when they name it), so take them from the job
  // analysis when there is one.
  if (strategy && strategy.source === 'deep-dive' && strategy.mustHave.length === 0 && strategy.niceToHave.length === 0) {
    const req = strategyFromAnalysis(job.jobAnalysis, 'job-analysis')
    if (req) strategy = { ...strategy, mustHave: req.mustHave, niceToHave: req.niceToHave }
  }
  if (!strategy) {
    // Last resort: analyseJob logs its own usage row (cv-job-analysis) against this run and saves jobAnalysis.
    const { analysis, timedOut } = await analyseWithDeadline(profileId, jobId, ctx.runId)
    strategy = analysis ? fromJobAnalysis(analysis, 'analysed') : emptyStrategy('none')
    if (timedOut) sourceLine = `Analysing the job took longer than ${TIME_BUDGET_MS.analyse / 1000} s and was given up on.`
  }
  if (!switched) notes.push(sourceNote(strategy.source))
  if (sourceLine) notes.push(sourceLine)

  return {
    ok: true,
    job: { id: job.id, title: job.title, company: job.company, description },
    candidates,
    outline: profileOutline(snapshot.headline, candidates),
    strategy,
    deepDiveId,
    inputsHash: computeInputsHash({ profileText, jobDescription: description, strategy, deepDiveId }),
    notes,
  }
}
