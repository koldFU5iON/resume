// Profile readiness: what is thin, contradictory or missing in the profile,
// told to the owner BEFORE a paid CV run. Pure functions over the loaded
// vault: no LLM call, no database, no cost. Findings never carry contact
// details. See docs/cv-generation.md "Profile readiness".

import type { Vault } from '@/modules/profile-map/types'
import {
  checkCapabilities, checkCertifications, checkConflictingFigures, checkContact, checkDuplicateProjects,
  checkEducation, checkEvidenceQuality, checkExperienceDates, checkExperienceEvidence, checkOutcomeProjects, checkRoleOverview, checkThinNarratives,
} from './checks'
import type { Candidate, ReadinessReport } from './schema'

export * from './schema'

/** The panel shows at most this many findings; `total` still counts them all. */
export const MAX_FINDINGS = 25

export function checkProfileReadiness(vault: Vault, now: Date): ReadinessReport {
  const all: Candidate[] = [
    ...checkThinNarratives(vault, now),
    ...checkDuplicateProjects(vault),
    ...checkCertifications(vault, now),
    ...checkEducation(vault, now),
    ...checkExperienceDates(vault, now),
    ...checkExperienceEvidence(vault, now),
    ...checkRoleOverview(vault, now),
    ...checkEvidenceQuality(vault),
    ...checkConflictingFigures(vault),
    ...checkOutcomeProjects(vault),
    ...checkCapabilities(vault),
    ...checkContact(vault),
  ]
  const rank = (c: Candidate) => (c.severity === 'fix' ? 0 : 1)
  const sorted = all
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || b.c.impact - a.c.impact || a.i - b.i)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- impact only orders
    .map(({ c: { impact, ...finding } }) => finding)
  return {
    findings: sorted.slice(0, MAX_FINDINGS),
    total: sorted.length,
    fixCount: sorted.filter((f) => f.severity === 'fix').length,
  }
}
