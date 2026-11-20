// An experience is either a job ("employment") or the timeless home for personal projects ("independent",
// named "Independent projects"). Anything that reads an experience AS A JOB (dates, tenure, gaps, overlaps,
// employer names, "worked at") must skip independent ones; evidence and projects under it still count.
// See docs/superpowers/specs/2026-11-19-profile-model-simplification-design.md.
export type ExperienceType = 'employment' | 'independent'

export const INDEPENDENT_EXPERIENCE_TYPE: ExperienceType = 'independent'

/** Narrow any stored value to a known type; anything unrecognised reads as a job (the column default). */
export const asExperienceType = (value: string | null | undefined): ExperienceType =>
  value === INDEPENDENT_EXPERIENCE_TYPE ? INDEPENDENT_EXPERIENCE_TYPE : 'employment'

/** True when the experience is a real job: use this before any date, tenure, gap or employer logic. */
export const isEmployment = (e: { type?: string | null }): boolean => asExperienceType(e.type) === 'employment'

type Labelled = { role: string; company: string; type?: string | null }

/** "Role at Company" for a job; just the name for the independent experience ("Independent projects"). */
export const experienceLabel = (e: Labelled): string => (isEmployment(e) ? `${e.role} at ${e.company}` : e.role)

/** "Role, Company" for lists and pickers; just the name for the independent experience. */
export const experienceTitle = (e: Labelled): string => (isEmployment(e) ? `${e.role}, ${e.company}` : e.role)
