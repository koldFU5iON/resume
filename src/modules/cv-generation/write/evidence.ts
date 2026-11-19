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
import { makeContactScrubber } from '@/modules/profile-map/pii'
import { stripWikilinks } from '@/modules/profile-map/links'
import { buildCandidates, type CandidateActivity } from '../candidates'
import { activityPromptText, projectEvidenceText } from '../project-evidence'
import type { CvSelection, SelectedEmployer } from '../schema'
import { capOverview, capProjectText } from './limits'
import { certificationStatus, educationStatus, isClaimedCapability } from './status'

/** A selected project, routed to the employer it belongs to as extra evidence for that employer's writer. */
export type ProjectEvidence = {
  id: string
  name: string
  /** Description, a digest of the notes and the project's own atoms that are not bullets themselves; contact-scrubbed (project-evidence.ts). */
  text: string
  /** Only a title to write from (project-evidence.ts); undefined = decide from `text`. */
  thin?: boolean
}

export type EmployerEvidence = {
  employer: SelectedEmployer
  /** Selected activities with their full text, best first (the selection's order). */
  activities: CandidateActivity[]
  /** Selected projects that belong to this employer (extra evidence: a bullet of their own or merged into one). Empty for a header-only employer. */
  projects: ProjectEvidence[]
  /** Selected activities no longer in the profile (or no longer under this employer). */
  missing: number
  /** The roles' own overview text (their notes' body), contact-scrubbed, oldest role first, repeats removed and capped (OVERVIEW_MAX_CHARS); '' when the profile has none. What the summary may be drawn from, and valid evidence for the summary's figures (never a bullet's). */
  overview?: string
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
  /** Position among the certifications that will be rendered (not expired), in the selection's relevance order (0 = the first shown). Undefined when the selection was chosen by code, not the model. */
  rank?: number
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
  /** Selected projects that no employer entry can carry, with the reason: each becomes a log note, so no selected item is dropped silently. */
  unroutedProjects: Array<{ name: string; why: string }>
  /** Selected items whose id is no longer in the profile (edited since the run), by section: noted, never invented. */
  unresolved: Array<{ section: string; id: string }>
  /** Log notes about project evidence (atoms left out of a project's text because they are bullets of their own). */
  projectNotes?: string[]
  /** Every certification and qualification name in the profile, with whether it is still in progress: what a writer must not present as held. */
  credentials: Array<{ name: string; inProgress: boolean }>
}

/**
 * Names whose digits are part of the name ("ISO 27001", "GA4", the employer "2K"), not figures: selected skills,
 * tools, competencies and certifications, every company in the profile and the selected project names.
 */
export function figureIgnoredNames(e: Pick<Evidence, 'skills' | 'tools' | 'competencies' | 'certifications'> & Partial<Pick<Evidence, 'profileCompanies' | 'employers'>>): string[] {
  return [
    ...[...e.skills, ...e.tools, ...e.competencies, ...e.certifications].map((c) => c.name),
    ...(e.profileCompanies ?? []),
    ...(e.employers ?? []).flatMap((emp) => emp.projects.map((p) => p.name)),
  ]
}

/** The text a SUMMARY's figures may also be checked against: the same as for bullets, plus the (capped) role overview the writer was shown. Never used for a bullet. */
export function summaryEvidenceTexts(e: EmployerEvidence): string[] {
  return e.overview?.trim() ? [...evidenceTexts(e), e.overview] : evidenceTexts(e)
}

/** The text a writer's figures and names may be checked against: the activities' text and impact. */
export function evidenceTexts(e: EmployerEvidence): string[] {
  return [...e.activities.flatMap((a) => [a.text, a.impact ?? '']), ...e.projects.map((p) => `${p.name}\n${p.text}`)]
}

const dayMs = (d: Date) => d.getTime()

/**
 * The employer a selected project belongs to, or why it has none. Order of
 * rules: (1) the project's own `experienceId` names a role of an employer in
 * the selection; (2) with no `experienceId`, the employer (in the selection's
 * order) whose stint contains the project's start date (its end date when it
 * has no start); (3) otherwise none. An employer listed without bullets cannot
 * carry evidence, so a project that belongs to one is unrouted too.
 */
export function routeProject(
  employers: ReadonlyArray<{ employer: SelectedEmployer }>,
  project: { experienceId: string | null; startDate: Date | null; endDate: Date | null },
): { index: number } | { why: string } {
  const at = (pred: (e: SelectedEmployer) => boolean) => employers.findIndex((e) => pred(e.employer))
  let index = -1
  let how = ''
  if (project.experienceId) {
    index = at((e) => e.roles.some((r) => r.experienceId === project.experienceId))
    how = 'the role it belongs to'
    if (index < 0) return { why: 'the role it belongs to is not on the CV (its employer was left out)' }
  } else {
    const when = project.startDate ?? project.endDate
    if (!when) return { why: 'it has no role and no date, so there is no employer to attach it to' }
    const t = dayMs(when)
    index = at((e) => (e.stints?.length ? e.stints : [{ start: e.start ?? '', end: e.end }]).some((s) => {
      const from = Date.parse(s.start)
      // Roles end on a month (often stored as the 1st): the whole month of the end date still belongs to the stint.
      const endDate = s.end ? new Date(s.end) : null
      const to = endDate ? Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, 1) : Number.POSITIVE_INFINITY
      return !Number.isNaN(from) && !Number.isNaN(to) && t >= from && t < to
    }))
    how = 'the employer whose dates contain it'
    if (index < 0) return { why: 'it has no role and its date is outside every employer on the CV' }
  }
  if (employers[index].employer.headerOnly) return { why: `${how} is listed without bullets, so there is no entry to put it in` }
  return { index }
}

export function evidenceFromVault(vault: Vault, selection: CvSelection, now: Date = new Date()): Evidence {
  const byActivity = new Map<string, CandidateActivity>()
  for (const emp of buildCandidates(vault).employers) for (const a of emp.activities) byActivity.set(a.id, a)

  const scrub = makeContactScrubber(vault.identity.props.contact)
  const clean = (t: string) => scrub(stripWikilinks(t)).trim()
  const employers = selection.employers.map((employer): EmployerEvidence => {
    const roleIds = new Set(employer.roles.map((r) => r.experienceId))
    const activities: CandidateActivity[] = []
    let missing = 0
    for (const b of employer.headerOnly ? [] : employer.bullets) {
      const a = byActivity.get(b.id)
      if (a && roleIds.has(a.experienceId)) activities.push(a)
      else missing++
    }
    const rawOverview = [...employer.roles].reverse().map((r) => vault.notes.get(r.experienceId)).flatMap((n) => (n?.type === 'experience' && n.body ? [clean(n.body)] : [])).filter(Boolean).join('\n')
    return { employer, activities, projects: [], missing, overview: capOverview(rawOverview) }
  })

  // Selected projects ride along with the employer they belong to. None is dropped silently: an unroutable one is reported.
  const unroutedProjects: Evidence['unroutedProjects'] = []
  const unresolved: Evidence['unresolved'] = []
  const projectNotes: string[] = []
  for (const { id } of selection.projects) {
    const n = vault.notes.get(id)
    if (n?.type !== 'project') { unresolved.push({ section: 'projects', id }); continue }
    const routed = routeProject(employers, n.props)
    const label = n.props.name
    if (!('index' in routed)) { unroutedProjects.push({ name: label, why: routed.why }); continue }
    // An atom that is already a bullet of this employer is not repeated in the project's text.
    const taken = new Set(employers[routed.index].activities.map((a) => a.id))
    const { text, atoms, thin } = projectEvidenceText(n, vault, { excludeAtomIds: taken })
    const dropped = atoms.filter((a) => taken.has(a.id)).length
    if (dropped > 0) projectNotes.push(`Project "${label}": ${dropped === 1 ? '1 achievement is' : `${dropped} achievements are`} already a bullet of its own, so ${dropped === 1 ? 'it is' : 'they are'} not repeated in the project text.`)
    employers[routed.index].projects.push({ id, name: label, text, thin })
  }

  const caps = (ids: ReadonlyArray<{ id: string }>, section: string): CapabilityEvidence[] =>
    ids.flatMap(({ id }) => {
      const n = vault.notes.get(id)
      if (n?.type !== 'capability') unresolved.push({ section, id })
      return n?.type === 'capability'
        ? [{ id, name: n.props.name, category: n.props.category, level: n.props.level, claimed: isClaimedCapability(vault, n, now) }]
        : []
    })

  // Rank among the certifications that will actually be rendered: an expired or removed first pick leaves the next one rank 0.
  // The weak-certification rule applies to a code-chosen (fallback) selection too: its order is by relevance.
  const certifications: CertificationEvidence[] = []
  for (const { id } of selection.certifications) {
    const n = vault.notes.get(id)
    // A short course the profile files under Education is offered as a certification (candidates.ts).
    const course = n?.type === 'education' ? n.props : null
    if (n?.type !== 'certification' && !course) { unresolved.push({ section: 'certifications', id }); continue }
    const rank = certifications.filter((c) => certificationStatus(c, now) !== 'expired').length
    const c = course
      ? { id, name: `${course.qualification}${course.field ? ` in ${course.field}` : ''}`, issuer: course.institution, issueDate: course.endDate, expiryDate: null as Date | null }
      : { id, name: (n as { props: { name: string } }).props.name, issuer: (n as { props: { issuer: string | null } }).props.issuer, issueDate: (n as { props: { issueDate: Date | null } }).props.issueDate, expiryDate: (n as { props: { expiryDate: Date | null } }).props.expiryDate }
    certifications.push(certificationStatus(c, now) !== 'expired' ? { ...c, rank } : c)
  }
  const education = selection.education.flatMap(({ id }) => {
    const n = vault.notes.get(id)
    if (n?.type !== 'education') unresolved.push({ section: 'education', id })
    return n?.type === 'education'
      ? [{ id, institution: n.props.institution, qualification: n.props.qualification, field: n.props.field, startDate: n.props.startDate, endDate: n.props.endDate, grade: n.props.grade }]
      : []
  })

  const experiences = notesOf(vault, 'experience')
  return {
    employers,
    skills: caps(selection.skills, 'skills'),
    tools: caps(selection.tools, 'tools'),
    competencies: caps(selection.competencies, 'competencies'),
    certifications,
    education,
    languages: notesOf(vault, 'language').map((l) => ({ name: l.props.name, proficiency: l.props.proficiency })),
    profileTitles: [...new Set(experiences.map((e) => e.props.role.trim()).filter(Boolean))],
    profileCompanies: [...new Set(experiences.map((e) => e.props.company.trim()).filter(Boolean))],
    credentials: [
      ...notesOf(vault, 'certification').map((c) => ({ name: c.props.name, inProgress: certificationStatus(c.props, now) === 'in_progress' })),
      ...notesOf(vault, 'education').flatMap((e) => [e.props.qualification, e.props.institution].map((name) => ({ name, inProgress: educationStatus(e.props, now) === 'in_progress' }))),
    ].filter((c) => c.name.trim().length >= 2),
    unroutedProjects,
    unresolved,
    projectNotes,
    claimedNames: notesOf(vault, 'capability').filter((c) => isClaimedCapability(vault, c, now)).map((c) => c.props.name),
  }
}

/**
 * The text of one activity exactly as the experience writer is shown it
 * (without its E-label); project-evidence.ts. The Review stage uses the same
 * function, so the reviewer judges a bullet against what the writer could see.
 */
export { activityPromptText }

/** A project's text exactly as the experience writer and Review are shown it: the one string projectEvidenceText built (already one line and within the cap, so the cap here is a no-op safety net). */
export function projectPromptText(p: Pick<ProjectEvidence, 'text'>): string {
  return capProjectText(p.text)
}
