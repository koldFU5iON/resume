/**
 * Pure view helpers for the early assessment pill and detail: labels, colour
 * classes, section ordering, filter/sort keys and formatting. No React, no
 * server imports (types only), so they unit-test in node.
 */

import type { AssessmentView } from '@/modules/job-assessment/queries'
import type { AssessmentLevel, AssessmentStatus, Blocker, FailureKind } from '@/modules/job-assessment/schema'

export type EarlyLevelFilter = AssessmentLevel | 'blocked' | 'attention' | 'none'

export const EARLY_LEVEL_LABEL: Record<AssessmentLevel, string> = {
  weak: 'Weak',
  consider: 'Consider',
  pursue: 'Pursue',
  priority: 'Priority',
}

export const EARLY_FILTER_OPTIONS: { value: EarlyLevelFilter; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'pursue', label: 'Pursue' },
  { value: 'consider', label: 'Consider' },
  { value: 'weak', label: 'Weak' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'none', label: 'Not assessed' },
]

const EARLY_FILTER_VALUES = new Set<string>(EARLY_FILTER_OPTIONS.map((o) => o.value))

/** Keeps only known filter keys (for values read back from localStorage). */
export function parseEarlyFilter(values: unknown): Set<EarlyLevelFilter> {
  if (!Array.isArray(values)) return new Set()
  return new Set(values.filter((v): v is EarlyLevelFilter => typeof v === 'string' && EARLY_FILTER_VALUES.has(v)))
}

const IN_PROGRESS: ReadonlySet<AssessmentStatus> = new Set(['queued', 'checking', 'fetching', 'assessing'])

/** A run that hasn't finished yet (queued or in a stage). */
export function isAssessmentInProgress(view: Pick<AssessmentView, 'status'> | null | undefined): boolean {
  return view ? IN_PROGRESS.has(view.status) : false
}

export const IN_PROGRESS_LABEL: Record<'queued' | 'checking' | 'fetching' | 'assessing', string> = {
  queued: 'Queued…',
  checking: 'Checking…',
  fetching: 'Fetching details…',
  assessing: 'Assessing…',
}

/** Which "Early level" filter bucket a job falls in. Runs still in progress count as not assessed. */
export function earlyFilterKey(view: Pick<AssessmentView, 'status' | 'level' | 'blocked'> | null | undefined): EarlyLevelFilter {
  if (!view) return 'none'
  if (view.status === 'failed') return 'attention'
  if (view.status !== 'complete' || !view.level) return 'none'
  return view.blocked ? 'blocked' : view.level
}

/**
 * Sort key for "Early score": unblocked runs by score (1–10); blocked runs
 * below every unblocked one but still ordered by score; everything without a
 * complete result last.
 */
export function earlySortValue(view: Pick<AssessmentView, 'status' | 'score' | 'blocked'> | null | undefined): number {
  if (!view || view.status !== 'complete' || view.score == null) return -1
  return view.blocked ? view.score / 100 : view.score
}

export type EarlyTone = AssessmentLevel | 'blocked'

/** Pill text colour per level; Blocked uses the destructive token. */
export const EARLY_TEXT_STYLES: Record<EarlyTone, string> = {
  weak: 'text-muted-foreground',
  consider: 'text-sky-600 dark:text-sky-400',
  pursue: 'text-emerald-600 dark:text-emerald-400',
  priority: 'text-violet-600 dark:text-violet-400',
  blocked: 'text-destructive',
}

/** Gauge fill per level, matching EARLY_TEXT_STYLES. */
export const EARLY_GAUGE_COLORS: Record<EarlyTone, string> = {
  weak: 'bg-muted-foreground/60',
  consider: 'bg-sky-500',
  pursue: 'bg-emerald-500',
  priority: 'bg-violet-500',
  blocked: 'bg-destructive',
}

export const ATTENTION_TEXT_STYLE = 'text-amber-600 dark:text-amber-400'

export function earlyTone(view: Pick<AssessmentView, 'level' | 'blocked'>): EarlyTone {
  return view.blocked ? 'blocked' : (view.level ?? 'weak')
}

/** Visible pill text for a complete run: "7/10" or "Blocked · 7/10". */
export function earlyPillText(view: Pick<AssessmentView, 'score' | 'blocked'>): string {
  const score = `${view.score ?? '?'}/10`
  return view.blocked ? `Blocked · ${score}` : score
}

/** Heading inside the detail: "Pursue", or "Blocked" when any hard blocker. */
export function earlyHeading(view: Pick<AssessmentView, 'level' | 'blocked'>): string {
  if (view.blocked) return 'Blocked'
  return view.level ? EARLY_LEVEL_LABEL[view.level] : 'Assessed'
}

/** aria-label for the pill trigger, matching JobFit's wording. */
export function earlyAriaLabel(
  view: Pick<AssessmentView, 'status' | 'level' | 'score' | 'blocked'>,
  action: 'Click' | 'Tap' = 'Click',
): string {
  if (view.status === 'failed') return `Early assessment: needs attention. ${action} for details.`
  const level = view.blocked ? 'blocked' : (view.level ?? 'assessed')
  return `Early assessment: ${level}, ${view.score ?? 'no score'} out of 10. ${action} for details.`
}

/** Blockers section: hard first, then unconfirmed (stored order kept within each). */
export function blockerItems(blockers: readonly Blocker[]): Blocker[] {
  return [
    ...blockers.filter((b) => b.severity === 'hard'),
    ...blockers.filter((b) => b.severity === 'unconfirmed'),
  ]
}

/** Years warnings and stretches, shown at the top of Gaps with their breakdown. */
export function yearsGapItems(blockers: readonly Blocker[]): Blocker[] {
  return blockers.filter((b) => b.severity === 'warn' || b.severity === 'stretch')
}

/** Level pursue or priority, and not blocked: worth a deep analysis. */
export function canDeepAnalyse(view: Pick<AssessmentView, 'status' | 'level' | 'blocked'>): boolean {
  return view.status === 'complete' && !view.blocked && (view.level === 'pursue' || view.level === 'priority')
}

/** "4.2s", "850ms", "1m 05s". */
export function formatProcessTime(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

/** Footer line: "jev-1.14.0 · early-v1 · assessed in 4.2s"; missing parts are left out. */
export function footerLine(view: Pick<AssessmentView, 'status' | 'jevModel' | 'pipelineVersion' | 'processTimeMs'>): string {
  const parts: string[] = []
  if (view.jevModel) parts.push(view.jevModel)
  parts.push(view.pipelineVersion)
  if (view.processTimeMs != null) {
    parts.push(`${view.status === 'failed' ? 'stopped after' : 'assessed in'} ${formatProcessTime(view.processTimeMs)}`)
  }
  return parts.join(' · ')
}

const FAILURE_SUMMARY: Record<FailureKind, string> = {
  verification: "The job details are too thin to assess, even after checking the job page.",
  no_llm_key: 'The early assessment needs your LLM API key to read the job. Add one in Settings.',
  not_configured: "The assessment service isn't available right now.",
  daily_cap: "You've reached today's assessment limit. Try again tomorrow.",
  rate_limited: 'The assessment service was busy. Re-run in a minute.',
  overloaded: 'The assessment service was busy. Re-run in a minute.',
  superseded: "This run didn't start in time.",
  error: 'Something went wrong during the assessment.',
}

/** One plain sentence for why a run failed; null for unknown kinds. */
export function failureSummary(kind: FailureKind | null): string | null {
  return kind ? (FAILURE_SUMMARY[kind] ?? null) : null
}

const ENRICHED_FIELD_LABEL: Record<string, string> = {
  title: 'title',
  company: 'company',
  jobDescription: 'job description',
  countries: 'location',
  salaryBand: 'salary band',
}

/**
 * Line about what came from the job page, or null. A replaced description
 * gets its own sentence; other filled fields are listed.
 */
export function enrichmentNote(view: Pick<AssessmentView, 'descriptionReplaced' | 'enrichedFields'>): string | null {
  if (view.descriptionReplaced) {
    return 'The saved job description looked cut off, so it was replaced with the full text from the job page.'
  }
  const fields = view.enrichedFields.map((f) => ENRICHED_FIELD_LABEL[f]).filter(Boolean)
  return fields.length > 0 ? `Filled in from the job page: ${fields.join(', ')}.` : null
}
