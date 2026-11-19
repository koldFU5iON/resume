/**
 * Years of experience for the profile opener, computed in code from the
 * EARLIEST role start in the profile across every employer (including ones
 * that only appear under Earlier Experience), never from what a model says.
 * Floored to the nearest YEARS_ROUNDING_STEP and shown as "20+ years" only
 * from YEARS_MIN_TO_STATE up: a shorter career states no number. Pure.
 */

/** Whole years are floored to a multiple of this ("23 years" reads as "20+ years"). */
export const YEARS_ROUNDING_STEP = 5
/** The fewest (rounded) years the profile may state. */
export const YEARS_MIN_TO_STATE = 10

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000

/** Whole years from the earliest of `starts` to `now`; 0 with no start. Never negative. */
export function careerYears(starts: ReadonlyArray<Date | null | undefined>, now: Date): number {
  const times = starts.filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime())).map((d) => d.getTime())
  if (times.length === 0) return 0
  return Math.max(0, Math.floor((now.getTime() - Math.min(...times)) / MS_PER_YEAR))
}

/** The floored number the opener states (10, 15, 20...), or null when the career is too short to state one. */
export function statedYears(starts: ReadonlyArray<Date | null | undefined>, now: Date): number | null {
  const floored = Math.floor(careerYears(starts, now) / YEARS_ROUNDING_STEP) * YEARS_ROUNDING_STEP
  return floored >= YEARS_MIN_TO_STATE ? floored : null
}

/** The exact phrase the profile uses: "20+ years". */
export const yearsPhrase = (years: number): string => `${years}+ years`
