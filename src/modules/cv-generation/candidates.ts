/**
 * The evidence the Select stage may choose from, each item with the profile's
 * own database id so Select can only ever return real ids (anything else is
 * dropped in code, select.ts). Built from the profile vault
 * (src/modules/profile-map), whose note ids are the row ids.
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

export type CandidateActivity = {
  id: string
  kind: 'responsibility' | 'achievement'
  text: string
  impact: string | null
  highlighted: boolean
}

export type CandidateExperience = {
  id: string
  /** "Role — Company". */
  label: string
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
}

export type Candidates = { experiences: CandidateExperience[] } & Record<FlatSection, CandidateItem[]>

export function emptyCandidates(): Candidates {
  return { experiences: [], skills: [], tools: [], competencies: [], certifications: [], education: [], projects: [] }
}

const LABEL_MAX = 90

/** Candidate list of a vault, newest role first (the vault's display order). */
export function buildCandidates(vault: Vault): Candidates {
  const c = vault.identity.props.contact
  const scrub = makeContactScrubber(c)
  const text = (s: string) => scrub(stripWikilinks(s)).trim()

  const experiences = notesOf(vault, 'experience').map((e): CandidateExperience => ({
    id: e.id,
    label: `${e.props.role} — ${e.props.company}`,
    period: formatSpan(e.props.startDate, e.props.endDate),
    activities: e.links
      .filter((l) => l.type === 'has')
      .flatMap((l) => {
        const a = vault.notes.get(l.id)
        return a?.type === 'evidence'
          ? [{
              id: a.id,
              kind: a.props.kind,
              text: text(a.props.description),
              impact: a.props.impact ? text(a.props.impact) : null,
              highlighted: a.props.highlighted,
            } satisfies CandidateActivity]
          : []
      }),
  }))

  const caps = notesOf(vault, 'capability')
  const capItem = (n: (typeof caps)[number]): CandidateItem => ({
    id: n.id,
    label: n.props.name,
    detail: [n.props.category, n.props.level, n.props.yearsOfExperience ? `${n.props.yearsOfExperience}y` : null].filter(Boolean).join(', ') || null,
    proven: n.props.status !== 'claimed',
  })

  return {
    experiences,
    skills: caps.filter((n) => n.props.kind === 'skill').map(capItem),
    tools: caps.filter((n) => n.props.kind === 'tool').map(capItem),
    competencies: caps.filter((n) => n.props.kind === 'competency').map(capItem),
    certifications: notesOf(vault, 'certification').map((n) => ({
      id: n.id,
      label: n.props.name,
      detail: n.props.issuer,
      proven: true,
    })),
    education: notesOf(vault, 'education').map((n) => ({
      id: n.id,
      label: `${n.props.qualification}${n.props.field ? ` in ${n.props.field}` : ''} — ${n.props.institution}`,
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
  for (const e of cands.experiences) {
    m.set(e.id, e.label)
    for (const a of e.activities) m.set(a.id, activityLabel(a))
  }
  for (const s of FLAT_SECTIONS) for (const i of cands[s]) m.set(i.id, i.label)
  return m
}

/** The candidate list as text for the Select prompt: every id in square brackets. */
export function candidatesToPrompt(cands: Candidates): string {
  const lines: string[] = ['## Experiences (most recent first)']
  for (const e of cands.experiences) {
    lines.push(`[${e.id}] ${e.label}${e.period ? ` (${e.period})` : ''}`)
    for (const a of e.activities) {
      const star = a.highlighted ? '⭐ ' : ''
      lines.push(`  - [${a.id}] ${star}${a.kind}: ${a.text}${a.impact ? ` — ${a.impact}` : ''}`)
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
  lines.push('Roles (most recent first):')
  for (const e of cands.experiences) {
    const achievements = e.activities.filter((a) => a.kind === 'achievement').length
    lines.push(`- ${e.label}${e.period ? ` (${e.period})` : ''}: ${e.activities.length} activities, ${achievements} achievements`)
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
