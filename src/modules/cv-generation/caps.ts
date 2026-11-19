/**
 * Every hard cap of the Select stage, in one place. Enforced in code AFTER the
 * model answers (select.ts), never left to prose in a prompt: this is what
 * stops over-production (docs/cv-generation.md, "Why replace it").
 *
 * Starting point is the legacy generator's limits and the page-budget prose in
 * src/lib/prompts/cv-generate.md. Pure: no DB, no network.
 */

/**
 * Most employers that show bullets on the CV; the most recent (current)
 * employer is always one of them. Caps are per EMPLOYER, not per role: several
 * consecutive roles at one company are one entry (employers.ts). Employers
 * beyond this are not dropped: they are listed as header-only entries (see
 * MAX_HEADER_ONLY_EMPLOYERS), so the work history has no gaps.
 */
export const MAX_EMPLOYERS = 4

/**
 * Most additional employers listed as header-only entries (company, latest
 * title, dates, progression line, no bullets), most recent first, after the
 * employers that show bullets. An employer beyond this many is dropped (reason
 * `over_cap`). So a CV shows at most MAX_EMPLOYERS + MAX_HEADER_ONLY_EMPLOYERS
 * employers.
 */
export const MAX_HEADER_ONLY_EMPLOYERS = 4

/**
 * Total bullets (activities) across the employers that show bullets. Split by
 * the Select model's relevance score per employer, not by recency
 * (allocateBullets). Calibrated from a real run against the owner's own
 * 2.5-page CV (17 bullets): the aim is 16-18, 17 by default (the split fills
 * the total whenever the employers' supply allows); `MAX_TOTAL_BULLETS` is the
 * hard ceiling.
 */
export const TOTAL_ACTIVITY_BUDGET = 17
/** Hard ceiling on total bullets in the split: over-production cannot return. (A lead-with project's extra bullet is written on top, never more than 2.) */
export const MAX_TOTAL_BULLETS = 20

/** Fewest and most bullets one employer may show (fewer only if it has fewer activities). */
export const MIN_ACTIVITIES_PER_EMPLOYER = 2
export const MAX_ACTIVITIES_PER_EMPLOYER = 6
/** An employer with at least this many roles in the profile (a long, layered tenure such as the current one) may show up to MAX_ACTIVITIES_LAYERED_EMPLOYER. */
export const LAYERED_EMPLOYER_MIN_ROLES = 3
export const MAX_ACTIVITIES_LAYERED_EMPLOYER = 8
/** The most bullets an employer with `roles` roles may show. */
export const maxActivitiesFor = (roles: number): number => (roles >= LAYERED_EMPLOYER_MIN_ROLES ? MAX_ACTIVITIES_LAYERED_EMPLOYER : MAX_ACTIVITIES_PER_EMPLOYER)

/** The 1-5 scale of the Select model's per-employer relevance score. */
export const MIN_RELEVANCE = 1
export const MAX_RELEVANCE = 5
/** The middle of the scale: what an unreadable stored score reads as, and what derivation gives when nothing matches anywhere. */
export const NEUTRAL_RELEVANCE = Math.round((MIN_RELEVANCE + MAX_RELEVANCE) / 2)

/** Hard ceilings per flat section (the Brief and Select can never exceed them). */
export const MAX_SKILLS = 12
export const MAX_TOOLS = 10
export const MAX_COMPETENCIES = 8
export const MAX_CERTIFICATIONS = 6
/** All education, but never more than this many entries. */
export const MAX_EDUCATION = 3
export const MAX_PROJECTS = 2

/** The flat (non-experience) sections of the selection. */
export const FLAT_SECTIONS = ['skills', 'tools', 'competencies', 'certifications', 'education', 'projects'] as const
export type FlatSection = typeof FLAT_SECTIONS[number]

export const FLAT_CAPS: Record<FlatSection, number> = {
  skills: MAX_SKILLS,
  tools: MAX_TOOLS,
  competencies: MAX_COMPETENCIES,
  certifications: MAX_CERTIFICATIONS,
  education: MAX_EDUCATION,
  projects: MAX_PROJECTS,
}

/**
 * Floors: the Brief may raise a budget up to its ceiling but never go below
 * these (a stored Brief's lower number is clamped up in code). A floor is
 * met only as far as the profile has items (a profile with 5 certifications
 * shows 5). The first real run came out at 507 words because the Brief asked
 * for 3 certifications, 5 competencies and 3 employers with bullets.
 * Projects keep a floor of 0: a project with no bearing on the job is not
 * padding for the page. Education keeps its floor of 1.
 */
export const MIN_EMPLOYERS_WITH_BULLETS = 4
export const FLAT_FLOORS: Record<FlatSection, number> = {
  skills: MAX_SKILLS,
  tools: MAX_TOOLS,
  competencies: MAX_COMPETENCIES,
  certifications: MAX_CERTIFICATIONS,
  education: 1,
  projects: 0,
}

/** The sections the Brief sets a budget for, and the hard cap each budget is clamped to. */
export const BUDGET_CAPS = {
  /** Employers with bullets (the key keeps its name so stored briefs still parse). */
  experiences: MAX_EMPLOYERS,
  ...FLAT_CAPS,
} as const
export type BudgetSection = keyof typeof BUDGET_CAPS

/** The floor each budget is clamped up to (see FLAT_FLOORS). */
export const BUDGET_FLOORS: Record<BudgetSection, number> = {
  experiences: MIN_EMPLOYERS_WITH_BULLETS,
  ...FLAT_FLOORS,
}

/** A budget clamped into [floor, ceiling] for its section; anything that is not a number reads as the floor. Pure. */
export function clampBudgetValue(section: BudgetSection, value: number): number {
  const v = Number.isFinite(value) ? Math.round(value) : 0
  return Math.min(BUDGET_CAPS[section], Math.max(BUDGET_FLOORS[section], v))
}

export type BulletClaim = {
  /** Relevance score, MIN_RELEVANCE..MAX_RELEVANCE. */
  relevance: number
  /** Activities this employer can show: what the model picked (topped up to the minimum) or has. */
  supply: number
  /** This employer's own ceiling (maxActivitiesFor); the option `max` when absent. */
  max?: number
}

/**
 * Splits `total` bullets across employers in proportion to their relevance,
 * each getting at least `min` and at most `max` (and never more than its
 * supply). Pure and deterministic; returns one count per claim, in order.
 *
 * Water-filling: shares are proportional to relevance; an employer whose share
 * falls outside [lo, hi] is pinned to that bound and the rest re-share what
 * is left. Counts are then rounded by largest remainder. The sum never exceeds
 * `total`, and falls short of it only when supplies and `max` leave no room.
 */
export function allocateBullets(
  claims: readonly BulletClaim[],
  opts: { total?: number; min?: number; max?: number } = {},
): number[] {
  const total = Math.min(MAX_TOTAL_BULLETS, opts.total ?? TOTAL_ACTIVITY_BUDGET)
  const min = opts.min ?? MIN_ACTIVITIES_PER_EMPLOYER
  const max = opts.max ?? MAX_ACTIVITIES_PER_EMPLOYER
  const n = claims.length
  const hi = claims.map((c) => Math.max(0, Math.min(c.max ?? max, c.supply)))
  let lo = claims.map((c, i) => Math.min(min, hi[i]))
  // Floors that do not fit the total (more employers than the budget allows): keep the most relevant ones.
  if (lo.reduce((a, b) => a + b, 0) > total) {
    const order = claims.map((c, i) => i).sort((a, b) => claims[b].relevance - claims[a].relevance || a - b)
    let left = total
    const fitted = new Array<number>(n).fill(0)
    for (const i of order) {
      fitted[i] = Math.min(lo[i], left)
      left -= fitted[i]
    }
    lo = fitted
  }
  const weight = claims.map((c) => Math.max(c.relevance, 0.0001))
  const pinned = new Array<number | null>(n).fill(null)
  for (let pass = 0; pass <= n; pass++) {
    const free = pinned.map((p, i) => (p === null ? i : -1)).filter((i) => i >= 0)
    if (free.length === 0) break
    const budget = total - pinned.reduce<number>((a, p) => a + (p ?? 0), 0)
    const w = free.reduce((a, i) => a + weight[i], 0)
    const share = (i: number) => (budget * weight[i]) / w
    const over = free.filter((i) => share(i) > hi[i])
    const under = free.filter((i) => share(i) < lo[i])
    const overBy = over.reduce((a, i) => a + share(i) - hi[i], 0)
    const underBy = under.reduce((a, i) => a + lo[i] - share(i), 0)
    if (over.length === 0 && under.length === 0) break
    // Pin the side that breaks the bounds more; the other side is checked again next pass.
    const fix = overBy >= underBy ? over : under
    for (const i of fix) pinned[i] = overBy >= underBy ? hi[i] : lo[i]
  }
  const free = pinned.map((p, i) => (p === null ? i : -1)).filter((i) => i >= 0)
  const budget = total - pinned.reduce<number>((a, p) => a + (p ?? 0), 0)
  const w = free.reduce((a, i) => a + weight[i], 0)
  const out = pinned.map((p) => p ?? 0)
  const frac: Array<{ i: number; rem: number }> = []
  for (const i of free) {
    const exact = Math.max(lo[i], Math.min(hi[i], (budget * weight[i]) / w))
    out[i] = Math.floor(exact)
    frac.push({ i, rem: exact - out[i] })
  }
  let left = total - out.reduce((a, b) => a + b, 0)
  for (const { i } of frac.sort((a, b) => b.rem - a.rem || claims[b.i].relevance - claims[a.i].relevance || a.i - b.i)) {
    if (left <= 0) break
    if (out[i] < hi[i]) {
      out[i]++
      left--
    }
  }
  // Rounding or pinning can leave room while another employer is under its supply: top up by relevance.
  for (const i of claims.map((c, k) => k).sort((a, b) => claims[b].relevance - claims[a].relevance || a - b)) {
    while (left > 0 && out[i] < hi[i]) {
      out[i]++
      left--
    }
  }
  // Safety net: never exceed the total, trimming the least relevant employers first.
  let excess = out.reduce((a, b) => a + b, 0) - total
  for (const i of claims.map((c, k) => k).sort((a, b) => claims[a].relevance - claims[b].relevance || b - a)) {
    while (excess > 0 && out[i] > 0) {
      out[i]--
      excess--
    }
  }
  return out
}

/** Most dropped candidates recorded in the stored selection (the rest are counted, not listed). */
export const MAX_RECORDED_DROPPED = 300
