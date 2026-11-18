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
import { plainLine } from './plain'
import { ALREADY_MARKED, certificationStatus, educationStatus } from './status'

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
    ...(plainLine(summary) ? ['', plainLine(summary)] : []),
    '',
    `:::compact-list\n${bullets.map(plainLine).filter(Boolean).map((b) => `- ${b}`).join('\n')}\n:::`,
  ].join('\n')
}

// ── Skills and tools ────────────────────────────────────────────────────────

export type NameGroup = { label: string | null; names: string[] }

/** One block per group, each under its bold label when it has one. */
export function renderNameGroups(groups: readonly NameGroup[], block: 'skills' | 'inline-list'): string {
  return groups
    .filter((g) => g.names.length > 0)
    .map((g) => `${g.label && plainLine(g.label) ? `**${plainLine(g.label)}**\n\n` : ''}:::${block}\n${g.names.map((n) => `- ${oneLine(n)}`).join('\n')}\n:::`)
    .join('\n\n')
}

// ── Certifications, education, languages ────────────────────────────────────

const year = (d: Date) => String(d.getUTCFullYear())

export type Rendered = {
  markdown: string
  /** Log notes for the section row. */
  notes: string[]
  /** "Worth a quick check" notes (at most one per section). */
  checkNotes: string[]
}

/**
 * Certifications in relevance order (the selection's order), from the profile
 * as stored. The profile has no status field (status.ts reads it from the
 * data): one still in progress is written "(in progress)" and never presented
 * as held; one whose expiry date has passed is left off the CV with a log
 * note; a future expiry date is a held certification. An undated one is shown
 * without a date.
 *
 * Weak certification rule (Phase 3b): one with NEITHER an issuer NOR a date
 * cannot be checked and says little, so it is skipped (log note) unless it is
 * the first certification shown (`rank` 0 among those rendered, in Select's
 * relevance order). A certification with an issuer or a date is never skipped
 * by this rule, and neither is one that is in progress (it has no date by
 * nature). `rank` is undefined for a code-chosen (fallback) selection, so the
 * rule does not apply there.
 */
export function renderCertifications(certs: readonly CertificationEvidence[], now: Date = new Date()): Rendered {
  const notes: string[] = []
  const lines: string[] = []
  for (const c of certs) {
    const status = certificationStatus(c, now)
    if (status === 'expired') {
      notes.push(`"${c.name}" expired in ${year(c.expiryDate as Date)} and was left out.`)
      continue
    }
    // An in-progress certification is never "weak": it has no date by nature, and the CV shows it as "(in progress)".
    if (status !== 'in_progress' && !c.issuer?.trim() && !c.issueDate && !c.expiryDate && (c.rank ?? 0) > 0) {
      notes.push(`"${c.name}" has no issuer and no date, and Select did not rank it first, so it was left out.`)
      continue
    }
    const dates = [c.issueDate ? year(c.issueDate) : null, c.expiryDate ? `expires ${year(c.expiryDate)}` : null].filter(Boolean).join(', ')
    const mark = status === 'in_progress' && !ALREADY_MARKED.test(c.name) ? 'in progress' : null
    if (status === 'in_progress') notes.push(`"${c.name}" is shown as in progress.`)
    const detail = [dates, mark].filter(Boolean).join(', ')
    lines.push(`- **${oneLine(c.name)}**${c.issuer ? ` — ${oneLine(c.issuer)}` : ''}${detail ? ` (${detail})` : ''}`)
  }
  return { markdown: lines.join('\n'), notes, checkNotes: [] }
}

/**
 * Education in relevance order, from the profile as stored (status.ts):
 * - completed (a past end date): the span and the grade;
 * - in progress (an end date in the future, in-progress wording, or no end
 *   date and a start within the last few years): "from <year>, in progress",
 *   never a grade;
 * - no end date and an older start: no span and no status, because the CV
 *   claims neither completion nor progress. One check note asks the owner to
 *   add the end date.
 */
export function renderEducation(items: readonly EducationEvidence[], now: Date = new Date()): Rendered {
  const notes: string[] = []
  const undated: string[] = []
  const lines = items.map((e) => {
    const status = educationStatus(e, now)
    const what = `${oneLine(e.qualification)}${e.field ? ` in ${oneLine(e.field)}` : ''}`
    let detail: string
    if (status === 'completed') {
      const end = e.endDate as Date
      const span = year(e.startDate) === year(end) ? year(e.startDate) : `${year(e.startDate)} – ${year(end)}`
      detail = [span, e.grade ? oneLine(e.grade) : null].filter(Boolean).join(', ')
    } else if (status === 'in_progress') {
      detail = [`from ${year(e.startDate)}`, ALREADY_MARKED.test(what) ? null : 'in progress'].filter(Boolean).join(', ')
      notes.push(`"${what}" is shown as in progress${e.endDate === null ? ' because it has no end date and started recently' : ''}.`)
    } else {
      detail = ''
      undated.push(what)
      notes.push(`"${what}" has no end date and started long ago, so it is shown without dates or status.`)
    }
    return `- **${what}** — ${oneLine(e.institution)}${detail ? ` (${detail})` : ''}`
  })
  const checkNotes = undated.length > 0
    ? [`Education: ${undated.map((u) => `"${u}"`).join(', ')} ${undated.length === 1 ? 'has' : 'have'} no end date in your profile, so ${undated.length === 1 ? 'it is' : 'they are'} shown without dates. Add the end date to show when you finished.`]
    : []
  return { markdown: lines.join('\n'), notes, checkNotes }
}

export function renderLanguages(languages: ReadonlyArray<{ name: string; proficiency: string | null }>): string {
  const items = languages.map((l) => `- ${oneLine(l.name)}${l.proficiency ? ` (${oneLine(l.proficiency)})` : ''}`)
  return items.length > 0 ? `:::inline-list\n${items.join('\n')}\n:::` : ''
}
