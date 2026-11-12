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
 * `jobAnalysis` from a report. `facts` is the early assessment's stored facts
 * (null when the run had none): its must and nice requirements come first.
 * Without facts, must-haves come from the report's blockers and gaps.
 */
export function reportToJobAnalysis(report: DeepDiveReport, facts: unknown): JobAnalysis {
  const requirements = factRequirements(facts)
  const openBlockers = report.blockers.filter((b) => b.status !== 'cleared')

  const mustHave = unique([
    ...requirements.filter((r) => r.importance === 'must').map((r) => r.text),
    ...openBlockers.map((b) => b.label),
    ...report.gaps.map((g) => g.requirement),
  ]).slice(0, JOB_ANALYSIS_CAPS.mustHave)

  const niceToHave = unique(requirements.filter((r) => r.importance === 'nice').map((r) => r.text))
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
