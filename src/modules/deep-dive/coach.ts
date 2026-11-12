/**
 * The deep dive as the career coach reads it (chat tool `get_deep_dive`):
 * the job's newest complete report as Markdown, the same text as Copy as
 * Markdown, plus whether it is still current.
 */

import { prisma } from '@/lib/db'
import { getDeepDive, listDeepDiveRuns } from './queries'
import { reportToMarkdown } from './report-text'
import { ACTIVE_STATUSES, type DeepDiveStatus } from './schema'

const isActiveStatus = (s: DeepDiveStatus) => (ACTIVE_STATUSES as readonly DeepDiveStatus[]).includes(s)

export type CoachDeepDive =
  | { found: false; reason: 'no_job' | 'no_report'; inProgress: boolean; message: string }
  | {
      found: true
      runId: string
      runDate: string
      verdict: string
      /** The profile, search profile, job or early assessment changed since the run; null when not checked. */
      outOfDate: boolean | null
      /** A newer run is still going. */
      newerRunInProgress: boolean
      reportPage: string
      markdown: string
    }

/** Null-safe read for one of the profile's jobs. Never throws for a missing report. */
export async function getDeepDiveForCoach(profileId: string, jobId: string): Promise<CoachDeepDive> {
  const job = await prisma.jobApplication.findFirst({
    where: { id: jobId, profileId },
    select: { id: true, title: true, company: true, url: true },
  })
  if (!job) return { found: false, reason: 'no_job', inProgress: false, message: 'Job not found.' }

  const runs = await listDeepDiveRuns(profileId, jobId)
  const inProgress = runs.length > 0 && isActiveStatus(runs[0].status)
  const latestComplete = runs.find((r) => r.status === 'complete')
  if (!latestComplete) {
    return {
      found: false,
      reason: 'no_report',
      inProgress,
      message: inProgress
        ? 'A deep dive is running for this job; the report should be ready in a couple of minutes.'
        : 'This job has no deep dive yet. The user can start one from the job page (Deep dive).',
    }
  }

  // Reading the newest run without a runId also checks whether it is out of date.
  const view = await getDeepDive(profileId, jobId, latestComplete.id === runs[0].id ? null : latestComplete.id)
  if (!view?.report) {
    return { found: false, reason: 'no_report', inProgress, message: "The latest deep dive report can't be read." }
  }

  const models = [...new Set([view.researchModel, view.synthesisModel].filter((m): m is string => !!m))]
  return {
    found: true,
    runId: view.id,
    runDate: view.createdAt.toISOString().slice(0, 10),
    verdict: view.report.verdict,
    outOfDate: view.outOfDate,
    newerRunInProgress: inProgress,
    reportPage: `/dashboard/job-applications/view/${jobId}/deep-dive`,
    markdown: reportToMarkdown(view.report, view.research, {
      jobTitle: job.title,
      company: job.company,
      jobUrl: job.url,
      createdAt: view.createdAt,
      models,
    }),
  }
}
