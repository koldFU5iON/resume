/**
 * Everything the writers must not touch, rendered BY CODE from profile data:
 * employer headings (company, latest title, dates, progression), header-only
 * employers, certifications, education, languages, and the skills and tools
 * blocks. Titles, companies and dates are facts: no model writes them.
 * Pure: no DB, no network, no model.
 */

import { employerPeriod } from '../employers'
import type { SelectedEmployer } from '../schema'
import type { CertificationEvidence, EducationEvidence } from './evidence'

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The heading block of an employer: company, latest title with dates, and the progression sub-line. */
export function renderEmployerHeader(e: SelectedEmployer): string {
  const period = employerPeriod(e)
  const parts = [`### ${oneLine(e.company)}`, `**${oneLine(e.latestTitle)}**${period ? ` · ${period}` : ''}`]
  if (e.progression) parts.push('', `_${oneLine(e.progression)}_`)
  return parts.join('\n')
}

/** A header-only employer: heading, title, dates, progression; nothing else, no model. */
export function renderHeaderOnlyEmployer(e: SelectedEmployer): string {
  return renderEmployerHeader(e)
}

/** The heading block, the one-sentence summary and the bullet block of an employer that shows bullets. */
export function renderEmployerEntry(e: SelectedEmployer, summary: string, bullets: readonly string[]): string {
  return [
    renderEmployerHeader(e),
    ...(summary.trim() ? ['', oneLine(summary)] : []),
    '',
    `:::compact-list\n${bullets.map((b) => `- ${oneLine(b)}`).join('\n')}\n:::`,
  ].join('\n')
}

// ── Skills and tools ────────────────────────────────────────────────────────

export type NameGroup = { label: string | null; names: string[] }

/** One block per group, each under its bold label when it has one. */
export function renderNameGroups(groups: readonly NameGroup[], block: 'skills' | 'inline-list'): string {
  return groups
    .filter((g) => g.names.length > 0)
    .map((g) => `${g.label ? `**${oneLine(g.label)}**\n\n` : ''}:::${block}\n${g.names.map((n) => `- ${oneLine(n)}`).join('\n')}\n:::`)
    .join('\n\n')
}

// ── Certifications, education, languages ────────────────────────────────────

const IN_PROGRESS_WORDING = /\b(in[\s-]?progress|ongoing|expected|studying|working towards|pursuing)\b/i
const ALREADY_MARKED = /in[\s-]?progress/i

const year = (d: Date) => String(d.getUTCFullYear())

export type Rendered = { markdown: string; notes: string[] }

/**
 * Certifications in relevance order (the selection's order), from the profile
 * as stored. The profile has no status field, so "in progress" is read from the
 * data: an issue date in the future, or wording in the name. Such an entry is
 * written "(in progress)" and never presented as held. An undated certification
 * is shown without a date.
 */
export function renderCertifications(certs: readonly CertificationEvidence[], now: Date = new Date()): Rendered {
  const notes: string[] = []
  const lines = certs.map((c) => {
    const inProgress = (c.issueDate !== null && c.issueDate.getTime() > now.getTime()) || IN_PROGRESS_WORDING.test(c.name)
    const dates = [c.issueDate ? year(c.issueDate) : null, c.expiryDate ? `expires ${year(c.expiryDate)}` : null].filter(Boolean).join(', ')
    const mark = inProgress && !ALREADY_MARKED.test(c.name) ? 'in progress' : null
    if (inProgress) notes.push(`"${c.name}" is shown as in progress.`)
    const detail = [dates, mark].filter(Boolean).join(', ')
    return `- **${oneLine(c.name)}**${c.issuer ? ` — ${oneLine(c.issuer)}` : ''}${detail ? ` (${detail})` : ''}`
  })
  return { markdown: lines.join('\n'), notes }
}

/**
 * Education in relevance order, from the profile as stored. An entry with no
 * end date, an end date in the future, or in-progress wording is written
 * "(in progress)": it is never presented as completed. The grade is shown only
 * for a completed entry.
 */
export function renderEducation(items: readonly EducationEvidence[], now: Date = new Date()): Rendered {
  const notes: string[] = []
  const lines = items.map((e) => {
    const wording = [e.qualification, e.field ?? '', e.grade ?? ''].some((t) => IN_PROGRESS_WORDING.test(t))
    const inProgress = e.endDate === null || e.endDate.getTime() > now.getTime() || wording
    const what = `${oneLine(e.qualification)}${e.field ? ` in ${oneLine(e.field)}` : ''}`
    const span = e.endDate && !(e.endDate.getTime() > now.getTime())
      ? (year(e.startDate) === year(e.endDate) ? year(e.startDate) : `${year(e.startDate)} – ${year(e.endDate)}`)
      : `from ${year(e.startDate)}`
    const mark = inProgress && !ALREADY_MARKED.test(what) ? 'in progress' : null
    if (inProgress) notes.push(`"${what}" is shown as in progress${e.endDate === null ? ' because the profile has no end date for it' : ''}.`)
    const detail = [span, !inProgress && e.grade ? oneLine(e.grade) : null, mark].filter(Boolean).join(', ')
    return `- **${what}** — ${oneLine(e.institution)}${detail ? ` (${detail})` : ''}`
  })
  return { markdown: lines.join('\n'), notes }
}

export function renderLanguages(languages: ReadonlyArray<{ name: string; proficiency: string | null }>): string {
  const items = languages.map((l) => `- ${oneLine(l.name)}${l.proficiency ? ` (${oneLine(l.proficiency)})` : ''}`)
  return items.length > 0 ? `:::inline-list\n${items.join('\n')}\n:::` : ''
}
