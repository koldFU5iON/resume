/**
 * Gather (no model call): what every cover letter stage reads.
 *
 * - The job and its description (capped).
 * - Company facts: the newest COMPLETE deep dive's company summary and
 *   signals, and its practicalities (location, right to work). These and the
 *   job description are the only sources a "why them" fact may come from.
 * - Strategy: the deep dive's (strengths, gaps, positioning), else the job's
 *   jobAnalysis. Unlike CV generation there is no analyseJob fallback: the
 *   letter can be written from the description alone, so Gather never spends.
 * - The profile as model text (contact details scrubbed) and the candidate's
 *   name (for the header and sign-off; the contact line is {{contact}}).
 * - The job's writing desk CV (newest CV document with content), so the
 *   letter tells stories around it instead of repeating it.
 *
 * Every query filters by profileId.
 */

import { prisma } from '@/lib/db'
import { parseReport } from '@/modules/deep-dive/queries'
import { DESCRIPTION_MAX_CHARS } from '@/modules/job-assessment/schema'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { emptyStrategy, strategyFromAnalysis, strategyFromReport, strategyToPrompt, type Strategy } from '@/modules/cv-generation/strategy'

/** The job's CV as context, at most this many characters. */
const CV_CONTEXT_MAX_CHARS = 8_000

export type Gathered = {
  job: { id: string; title: string; company: string | null; description: string }
  candidateName: string
  profileText: string
  strategy: Strategy
  /** Company summary and signals from the deep dive, one per line; empty without a deep dive. */
  companyFacts: string[]
  /** Location and right-to-work lines from the deep dive, for the close; empty without one. */
  practicalities: string[]
  deepDiveId: string | null
  /** The job's writing desk CV (Markdown), or null. */
  cvMarkdown: string | null
  notes: string[]
}

export type GatherResult = { ok: true; value: Gathered } | { ok: false; kind: 'not_found' | 'no_description' }

export async function gatherCoverLetterInputs(profileId: string, jobId: string): Promise<GatherResult> {
  const job = await prisma.jobApplication.findFirst({
    where: { id: jobId, profileId },
    select: { id: true, title: true, company: true, jobDescription: true, jobAnalysis: true },
  })
  if (!job) return { ok: false, kind: 'not_found' }
  const description = job.jobDescription?.trim().slice(0, DESCRIPTION_MAX_CHARS) ?? ''
  if (!description) return { ok: false, kind: 'no_description' }

  const [snapshot, deepDive, cv] = await Promise.all([
    buildProfileSnapshot(profileId),
    prisma.jobDeepDive.findFirst({
      where: { profileId, jobApplicationId: jobId, status: 'complete' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, report: true },
    }),
    prisma.writingDeskDocument.findFirst({
      where: { profileId, jobApplicationId: jobId, documentType: 'cv', NOT: { content: '' } },
      orderBy: { updatedAt: 'desc' },
      select: { content: true },
    }),
  ])

  const notes: string[] = []
  const report = deepDive ? parseReport(deepDive.report) : null
  let strategy: Strategy
  let companyFacts: string[] = []
  let practicalities: string[] = []
  if (report) {
    strategy = strategyFromReport(report)
    companyFacts = [report.company.summary, ...report.company.signals.map((s) => s.label)].filter((s) => s.trim())
    practicalities = [report.practicalities.location.summary, report.practicalities.sponsorship.summary].filter((s) => s.trim())
    notes.push('Company facts and strategy from the newest complete deep dive.')
  } else {
    strategy = strategyFromAnalysis(job.jobAnalysis, 'job-analysis') ?? emptyStrategy('none')
    notes.push(strategy.source === 'job-analysis'
      ? 'No complete deep dive: strategy from the job analysis; company facts come from the job description only.'
      : 'No deep dive or job analysis: the letter is written from the job description and your profile.')
  }
  const cvMarkdown = cv?.content.trim() ? cv.content.trim().slice(0, CV_CONTEXT_MAX_CHARS) : null
  notes.push(cvMarkdown ? "Read the job's writing desk CV, so the letter doesn't repeat it." : 'This job has no writing desk CV yet; the letter reads your profile only.')

  return {
    ok: true,
    value: {
      job: { id: job.id, title: job.title, company: job.company, description },
      candidateName: snapshot.name?.trim() || 'Candidate',
      profileText: serializeProfileForLLM(snapshot),
      strategy,
      companyFacts,
      practicalities,
      deepDiveId: report && deepDive ? deepDive.id : null,
      cvMarkdown,
      notes,
    },
  }
}

/** The shared context block every stage's prompt starts with. */
export function contextPrompt(g: Gathered): string {
  const list = (items: string[]) => (items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : '(none)')
  return [
    `# Job\n\n**${g.job.title}**${g.job.company ? ` at ${g.job.company}` : ''}\n\n<job_description>\n${g.job.description}\n</job_description>`,
    `# Company facts (from research)\n\n${list(g.companyFacts)}`,
    `# Strategy\n\n${strategyToPrompt(g.strategy)}`,
    `# Candidate profile\n\n${g.profileText}`,
    g.cvMarkdown ? `# The CV going with this letter (don't repeat it)\n\n<cv>\n${g.cvMarkdown}\n</cv>` : '',
  ].filter(Boolean).join('\n\n')
}
