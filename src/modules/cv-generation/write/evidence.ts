/**
 * The evidence the writers work from: the SELECTED ids of the stored selection
 * resolved against the profile vault, with the full activity text, impact and
 * kind (the selection stores only ids and short labels). The vault is loaded
 * for one profile (loadVault(profileId)), so another profile's ids resolve to
 * nothing. An id that is no longer in the profile (it was edited since the
 * run) is skipped and counted, never invented.
 *
 * Free text is contact-scrubbed like the Select stage (candidates.ts). Pure
 * given a vault: no DB, no network.
 */

import { notesOf } from '@/modules/profile-map/build'
import type { Vault } from '@/modules/profile-map/types'
import { buildCandidates, type CandidateActivity } from '../candidates'
import type { CvSelection, SelectedEmployer } from '../schema'
import { certificationStatus, educationStatus, isClaimedCapability } from './status'

export type EmployerEvidence = {
  employer: SelectedEmployer
  /** Selected activities with their full text, best first (the selection's order). */
  activities: CandidateActivity[]
  /** Selected activities no longer in the profile (or no longer under this employer). */
  missing: number
}

export type CapabilityEvidence = {
  id: string
  name: string
  category: string | null
  level: string | null
  /** Listed in the profile with no evidence or certification behind it. */
  claimed: boolean
}

export type CertificationEvidence = {
  id: string
  name: string
  issuer: string | null
  issueDate: Date | null
  expiryDate: Date | null
}

export type EducationEvidence = {
  id: string
  institution: string
  qualification: string
  field: string | null
  startDate: Date
  endDate: Date | null
  grade: string | null
}

export type Evidence = {
  employers: EmployerEvidence[]
  skills: CapabilityEvidence[]
  tools: CapabilityEvidence[]
  competencies: CapabilityEvidence[]
  certifications: CertificationEvidence[]
  education: EducationEvidence[]
  languages: Array<{ name: string; proficiency: string | null }>
  /** Every role title and company in the profile: what a writer must never introduce. */
  profileTitles: string[]
  profileCompanies: string[]
  /** Capabilities the profile lists without evidence, by name (all of them, not only the selected). */
  claimedNames: string[]
  /** Every certification and qualification name in the profile, with whether it is still in progress: what a writer must not present as held. */
  credentials: Array<{ name: string; inProgress: boolean }>
}

/** Names whose digits are part of the name ("ISO 27001", "GA4"), not figures: selected skills, tools, competencies and certifications. */
export function figureIgnoredNames(e: Pick<Evidence, 'skills' | 'tools' | 'competencies' | 'certifications'>): string[] {
  return [...e.skills, ...e.tools, ...e.competencies, ...e.certifications].map((c) => c.name)
}

/** The text a writer's figures and names may be checked against: the activities' text and impact. */
export function evidenceTexts(e: EmployerEvidence): string[] {
  return e.activities.flatMap((a) => [a.text, a.impact ?? ''])
}

export function evidenceFromVault(vault: Vault, selection: CvSelection, now: Date = new Date()): Evidence {
  const byActivity = new Map<string, CandidateActivity>()
  for (const emp of buildCandidates(vault).employers) for (const a of emp.activities) byActivity.set(a.id, a)

  const employers = selection.employers.map((employer): EmployerEvidence => {
    const roleIds = new Set(employer.roles.map((r) => r.experienceId))
    const activities: CandidateActivity[] = []
    let missing = 0
    for (const b of employer.headerOnly ? [] : employer.bullets) {
      const a = byActivity.get(b.id)
      if (a && roleIds.has(a.experienceId)) activities.push(a)
      else missing++
    }
    return { employer, activities, missing }
  })

  const caps = (ids: ReadonlyArray<{ id: string }>): CapabilityEvidence[] =>
    ids.flatMap(({ id }) => {
      const n = vault.notes.get(id)
      return n?.type === 'capability'
        ? [{ id, name: n.props.name, category: n.props.category, level: n.props.level, claimed: isClaimedCapability(vault, n, now) }]
        : []
    })

  const certifications = selection.certifications.flatMap(({ id }) => {
    const n = vault.notes.get(id)
    return n?.type === 'certification'
      ? [{ id, name: n.props.name, issuer: n.props.issuer, issueDate: n.props.issueDate, expiryDate: n.props.expiryDate }]
      : []
  })
  const education = selection.education.flatMap(({ id }) => {
    const n = vault.notes.get(id)
    return n?.type === 'education'
      ? [{ id, institution: n.props.institution, qualification: n.props.qualification, field: n.props.field, startDate: n.props.startDate, endDate: n.props.endDate, grade: n.props.grade }]
      : []
  })

  const experiences = notesOf(vault, 'experience')
  return {
    employers,
    skills: caps(selection.skills),
    tools: caps(selection.tools),
    competencies: caps(selection.competencies),
    certifications,
    education,
    languages: notesOf(vault, 'language').map((l) => ({ name: l.props.name, proficiency: l.props.proficiency })),
    profileTitles: [...new Set(experiences.map((e) => e.props.role.trim()).filter(Boolean))],
    profileCompanies: [...new Set(experiences.map((e) => e.props.company.trim()).filter(Boolean))],
    credentials: [
      ...notesOf(vault, 'certification').map((c) => ({ name: c.props.name, inProgress: certificationStatus(c.props, now) === 'in_progress' })),
      ...notesOf(vault, 'education').flatMap((e) => [e.props.qualification, e.props.institution].map((name) => ({ name, inProgress: educationStatus(e.props, now) === 'in_progress' }))),
    ].filter((c) => c.name.trim().length >= 2),
    claimedNames: notesOf(vault, 'capability').filter((c) => isClaimedCapability(vault, c, now)).map((c) => c.props.name),
  }
}
