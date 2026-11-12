/**
 * The deep dive's `JobApplication.jobAnalysis` (spec §7): built from a
 * complete report so CV generation, cover letters, the writing guide and
 * career-vertical reuse it without another LLM call.
 *
 * Pure module: no DB, no network.
 */

import type { JobAnalysis, JobAnalysisRisk } from '@/modules/jobs/schema'
import type { DeepDiveReport } from './schema'

/** List caps, the same as the JobAnalysisSchema descriptions (#362). */
export const JOB_ANALYSIS_CAPS = { mustHave: 10, niceToHave: 8, risks: 6 } as const

type FactsRequirement = { text: string; importance: 'must' | 'nice' }

/** Requirements from the early assessment's stored facts; unreadable entries are dropped. */
function factRequirements(facts: unknown): FactsRequirement[] {
  const list = (facts as { requirements?: unknown } | null)?.requirements
  if (!Array.isArray(list)) return []
  return list.flatMap((r) => {
    const text = typeof r?.text === 'string' ? r.text.trim() : ''
    const importance = r?.importance
    return text && (importance === 'must' || importance === 'nice') ? [{ text, importance }] : []
  })
}

/** Case-insensitive de-duplication, keeping the first spelling and the order. */
function unique(items: string[]): string[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const SEVERITY_ORDER: Record<JobAnalysisRisk['severity'], number> = { high: 0, medium: 1, low: 2 }

/**
 * `jobAnalysis` from a report, or null when there is nothing to base the
 * job's requirements on.
 *
 * The report says what the candidate lacks (blockers, gaps), not everything
 * the job requires, so the requirement lists come from elsewhere: the early
 * assessment's stored `facts` (must / nice requirements), else the job's
 * `existing` jobAnalysis (an earlier analyseJob run). With neither, it returns
 * null and the caller keeps what's there, so CV generation still runs
 * analyseJob for the full requirements instead of reading a thin list.
 * Open blockers and gaps are added to must-haves; risks and positioning
 * always come from the report.
 */
export function reportToJobAnalysis(report: DeepDiveReport, facts: unknown, existing: JobAnalysis | null): JobAnalysis | null {
  const requirements = factRequirements(facts)
  const baseMust = requirements.length > 0
    ? requirements.filter((r) => r.importance === 'must').map((r) => r.text)
    : existing?.mustHave ?? []
  const baseNice = requirements.length > 0
    ? requirements.filter((r) => r.importance === 'nice').map((r) => r.text)
    : existing?.niceToHave ?? []
  if (baseMust.length === 0 && baseNice.length === 0) return null

  const openBlockers = report.blockers.filter((b) => b.status !== 'cleared')

  const mustHave = unique([
    ...baseMust,
    ...openBlockers.map((b) => b.label),
    ...report.gaps.map((g) => g.requirement),
  ]).slice(0, JOB_ANALYSIS_CAPS.mustHave)

  const niceToHave = unique(baseNice)
    .filter((n) => !mustHave.some((m) => m.toLowerCase() === n.toLowerCase()))
    .slice(0, JOB_ANALYSIS_CAPS.niceToHave)

  const risks: JobAnalysisRisk[] = [
    ...openBlockers.map((b): JobAnalysisRisk => ({
      risk: b.label,
      severity: b.status === 'hard' ? 'high' : 'medium',
      recommendation: b.status === 'confirm_with_recruiter' ? `Confirm with the recruiter. ${b.reason}` : b.reason,
    })),
    ...report.gaps.map((g): JobAnalysisRisk => ({
      risk: g.requirement,
      severity: g.closability === 'not_closable' ? 'high' : g.closability === 'closable_later' ? 'medium' : 'low',
      recommendation: g.action,
    })),
  ]
    // Stable sort: most serious first, blockers before gaps within a severity.
    .map((r, i) => ({ r, i }))
    .sort((a, b) => SEVERITY_ORDER[a.r.severity] - SEVERITY_ORDER[b.r.severity] || a.i - b.i)
    .map(({ r }) => r)
    .slice(0, JOB_ANALYSIS_CAPS.risks)

  const lead = report.cvStrategy.leadWith.length > 0 ? ` Lead with: ${report.cvStrategy.leadWith.join('; ')}.` : ''
  const playDown = report.cvStrategy.playDown.length > 0 ? ` Play down: ${report.cvStrategy.playDown.join('; ')}.` : ''

  return {
    mustHave,
    niceToHave,
    risks,
    positioningStrategy: `${report.cvStrategy.positioning}${lead}${playDown}`.trim(),
  }
}
