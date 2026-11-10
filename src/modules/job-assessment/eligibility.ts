/**
 * Eligibility checks for the early job assessment: the code half of the
 * blocker rules in the design spec
 * (docs/superpowers/specs/2026-11-10-jev-early-assessment-design.md).
 *
 * Pure functions only — no DB, no LLM, no Jev. Phase 3's `combine.ts` maps the
 * statuses returned here onto hard blockers (red) and unconfirmed flags
 * (amber); this module never decides severity itself.
 *
 * All country codes are ISO 3166-1 alpha-2 and all currency codes ISO 4217,
 * uppercase. Inputs are normalised defensively (trimmed, uppercased, common
 * aliases such as "UK" mapped to "GB"), so job facts from the cheap model or
 * the job row can be passed straight in.
 */

import type { Eligibility } from '@/modules/search-profile/schema'
import { toCountryCode } from './countries'

export { COUNTRIES, CURRENCIES, countryName, isCountryCode, toCountryCode } from './countries'
export type { Country, Currency } from './countries'

// ── Country groups ──────────────────────────────────────────────────────────

/** The 27 EU member states. */
export const EU_COUNTRIES: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
])

/** EU + EEA (IS, LI, NO). */
export const EEA_COUNTRIES: ReadonlySet<string> = new Set([...EU_COUNTRIES, 'IS', 'LI', 'NO'])

/** EU + EEA + CH: freedom of movement area (spec §2, first row of the coverage table). */
export const EU_EEA_CH: ReadonlySet<string> = new Set([...EEA_COUNTRIES, 'CH'])

// ── Input types (shared with Phase 3 facts/combine) ─────────────────────────

/** Where a job can be done from — `JobFactsSchema.location` mode (spec §3). */
export type JobLocationMode =
  | 'onsite'
  | 'hybrid'
  | 'remote_in_country'
  | 'remote_region'
  | 'remote_anywhere'
  | 'unknown'

/** The job's location facts (spec §3 `location`). */
export interface JobLocation {
  /** ISO alpha-2 codes for every country the role can be based in. */
  countries: string[]
  mode: JobLocationMode
  /** True when the description requires living or working in specific countries. */
  basedInRequired?: boolean
  /**
   * For `remote_region`: where remote work is allowed. ISO alpha-2 codes; the
   * group names "EU" and "EEA" are also understood. Other values are ignored.
   */
  remoteRegions?: string[]
}

/** What the description says about visa sponsorship (spec §4.2 `sponsorship`). */
export type Sponsorship = 'offered' | 'not_offered' | 'right_to_work_required' | 'not_mentioned'

/** Salary stated in the description (spec §3 `salary`). */
export interface JobSalary {
  min: number | null
  max: number | null
  /** ISO 4217. */
  currency: string
  period: 'year' | 'month' | 'day' | 'hour'
}

// ── Result types ────────────────────────────────────────────────────────────

/**
 * - `covered` — the user can work in at least one of the job's countries (or the role is remote-anywhere)
 * - `needs_sponsorship_offered` — not covered, but the description offers sponsorship
 * - `blocked` — not covered and the description rules sponsorship out (hard blocker)
 * - `unconfirmed` — not covered and the description says nothing (amber)
 * - `unknown` — the job's countries are unknown; skip the check ("Location unknown")
 */
export type WorkRightsStatus = 'covered' | 'needs_sponsorship_offered' | 'blocked' | 'unconfirmed' | 'unknown'

export interface WorkRightsResult {
  status: WorkRightsStatus
  /**
   * When `covered`: the job countries the user can work in (empty for
   * remote-anywhere). Otherwise: the job countries the user lacks rights for
   * (empty when `unknown`). Suitable for the reason text.
   */
  countries: string[]
}

/**
 * - `none` — no relocation concern
 * - `unconfirmed` — the role needs the user to be based in a country they don't live in and haven't targeted (amber)
 * - `unknown` — the check applies but the job's countries or the user's current country are missing
 */
export type RelocationStatus = 'none' | 'unconfirmed' | 'unknown'

/**
 * - `ok` — the stated pay reaches the floor
 * - `below_floor` — stated `max` < floor (hard blocker)
 * - `straddles_floor` — the range reaches the floor only at the top, or one end is missing so it can't be confirmed (amber)
 * - `no_floor_for_currency` — the user has no floor in this currency; no check
 * - `unknown` — no salary stated, a non-annual period, or no figures
 */
export type PayStatus = 'ok' | 'below_floor' | 'straddles_floor' | 'no_floor_for_currency' | 'unknown'

export interface PayCheckResult {
  status: PayStatus
  /** Stated `max` is below the user's target (spec §5 Score: −0.05). False when there's no target or no max. */
  belowTarget: boolean
  /** The floor compared against; present whenever a floor exists for the salary's currency. */
  floor?: number
  /** That floor's target; present alongside `floor`. */
  target?: number | null
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function normaliseCodes(values: readonly string[]): string[] {
  const out = new Set<string>()
  for (const v of values) {
    const code = toCountryCode(v)
    if (code) out.add(code)
  }
  return [...out]
}

/** `today` as a UTC calendar date, `YYYY-MM-DD`, to compare with `Visa.expiresOn`. */
function isoDate(today: Date): string {
  return today.toISOString().slice(0, 10)
}

/** The countries a job can be done from, normalised. Uses `remoteRegions` for `remote_region` when it names any. */
function jobCountries(job: JobLocation): string[] {
  if (job.mode === 'remote_region' && job.remoteRegions?.length) {
    const fromRegions = new Set<string>()
    for (const region of job.remoteRegions) {
      const key = region.trim().toUpperCase()
      if (key === 'EU') EU_COUNTRIES.forEach((c) => fromRegions.add(c))
      else if (key === 'EEA') EEA_COUNTRIES.forEach((c) => fromRegions.add(c))
      else {
        const code = toCountryCode(region)
        if (code) fromRegions.add(code)
      }
    }
    if (fromRegions.size > 0) return [...fromRegions]
  }
  return normaliseCodes(job.countries)
}

// ── Checks ──────────────────────────────────────────────────────────────────

/**
 * Countries the user can work in without sponsorship — spec §2,
 * "Work-rights coverage table":
 *
 * | Basis                                  | Covers                         |
 * |----------------------------------------|--------------------------------|
 * | Citizenship of an EU/EEA country or CH | All EU + EEA (IS, LI, NO) + CH |
 * | Irish citizenship                      | The above + GB (CTA)           |
 * | British citizenship                    | GB + IE (CTA)                  |
 * | Any other citizenship                  | That country                   |
 * | A visa                                 | Its country, until `expiresOn` |
 *
 * A visa counts while `expiresOn` is null or on/after `today` (UTC calendar
 * date), so a visa expiring today still covers today.
 */
export function coveredCountries(e: Eligibility, today: Date): Set<string> {
  const covered = new Set<string>()
  for (const raw of e.citizenships) {
    const c = raw.toUpperCase()
    covered.add(c)
    if (EU_EEA_CH.has(c)) EU_EEA_CH.forEach((x) => covered.add(x))
    if (c === 'IE') covered.add('GB')
    if (c === 'GB') covered.add('IE')
  }
  const todayIso = isoDate(today)
  for (const visa of e.visas) {
    if (visa.expiresOn === null || visa.expiresOn >= todayIso) covered.add(visa.country.toUpperCase())
  }
  return covered
}

/**
 * Work rights — spec §5 Blockers, "Work rights" row:
 * hard when not covered and `sponsorship ∈ {not_offered, right_to_work_required}`;
 * unconfirmed when not covered and `not_mentioned`.
 *
 * Order: `remote_anywhere` → covered; no known job countries → unknown (spec §1:
 * skip and show "Location unknown"); any job country covered → covered;
 * otherwise by `sponsorship`. For `remote_region`, `remoteRegions` are the
 * countries when they name any (ISO codes, or "EU"/"EEA").
 */
export function checkWorkRights(
  e: Eligibility,
  jobLocation: JobLocation,
  sponsorship: Sponsorship,
  today: Date,
): WorkRightsResult {
  if (jobLocation.mode === 'remote_anywhere') return { status: 'covered', countries: [] }

  const countries = jobCountries(jobLocation)
  if (countries.length === 0) return { status: 'unknown', countries: [] }

  const covered = coveredCountries(e, today)
  const coveredJobCountries = countries.filter((c) => covered.has(c))
  if (coveredJobCountries.length > 0) return { status: 'covered', countries: coveredJobCountries }

  switch (sponsorship) {
    case 'not_offered':
    case 'right_to_work_required':
      return { status: 'blocked', countries }
    case 'offered':
      return { status: 'needs_sponsorship_offered', countries }
    case 'not_mentioned':
      return { status: 'unconfirmed', countries }
  }
}

/**
 * Relocation — spec §5 Blockers, "Relocation" row (amber only, never hard):
 * the role requires being based in its countries (`basedInRequired`, or mode
 * `onsite`, `hybrid` or `remote_in_country`), `currentCountry` is not among the
 * job's countries, and none of those countries is among the user's target
 * countries.
 *
 * `targetCountries` is the search profile's free-text `countries` list; names,
 * codes and aliases ("UK") are all understood.
 *
 * Order: not location-bound → none; no job countries → unknown; a job country
 * is a target → none (the user has said they'd go there, so a missing
 * `currentCountry` doesn't matter); no `currentCountry` → unknown; lives in a
 * job country → none; otherwise unconfirmed.
 */
export function checkRelocation(
  e: Eligibility,
  jobLocation: JobLocation,
  targetCountries: string[],
): RelocationStatus {
  const bound =
    jobLocation.basedInRequired === true ||
    jobLocation.mode === 'onsite' ||
    jobLocation.mode === 'hybrid' ||
    jobLocation.mode === 'remote_in_country'
  if (!bound) return 'none'

  const countries = normaliseCodes(jobLocation.countries)
  if (countries.length === 0) return 'unknown'

  const targets = new Set(normaliseCodes(targetCountries))
  if (countries.some((c) => targets.has(c))) return 'none'

  if (!e.currentCountry) return 'unknown'
  if (countries.includes(e.currentCountry.toUpperCase())) return 'none'
  return 'unconfirmed'
}

/**
 * Pay — spec §5 Blockers, "Pay" row: hard when stated `max` < floor (same
 * currency); unconfirmed when `min` < floor ≤ `max`. Also reports
 * `belowTarget` for the score's −0.05 (spec §5 Score).
 *
 * Only annual salaries are compared (`period: 'year'`); other periods are
 * `unknown` — no conversion. With one end of the range missing: only `min`
 * ≥ floor → ok; only `min` < floor, or only `max` ≥ floor → straddles_floor
 * (can't be confirmed either way).
 */
export function checkPay(e: Eligibility, salary: JobSalary | null): PayCheckResult {
  if (!salary || salary.period !== 'year') return { status: 'unknown', belowTarget: false }

  const currency = salary.currency.trim().toUpperCase()
  const entry = e.salaryFloors.find((f) => f.currency.toUpperCase() === currency)
  if (!entry) return { status: 'no_floor_for_currency', belowTarget: false }

  const { floor, target } = entry
  const { min, max } = salary
  const belowTarget = target !== null && max !== null && max < target
  const base = { floor, target, belowTarget }

  if (min === null && max === null) return { ...base, status: 'unknown' }
  if (max !== null && max < floor) return { ...base, status: 'below_floor' }
  if (min !== null && min >= floor) return { ...base, status: 'ok' }
  return { ...base, status: 'straddles_floor' }
}
