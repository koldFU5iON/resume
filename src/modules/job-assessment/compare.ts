/**
 * Side-by-side comparison of the existing JobFit (Claude, `JobApplication.jobFit`)
 * and the early assessment (Jev), for tuning. Pure module: no DB, no network.
 * Used by scripts/assessment-compare.ts.
 *
 * JobFit rates 0–10 (labels reach / possible / stretch / solid / standout).
 * The early assessment scores 1–10 and maps onto the ladder in
 * ASSESSMENT_CONFIG.ladder (1–2 weak, 3–4 consider, 5–7 pursue, 8–10 priority).
 * JobFit's own five labels don't line up with those four levels, so its
 * numeric rating is rounded and run through the same ladder; a rating of 0
 * counts as weak. That way both sides are bucketed by the same cut points.
 */

import { ASSESSMENT_CONFIG, type AssessmentLevel } from './schema'

export const LEVEL_ORDER: readonly AssessmentLevel[] = ['weak', 'consider', 'pursue', 'priority']

/** Buckets differing by at least this many steps are flagged. */
export const BUCKET_GAP_FLAG = 2

export interface CompareJob {
  id: string
  title: string
  company: string | null
  /** Raw `jobFit` JSON (shape-checked here); null when the job has none. */
  jobFit: unknown
  /** Latest complete early assessment for the job, if any. */
  assessment: { score: number; level: AssessmentLevel; blocked: boolean } | null
}

export interface CompareRow {
  id: string
  title: string
  company: string
  fitRating: number | null
  fitLabel: string | null
  fitBucket: AssessmentLevel | null
  earlyScore: number | null
  earlyLevel: AssessmentLevel | null
  earlyBlocked: boolean
  /** Distance between the two buckets in ladder steps; null unless both sides exist. */
  bucketGap: number | null
  disagreement: boolean
  reasons: string[]
}

export interface CompareSummary {
  jobs: number
  /** Jobs with both a JobFit and an early assessment. */
  paired: number
  fitLevels: Record<AssessmentLevel, number>
  earlyLevels: Record<AssessmentLevel, number>
  earlyBlocked: number
  meanAbsScoreDiff: number | null
  spearman: number | null
  disagreements: number
}

/** Rounded rating through the assessment ladder; ratings below 1 are weak. */
export function bucketForRating(rating: number): AssessmentLevel {
  const r = Math.round(rating)
  for (const step of ASSESSMENT_CONFIG.ladder) if (r >= step.min) return step.level
  return 'weak'
}

/** Reads `{ rating, label }` from a stored jobFit value; null when it isn't usable. */
export function readJobFit(value: unknown): { rating: number; label: string | null } | null {
  if (!value || typeof value !== 'object') return null
  const { rating, label } = value as { rating?: unknown; label?: unknown }
  if (typeof rating !== 'number' || !Number.isFinite(rating)) return null
  return { rating, label: typeof label === 'string' ? label : null }
}

/** Average ranks (ties share the mean rank), 1-based. */
function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const out = new Array<number>(values.length)
  for (let s = 0; s < order.length; ) {
    let e = s
    while (e + 1 < order.length && order[e + 1].v === order[s].v) e++
    const avg = (s + e) / 2 + 1
    for (let k = s; k <= e; k++) out[order[k].i] = avg
    s = e + 1
  }
  return out
}

/** Spearman rank correlation (Pearson on average ranks). null for fewer than 2 pairs or no variance on a side. */
export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null
  const rx = ranks(xs)
  const ry = ranks(ys)
  const n = rx.length
  const mx = rx.reduce((a, b) => a + b, 0) / n
  const my = ry.reduce((a, b) => a + b, 0) / n
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my)
    dx += (rx[i] - mx) ** 2
    dy += (ry[i] - my) ** 2
  }
  if (dx === 0 || dy === 0) return null
  return num / Math.sqrt(dx * dy)
}

/** Builds one row per job; rows are not sorted (see sortRows). */
export function compareJob(job: CompareJob): CompareRow {
  const fit = readJobFit(job.jobFit)
  const fitBucket = fit ? bucketForRating(fit.rating) : null
  const a = job.assessment
  const reasons: string[] = []
  let bucketGap: number | null = null

  if (fitBucket && a) {
    bucketGap = Math.abs(LEVEL_ORDER.indexOf(fitBucket) - LEVEL_ORDER.indexOf(a.level))
    if (bucketGap >= BUCKET_GAP_FLAG) reasons.push(`buckets differ by ${bucketGap}`)
    if (a.blocked && (fitBucket === 'pursue' || fitBucket === 'priority')) {
      reasons.push(`early assessment blocked, JobFit ${fitBucket}`)
    }
  }

  return {
    id: job.id,
    title: job.title,
    company: job.company ?? '',
    fitRating: fit?.rating ?? null,
    fitLabel: fit?.label ?? null,
    fitBucket,
    earlyScore: a?.score ?? null,
    earlyLevel: a?.level ?? null,
    earlyBlocked: a?.blocked ?? false,
    bucketGap,
    disagreement: reasons.length > 0,
    reasons,
  }
}

/** Disagreements first (largest gap first), then the rest by title. */
export function sortRows(rows: readonly CompareRow[]): CompareRow[] {
  return [...rows].sort(
    (x, y) =>
      Number(y.disagreement) - Number(x.disagreement) ||
      (y.bucketGap ?? -1) - (x.bucketGap ?? -1) ||
      x.title.localeCompare(y.title),
  )
}

function emptyLevels(): Record<AssessmentLevel, number> {
  return { weak: 0, consider: 0, pursue: 0, priority: 0 }
}

export function summarize(rows: readonly CompareRow[]): CompareSummary {
  const fitLevels = emptyLevels()
  const earlyLevels = emptyLevels()
  let earlyBlocked = 0
  const fitScores: number[] = []
  const earlyScores: number[] = []

  for (const r of rows) {
    if (r.fitBucket) fitLevels[r.fitBucket]++
    if (r.earlyLevel) earlyLevels[r.earlyLevel]++
    if (r.earlyBlocked) earlyBlocked++
    if (r.fitRating !== null && r.earlyScore !== null) {
      fitScores.push(r.fitRating)
      earlyScores.push(r.earlyScore)
    }
  }

  const paired = fitScores.length
  const meanAbsScoreDiff = paired
    ? fitScores.reduce((sum, f, i) => sum + Math.abs(f - earlyScores[i]), 0) / paired
    : null

  return {
    jobs: rows.length,
    paired,
    fitLevels,
    earlyLevels,
    earlyBlocked,
    meanAbsScoreDiff,
    spearman: spearman(fitScores, earlyScores),
    disagreements: rows.filter((r) => r.disagreement).length,
  }
}

/** Runs the whole comparison: rows (sorted) and summary. */
export function compareAll(jobs: readonly CompareJob[]): { rows: CompareRow[]; summary: CompareSummary } {
  const rows = sortRows(jobs.map(compareJob))
  return { rows, summary: summarize(rows) }
}

export const CSV_HEADER = [
  'title', 'company', 'jobfit_rating', 'jobfit_label', 'jobfit_bucket',
  'early_score', 'early_level', 'early_blocked', 'bucket_gap', 'disagreement', 'reasons',
] as const

/** One CSV field: quoted when needed, and a leading = + - @ is neutralised so spreadsheets don't run it as a formula. */
export function csvField(value: string | number | boolean | null): string {
  if (value === null) return ''
  let s = String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: readonly CompareRow[]): string {
  const lines = rows.map((r) =>
    [
      r.title, r.company, r.fitRating, r.fitLabel, r.fitBucket,
      r.earlyScore, r.earlyLevel, r.earlyLevel ? r.earlyBlocked : null, r.bucketGap, r.disagreement, r.reasons.join('; '),
    ].map(csvField).join(','),
  )
  return [CSV_HEADER.join(','), ...lines].join('\n') + '\n'
}
