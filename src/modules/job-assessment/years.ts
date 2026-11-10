/**
 * Years-in-area arithmetic for years requirements (spec §5 "Years").
 *
 * Jev judges, per role, how much of the role was this kind of work (a choice
 * asked in both option orders); code does all the date maths:
 *
 *   w(option)    = { most_of_the_role: 1, about_half: 0.5, small_part: 0, none: 0 }
 *   share(role)  = mean over orders a, b of Σ p(option) · w(option)
 *   counts(role) = share ≥ 0.5 ? share : 0
 *   years        = Σ over months of max over roles covering that month of counts(role) / 12
 *
 * Months are inclusive of both the start and the end month ("Jan 2020 – Dec
 * 2020" is 12 months); overlapping roles count once (the month takes the
 * highest share); "present" and future end dates are clipped to today's month.
 *
 * Pure module.
 */

import type { RoleTimelineEntry, YearMonth } from './candidate-state'
import { ASSESSMENT_CONFIG, type YearsRoleBreakdown, type YearsStatus } from './schema'

export type ShareOption = keyof typeof ASSESSMENT_CONFIG.years.shareWeights

export const SHARE_OPTIONS: readonly ShareOption[] = ['most_of_the_role', 'about_half', 'small_part', 'none']

/** Option probabilities from one share answer (a Jev ChoiceResponse's `probabilities`). */
export type ShareProbabilities = Partial<Record<ShareOption, number>>

/** Both orders of one role's share question; either may be missing (e.g. dropped from a replay). */
export interface ShareAnswerPair {
  a?: ShareProbabilities
  b?: ShareProbabilities
}

export interface YearsEstimate {
  /** Estimated years in the area (unrounded). */
  years: number
  /** One entry per timeline role, in timeline order. */
  roles: YearsRoleBreakdown[]
}

const { shareWeights, countThreshold, warnRatio, warnGapYears, capabilityStretch } = ASSESSMENT_CONFIG.years

/** Tolerance for float noise in the threshold comparisons (e.g. 0.1 + 0.4). */
const EPS = 1e-9

/** Σ p(option) · w(option) for one order. */
export function weightedShare(p: ShareProbabilities): number {
  let sum = 0
  for (const option of SHARE_OPTIONS) sum += (p[option] ?? 0) * shareWeights[option]
  return sum
}

/** Mean of the weighted share over the orders present; 0 when neither is. */
export function roleShare(pair: ShareAnswerPair | undefined): number {
  const orders = [pair?.a, pair?.b].filter((p): p is ShareProbabilities => Boolean(p))
  if (orders.length === 0) return 0
  return orders.reduce((s, p) => s + weightedShare(p), 0) / orders.length
}

function monthIndex(ym: YearMonth): number {
  return ym.y * 12 + (ym.m - 1)
}

/**
 * Estimates years in one area.
 *
 * @param answers share answers per role key (`role_1` …); a role without answers counts 0
 * @param timeline roles with structured dates, from buildCandidateState
 * @param today "present" end and clip date
 */
export function computeYears(
  answers: Record<string, ShareAnswerPair | undefined>,
  timeline: readonly RoleTimelineEntry[],
  today: Date,
): YearsEstimate {
  const todayIdx = monthIndex({ y: today.getUTCFullYear(), m: today.getUTCMonth() + 1 })

  const roles = timeline.map((r) => {
    const share = roleShare(answers[r.key])
    const counted = share + EPS >= countThreshold
    const start = monthIndex(r.start)
    const end = Math.min(r.end === 'present' ? todayIdx : monthIndex(r.end), todayIdx)
    return { entry: r, share, counted, weight: counted ? share : 0, start, end }
  })

  // Month grid: each month goes to the covering role with the highest weight
  // (ties → the earlier, i.e. newer, role in the timeline).
  const owner = new Map<number, number>() // month → index into roles
  roles.forEach((r, i) => {
    if (r.weight <= 0) return
    for (let m = r.start; m <= r.end; m++) {
      const cur = owner.get(m)
      if (cur === undefined || roles[cur].weight < r.weight) owner.set(m, i)
    }
  })

  const attributedMonths = new Array<number>(roles.length).fill(0)
  let total = 0
  for (const i of owner.values()) {
    attributedMonths[i] += 1
    total += roles[i].weight
  }

  return {
    years: total / 12,
    roles: roles.map((r, i) => ({
      key: r.entry.key,
      label: r.entry.label,
      share: r.share,
      counted: r.counted,
      months: Math.max(0, r.end - r.start + 1),
      years: (attributedMonths[i] * r.weight) / 12,
    })),
  }
}

/**
 * Spec §5 years status:
 * - met:     est ≥ required
 * - warn:    est ≥ 0.5 × required, or required − est ≤ 2
 * - stretch: would be block, but capability ≥ 0.7
 * - block:   anything else (a missing capability answer stays block)
 */
export function yearsStatus(est: number, required: number, capability: number | null | undefined): YearsStatus {
  if (est + EPS >= required) return 'met'
  if (est + EPS >= warnRatio * required || required - est <= warnGapYears + EPS) return 'warn'
  if (capability != null && capability + EPS >= capabilityStretch) return 'stretch'
  return 'block'
}

function fmt1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1)
}

/**
 * Display line for an estimate, e.g.
 * "~3.7 yrs: Senior Program Manager 2.3 + Communications Lead 0.7 + PR Manager 50% × 1.4".
 * Roles that add nothing are left out; a role at (nearly) full share shows its years only.
 */
export function formatYearsSummary(estimate: YearsEstimate): string {
  const parts = estimate.roles
    .filter((r) => r.years > 0)
    .map((r) => {
      if (r.share >= 0.95) return `${r.label} ${fmt1(r.years)}`
      return `${r.label} ${Math.round(r.share * 100)}% × ${fmt1(r.years / r.share)}`
    })
  const head = `~${fmt1(estimate.years)} yrs`
  return parts.length > 0 ? `${head}: ${parts.join(' + ')}` : `${head}: no role was mostly this work`
}
