/**
 * The evidence the Select stage may choose from, each item with the profile's
 * own database id so Select can only ever return real ids (anything else is
 * dropped in code, select.ts). Built from the profile vault
 * (src/modules/profile-map), whose note ids are the row ids.
 *
 * Roles are grouped by employer (employers.ts): Select chooses employers and
 * activities, never single roles. Every activity keeps the id of the role it
 * came from.
 *
 * Contact details are scrubbed from free text like serializeProfileForLLM does
 * with pii off. Pure: no DB, no network.
 */

import { formatSpan, oneLine } from '@/modules/profile-map/format'
import { notesOf } from '@/modules/profile-map/build'
import { makeContactScrubber } from '@/modules/profile-map/pii'
import { stripWikilinks } from '@/modules/profile-map/links'
import type { Vault } from '@/modules/profile-map/types'
import { FLAT_SECTIONS, type FlatSection } from './caps'
import { countOf } from './text'
import { employerPeriod, groupEmployers, type EmployerGroup } from './employers'
import { isThinProject } from './write/limits'
import { ALREADY_MARKED, certificationStatus, educationStatus, isClaimedCapability, isDegreeLike } from './write/status'

export type CandidateActivity = {
  id: string
  /** The role (experience id) the activity belongs to: provenance for fact-checking. */
  experienceId: string
  kind: 'responsibility' | 'achievement'
  text: string
  impact: string | null
  highlighted: boolean
}

/** One employer: the profile's roles at one company, with all their activities (newest role first). */
export type CandidateEmployer = EmployerGroup & {
  /** "Latest title — Company". */
  label: string
  /** "Jan 2015 – Dec 2017, Jan 2019 – present": the stints, never one overall span. */
  period: string | null
  activities: CandidateActivity[]
}

export type CandidateItem = {
  id: string
  label: string
  /** Level, issuer, qualification... one short line for the model; null when there is none. */
  detail: string | null
  /** Skills, tools and competencies: backed by evidence or a certification in the profile. */
  proven: boolean
  /** Certifications only: the issue date (ISO), when the profile has one. */
  issued?: string | null
  /** Certifications only: not finished (status.ts). */
  inProgress?: boolean
  /** Certifications only: the expiry date has passed, so the CV leaves it out. */
  expired?: boolean
  /** Projects only: only a title, no text to write from (limits.ts isThinProject). */
  thin?: boolean
}

export type Candidates = { employers: CandidateEmployer[] } & Record<FlatSection, CandidateItem[]>

export function emptyCandidates(): Candidates {
  return { employers: [], skills: [], tools: [], competencies: [], certifications: [], education: [], projects: [] }
}

const LABEL_MAX = 90

/** Tells Brief and Select that a certification or education is not finished (status.ts). */
const markInProgress = (label: string, inProgress: boolean) => (inProgress && !ALREADY_MARKED.test(label) ? `${label} (in progress)` : label)

/** Candidate list of a vault, newest employer first. */
export function buildCandidates(vault: Vault, now: Date = new Date()): Candidates {
  const c = vault.identity.props.contact
  const scrub = makeContactScrubber(c)
  const text = (s: string) => scrub(stripWikilinks(s)).trim()

  const notes = notesOf(vault, 'experience')
  const activitiesOf = (e: (typeof notes)[number]): CandidateActivity[] =>
    e.links
      .filter((l) => l.type === 'has')
      .flatMap((l) => {
        const a = vault.notes.get(l.id)
        return a?.type === 'evidence'
          ? [{
              id: a.id,
              experienceId: e.id,
              kind: a.props.kind,
              text: text(a.props.description),
              impact: a.props.impact ? text(a.props.impact) : null,
              highlighted: a.props.highlighted,
            } satisfies CandidateActivity]
          : []
      })
  const activitiesByRole = new Map(notes.map((e) => [e.id, activitiesOf(e)]))
  const employers = groupEmployers(
    notes.map((e) => ({ experienceId: e.id, company: e.props.company, title: e.props.role, start: e.props.startDate, end: e.props.endDate })),
  ).map((g): CandidateEmployer => ({
    ...g,
    label: `${g.latestTitle} — ${g.company}`,
    period: employerPeriod(g),
    // The newest role's activities first, each role's in profile order.
    activities: [...g.roles].reverse().flatMap((r) => activitiesByRole.get(r.experienceId) ?? []),
  }))

  const caps = notesOf(vault, 'capability')
  const capItem = (n: (typeof caps)[number]): CandidateItem => ({
    id: n.id,
    label: n.props.name,
    detail: [n.props.category, n.props.level, n.props.yearsOfExperience ? `${n.props.yearsOfExperience}y` : null].filter(Boolean).join(', ') || null,
    proven: !isClaimedCapability(vault, n, now),
  })

  return {
    employers,
    skills: caps.filter((n) => n.props.kind === 'skill').map(capItem),
    tools: caps.filter((n) => n.props.kind === 'tool').map(capItem),
    competencies: caps.filter((n) => n.props.kind === 'competency').map(capItem),
    certifications: notesOf(vault, 'certification').map((n) => ({
      id: n.id,
      label: markInProgress(n.props.name, certificationStatus(n.props, now) === 'in_progress'),
      detail: [n.props.issuer, n.props.issueDate ? String(n.props.issueDate.getUTCFullYear()) : null].filter(Boolean).join(', ') || null,
      proven: true,
      issued: n.props.issueDate ? n.props.issueDate.toISOString().slice(0, 10) : null,
      inProgress: certificationStatus(n.props, now) === 'in_progress',
      expired: certificationStatus(n.props, now) === 'expired',
    })),
    // A short course or certificate is not a degree or diploma: never an Education candidate.
    education: notesOf(vault, 'education').filter((n) => isDegreeLike(n.props.qualification)).map((n) => ({
      id: n.id,
      label: markInProgress(`${n.props.qualification}${n.props.field ? ` in ${n.props.field}` : ''} — ${n.props.institution}`, educationStatus(n.props, now) === 'in_progress'),
      detail: formatSpan(n.props.startDate, n.props.endDate),
      proven: true,
    })),
    projects: notesOf(vault, 'project')
      .filter((n) => n.props.status !== 'archived')
      .map((n) => ({
        id: n.id,
        label: n.props.name,
        detail: oneLine(text(n.props.description), LABEL_MAX) || null,
        proven: true,
        thin: isThinProject({ name: n.props.name, text: [n.props.description, ...n.props.highlights].map((t) => text(t)).join('\n') }),
      })),
  }
}

/** A short label for an activity in lists and logs. */
export function activityLabel(a: Pick<CandidateActivity, 'text'>): string {
  return oneLine(a.text, LABEL_MAX)
}

/** id → display label of every candidate, for logs and drop records. */
export function labelIndex(cands: Candidates): Map<string, string> {
  const m = new Map<string, string>()
  for (const e of cands.employers) {
    m.set(e.key, e.label)
    for (const a of e.activities) m.set(a.id, activityLabel(a))
  }
  for (const s of FLAT_SECTIONS) for (const i of cands[s]) m.set(i.id, i.label)
  return m
}

/** The candidate list as text for the Select prompt: every id in square brackets. */
export function candidatesToPrompt(cands: Candidates): string {
  const lines: string[] = ['## Employers (most recent first)']
  for (const e of cands.employers) {
    lines.push(`[${e.key}] ${e.company}: latest title ${e.latestTitle}${e.period ? ` (${e.period})` : ''}`)
    if (e.progression) lines.push(`  ${e.progression}`)
    const roleTitle = new Map(e.roles.map((r) => [r.experienceId, r.title]))
    for (const a of e.activities) {
      const star = a.highlighted ? '⭐ ' : ''
      const asRole = e.roles.length > 1 ? `(as ${roleTitle.get(a.experienceId) ?? 'a role here'}) ` : ''
      lines.push(`  - [${a.id}] ${asRole}${star}${a.kind}: ${a.text}${a.impact ? ` — ${a.impact}` : ''}`)
    }
  }
  const flat: Array<[FlatSection, string]> = [
    ['skills', 'Skills'], ['tools', 'Tools'], ['competencies', 'Competencies'],
    ['certifications', 'Certifications'], ['education', 'Education'], ['projects', 'Projects'],
  ]
  for (const [key, title] of flat) {
    lines.push('', `## ${title}`)
    if (cands[key].length === 0) lines.push('(none)')
    for (const i of cands[key]) lines.push(`[${i.id}] ${i.label}${i.detail ? ` (${i.detail})` : ''}${key !== 'certifications' && key !== 'education' && key !== 'projects' && !i.proven ? ' [claimed only]' : ''}`)
  }
  return lines.join('\n')
}

/**
 * A short outline of the profile for the Brief: titles and names only, not
 * every activity (the Brief decides strategy; Select chooses evidence).
 */
export function profileOutline(headline: string | null, cands: Candidates): string {
  const lines: string[] = []
  if (headline) lines.push(`Headline: ${headline}`)
  lines.push('Employers (most recent first; role titles are facts and cannot be changed):')
  for (const e of cands.employers) {
    const achievements = e.activities.filter((a) => a.kind === 'achievement').length
    lines.push(`- ${e.label}${e.period ? ` (${e.period})` : ''}: ${countOf(e.activities.length, 'activity', 'activities')}, ${countOf(achievements, 'achievement')}`)
    if (e.progression) lines.push(`  ${e.progression}`)
  }
  const names = (items: CandidateItem[], max: number) => items.slice(0, max).map((i) => i.label).join(', ') + (items.length > max ? `, … (${items.length} in all)` : '')
  if (cands.skills.length > 0) lines.push(`Skills: ${names(cands.skills, 30)}`)
  if (cands.tools.length > 0) lines.push(`Tools: ${names(cands.tools, 30)}`)
  if (cands.competencies.length > 0) lines.push(`Competencies: ${names(cands.competencies, 20)}`)
  if (cands.certifications.length > 0) lines.push(`Certifications: ${names(cands.certifications, 10)}`)
  if (cands.education.length > 0) lines.push(`Education: ${names(cands.education, 5)}`)
  if (cands.projects.length > 0) lines.push(`Projects: ${names(cands.projects, 10)}`)
  return lines.join('\n')
}
