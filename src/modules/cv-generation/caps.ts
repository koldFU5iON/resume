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
 * Bullets are allotted by RECENCY, not by a flat total (allocateByRecency):
 * the current/most recent employer shows 5-7 bullets (8 only when the profile
 * holds 3 or more roles there), the previous employer 3-4, older employers 2-3
 * (1-2 when the employer ended more than OLD_EMPLOYER_YEARS ago). The Select
 * model's relevance score (1-5) shifts an employer by one bullet at most, so
 * it can never reorder the bands. A long career lands on about 12-16 bullets, a
 * short one on proportionally fewer, and the evidence supply always limits it:
 * code never pads with filler to reach a number. `MAX_TOTAL_BULLETS` is the hard
 * ceiling over the whole CV.
 */
export const MAX_TOTAL_BULLETS = 20

/**
 * An employer's allotted bullets are CEILINGS. Approach-only activities (candidates.ts isApproachOnly: no figure, no result wording)
 * fill a slot only while the employer would otherwise show fewer than this many bullets.
 */
export const MIN_BULLETS_BEFORE_APPROACH_ONLY = 3

/** The least an employer shows when the profile has the evidence (older than OLD_EMPLOYER_YEARS excepted). */
export const MIN_ACTIVITIES_PER_EMPLOYER = 2
/** An employer with at least this many roles in the profile (a long, layered tenure) may be the current employer's 8-bullet case. */
export const LAYERED_EMPLOYER_MIN_ROLES = 3
/** An employer that ended more than this many years ago is "old": 1-2 bullets. */
export const OLD_EMPLOYER_YEARS = 10
/** An employer held for less than this many years (in total) gets fewer bullets: a short tenure is not a 6-bullet story. */
export const SHORT_TENURE_YEARS = 1.5
/** Allowance per recency band: `base` is the relevance-neutral count, `min`/`max` the band's bounds. */
export type BulletBand = { min: number; base: number; max: number }
export const CURRENT_BAND: BulletBand = { min: 5, base: 6, max: 7 }
export const CURRENT_LAYERED_BAND: BulletBand = { min: 5, base: 7, max: 8 }
export const PREVIOUS_BAND: BulletBand = { min: 3, base: 3, max: 4 }
export const OLDER_BAND: BulletBand = { min: MIN_ACTIVITIES_PER_EMPLOYER, base: 2, max: 3 }
export const OLD_BAND: BulletBand = { min: 1, base: 2, max: 2 }
/** Ceiling for a short tenure, by band (current, previous, older). */
export const SHORT_TENURE_MAX = [4, 3, 2] as const

/** The 1-5 scale of the Select model's per-employer relevance score. */
export const MIN_RELEVANCE = 1
export const MAX_RELEVANCE = 5
/** The middle of the scale: what an unreadable stored score reads as, and what derivation gives when nothing matches anywhere. */
export const NEUTRAL_RELEVANCE = Math.round((MIN_RELEVANCE + MAX_RELEVANCE) / 2)

/**
 * Ceilings per flat section (the Brief and Select can never exceed them).
 * They are CEILINGS only: relevance decides how many items a section shows, and
 * a short list is better than a padded one (docs/cv-generation.md, section 6).
 */
export const MAX_SKILLS = 12
export const MAX_TOOLS = 10
export const MAX_COMPETENCIES = 8
export const MAX_CERTIFICATIONS = 4
/** Degrees and diplomas only; never more than this many entries. */
export const MAX_EDUCATION = 2
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
 * Employers with bullets keep a floor (a long career still shows its recent
 * employers; the work history has no gaps). No flat section has a padding floor (education's 1 only stops the Brief zeroing it):
 * a section may be empty or short when little in the profile is relevant.
 */
export const MIN_EMPLOYERS_WITH_BULLETS = 4
export const FLAT_FLOORS: Record<FlatSection, number> = {
  skills: 0,
  tools: 0,
  competencies: 0,
  certifications: 0,
  /** Education is the one section the Brief cannot zero: a CV with no education line reads as an omission (when the profile has any). */
  education: 1,
  projects: 0,
}

/**
 * The one top-up code still does: a section that would be EMPTY while the
 * profile has a relevant, evidence-backed item gets that many items. Education
 * gets one whenever the profile has a degree or diploma (a CV with no
 * education line reads as an omission). Every other flat section gets none.
 */
export const EMPTY_SECTION_MINIMUM = 1

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

/** What allocateByRecency needs to know about one employer that shows bullets. Employers are passed newest first (the current employer first). */
export type RecencyClaim = {
  /** The Select model's relevance score, MIN_RELEVANCE..MAX_RELEVANCE. */
  relevance: number
  /** Activities this employer can show: what the model picked (topped up to the minimum) or has. */
  supply: number
  /** Roles the profile holds at this employer. */
  roles: number
  /** Whole years since the employer's latest role ended; 0 for a current employer. */
  yearsSinceEnd: number
  /** Years held in total (the stints added up). */
  tenureYears: number
}

/** The recency band of the employer at `index` (0 = current or most recent). */
function bandFor(c: RecencyClaim, index: number): BulletBand {
  const short = c.tenureYears < SHORT_TENURE_YEARS
  const slot = Math.min(index, 2)
  const band = index === 0 ? (c.roles >= LAYERED_EMPLOYER_MIN_ROLES ? CURRENT_LAYERED_BAND : CURRENT_BAND) : index === 1 ? PREVIOUS_BAND : c.yearsSinceEnd > OLD_EMPLOYER_YEARS ? OLD_BAND : OLDER_BAND
  if (!short) return band
  const max = Math.min(band.max, SHORT_TENURE_MAX[slot])
  return { min: Math.min(band.min, max), base: Math.min(band.base, max), max }
}

/**
 * Bullets per employer, by recency: the band's base count, moved one up for a
 * relevance of 4-5 and one down for 1-2, kept inside the band, and never more
 * than the employer's supply. If the sum passes MAX_TOTAL_BULLETS, the oldest
 * employers give up bullets first (down to their band minimum, then below).
 * `claims` are newest first; one count per claim, in order. Pure.
 */
export function allocateByRecency(claims: readonly RecencyClaim[]): number[] {
  const bands = claims.map(bandFor)
  const out = claims.map((c, i) => {
    const shift = c.relevance >= 4 ? 1 : c.relevance <= 2 ? -1 : 0
    const target = Math.min(bands[i].max, Math.max(bands[i].min, bands[i].base + shift))
    return Math.max(0, Math.min(target, c.supply))
  })
  const floors = bands.map((b, i) => Math.min(b.min, out[i]))
  for (const floor of [floors, out.map(() => 0)]) {
    for (let i = out.length - 1; i >= 0; i--) {
      while (out[i] > floor[i] && out.reduce((a, b) => a + b, 0) > MAX_TOTAL_BULLETS) out[i]--
    }
  }
  return out
}

/** Most dropped candidates recorded in the stored selection (the rest are counted, not listed). */
export const MAX_RECORDED_DROPPED = 300
