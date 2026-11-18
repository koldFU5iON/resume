/**
 * The strategy the Brief starts from, in one shape whichever source supplied
 * it (docs/cv-generation.md decision 2): the newest complete deep dive's
 * `cvStrategy`, else `JobApplication.jobAnalysis` (written from the early
 * Jev assessment), else a fresh `analyseJob`. Pure: no DB, no network.
 */

import { JobAnalysisSchema, type JobAnalysis } from '@/modules/jobs/schema'
import type { DeepDiveReport } from '@/modules/deep-dive/schema'
import type { StrategySource } from './schema'

export type Strategy = {
  source: StrategySource
  leadWith: string[]
  emphasise: Array<{ item: string; why: string }>
  playDown: string[]
  positioning: string | null
  mustHave: string[]
  niceToHave: string[]
  /** Hiring risks (jobAnalysis) or gaps (deep dive), one line each. */
  risks: string[]
  /** Deep dive strengths, one line each. */
  strengths: string[]
}

export function emptyStrategy(source: StrategySource): Strategy {
  return { source, leadWith: [], emphasise: [], playDown: [], positioning: null, mustHave: [], niceToHave: [], risks: [], strengths: [] }
}

/** From a complete deep dive report (`cvStrategy`, gaps, strengths). */
export function strategyFromReport(report: DeepDiveReport): Strategy {
  return {
    ...emptyStrategy('deep-dive'),
    leadWith: report.cvStrategy.leadWith,
    emphasise: report.cvStrategy.emphasise,
    playDown: report.cvStrategy.playDown,
    positioning: report.cvStrategy.positioning || null,
    risks: report.gaps.map((g) => `${g.requirement} (${g.closability.replace(/_/g, ' ')}): ${g.action}`),
    strengths: report.strengths.map((s) => s.point),
  }
}

/** From `jobAnalysis`, or null when the stored value is missing or unreadable. */
export function strategyFromAnalysis(value: unknown, source: 'job-analysis' | 'analysed'): Strategy | null {
  const parsed = JobAnalysisSchema.safeParse(value)
  return parsed.success ? fromJobAnalysis(parsed.data, source) : null
}

export function fromJobAnalysis(a: JobAnalysis, source: 'job-analysis' | 'analysed'): Strategy {
  return {
    ...emptyStrategy(source),
    positioning: a.positioningStrategy || null,
    mustHave: a.mustHave,
    niceToHave: a.niceToHave,
    risks: a.risks.map((r) => `[${r.severity}] ${r.risk} → ${r.recommendation}`),
  }
}

const SOURCE_NOTE: Record<StrategySource, string> = {
  'deep-dive': 'Strategy from the newest complete deep dive.',
  'job-analysis': 'No complete deep dive: strategy from the job analysis (early assessment).',
  analysed: 'No deep dive or job analysis: the job was analysed now.',
  none: 'No deep dive or job analysis, and analysing the job failed: the brief is written from the job description alone.',
}

export function sourceNote(source: StrategySource): string {
  return SOURCE_NOTE[source]
}

const list = (items: readonly string[]) => (items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : '(none)')

/** The strategy as text for the Brief prompt. */
export function strategyToPrompt(s: Strategy): string {
  const lines = [`Source: ${s.source}`]
  if (s.positioning) lines.push(`Positioning: ${s.positioning}`)
  if (s.leadWith.length > 0) lines.push(`Lead with:\n${list(s.leadWith)}`)
  if (s.emphasise.length > 0) lines.push(`Emphasise:\n${list(s.emphasise.map((e) => `${e.item}: ${e.why}`))}`)
  if (s.playDown.length > 0) lines.push(`Play down:\n${list(s.playDown)}`)
  if (s.mustHave.length > 0) lines.push(`Must-have requirements:\n${list(s.mustHave)}`)
  if (s.niceToHave.length > 0) lines.push(`Nice-to-have:\n${list(s.niceToHave)}`)
  if (s.risks.length > 0) lines.push(`${s.source === 'deep-dive' ? 'Gaps' : 'Hiring risks'}:\n${list(s.risks)}`)
  if (s.strengths.length > 0) lines.push(`Strengths:\n${list(s.strengths)}`)
  return lines.length === 1 ? `${lines[0]}\n(no strategy available)` : lines.join('\n\n')
}
