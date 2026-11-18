/**
 * Stage 0, Gather (docs/cv-generation.md). No model call of its own: it loads
 * the profile (contact details left out), the job and the strategy input.
 *
 * Strategy precedence: the newest COMPLETE deep dive's report, else
 * `JobApplication.jobAnalysis` (written from the early Jev assessment), else
 * the existing `analyseJob` as a last resort (the one place Gather can spend
 * a call; it is logged under its own tag, cv-job-analysis). The master CV and
 * career vertical are never read.
 *
 * Every selectable item carries its database id (candidates.ts) so Select can
 * only return real ones. Every query filters by profileId.
 */

import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { analyseJob } from '@/modules/cv/analyse-job'
import { parseReport } from '@/modules/deep-dive/queries'
import { DESCRIPTION_MAX_CHARS } from '@/modules/job-assessment/schema'
import { loadVault } from '@/modules/profile-map/load'
import { serializeProfileForLLM, toProfileSnapshot } from '@/modules/profile/snapshot'
import { buildCandidates, profileOutline, type Candidates } from './candidates'
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

/** The newest complete deep dive of the job and its strategy, or null (none, or its report is unreadable). */
async function deepDiveStrategy(profileId: string, jobId: string): Promise<{ id: string; strategy: Strategy } | null> {
  const row = await prisma.jobDeepDive.findFirst({
    where: { profileId, jobApplicationId: jobId, status: 'complete' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, report: true },
  })
  const report = row ? parseReport(row.report) : null
  return row && report ? { id: row.id, strategy: strategyFromReport(report) } : null
}

export async function gatherCvInputs(profileId: string, jobId: string, ctx: { runId: string }): Promise<GatherResult> {
  const job = await prisma.jobApplication.findFirst({
    where: { id: jobId, profileId },
    select: { id: true, title: true, company: true, jobDescription: true, jobAnalysis: true },
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

  const dd = await deepDiveStrategy(profileId, jobId)
  if (dd) {
    strategy = dd.strategy
    deepDiveId = dd.id
  } else {
    strategy = strategyFromAnalysis(job.jobAnalysis, 'job-analysis')
  }
  if (!strategy) {
    // Last resort: analyseJob logs its own usage row (cv-job-analysis) against this run and saves jobAnalysis.
    const analysed = await analyseJob(profileId, jobId, { runId: ctx.runId })
    strategy = analysed ? fromJobAnalysis(analysed, 'analysed') : emptyStrategy('none')
  }
  notes.push(sourceNote(strategy.source))

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
