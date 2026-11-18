/**
 * Every hard cap of the Select stage, in one place. Enforced in code AFTER the
 * model answers (select.ts), never left to prose in a prompt: this is what
 * stops over-production (docs/cv-generation.md, "Why replace it").
 *
 * Starting point is the legacy generator: ROLE_BUDGETS 5/4/3 in
 * src/modules/cv/score-evidence.ts and the page-budget prose in
 * src/lib/prompts/cv-generate.md. Pure: no DB, no network.
 */

/**
 * Most roles that show bullets on the CV; the most recent role is always one
 * of them. Roles beyond this are not dropped: they are listed as header-only
 * entries (see MAX_HEADER_ONLY_ROLES), so the work history has no gaps.
 */
export const MAX_EXPERIENCES = 4

/**
 * Most additional roles listed as header-only entries (company, title, dates,
 * no bullets), most recent first, after the roles that show bullets. A role
 * beyond this many is dropped (reason `over_cap`). So a CV shows at most
 * MAX_EXPERIENCES + MAX_HEADER_ONLY_ROLES roles.
 */
export const MAX_HEADER_ONLY_ROLES = 4

/**
 * Activities per kept role by recency tier: [most recent, next, older...].
 * A role further down than the table uses the last entry. Same numbers as the
 * legacy ROLE_BUDGETS.
 */
export const ACTIVITIES_PER_ROLE = [5, 4, 3] as const

export const MAX_SKILLS = 12
export const MAX_TOOLS = 10
export const MAX_COMPETENCIES = 6
export const MAX_CERTIFICATIONS = 4
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

/** The sections the Brief sets a budget for, and the hard cap each budget is clamped to. */
export const BUDGET_CAPS = {
  experiences: MAX_EXPERIENCES,
  ...FLAT_CAPS,
} as const
export type BudgetSection = keyof typeof BUDGET_CAPS

/** Activities a role may keep, by its position among the kept roles (0 = most recent). */
export function activityBudget(roleIndex: number): number {
  return ACTIVITIES_PER_ROLE[Math.min(Math.max(roleIndex, 0), ACTIVITIES_PER_ROLE.length - 1)]
}

/** Most dropped candidates recorded in the stored selection (the rest are counted, not listed). */
export const MAX_RECORDED_DROPPED = 300
