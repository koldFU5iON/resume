/**
 * Employers: the profile's roles grouped by the company they were held at.
 * Pure: no DB, no network, no model.
 *
 * Why: a person can hold several consecutive roles at one employer, and a CV
 * shows one entry per employer (docs/cv-generation.md, Decisions). Role titles
 * are facts and are never changed: the entry carries the LATEST title as its
 * heading, and the earlier ones as a progression line (sub-text) built here in
 * code with neutral wording. The profile does not record promotions, so the
 * line never says "promoted"; no model writes it.
 *
 * Grouping is by the normalised company name (the same idea as the legacy
 * generator's "merge repeated employers" setting, which is only a prompt
 * instruction and has no code to reuse). The match is exact after
 * normalisation: case, accents, punctuation, spacing, a leading "the" and a
 * trailing legal suffix (Ltd, Inc, GmbH...) are ignored; "Unity" and "Unity
 * Technologies" stay two employers. Stints that are not adjacent (A, then B,
 * then A again) are still one employer; each stint keeps its own dates in
 * `roles`, and the employer's overall span runs from its first start to its
 * last end.
 */

import { formatMonth } from '@/modules/profile-map/format'

/** One role of the profile, as grouping needs it. */
export type RoleInput = {
  experienceId: string
  company: string
  title: string
  start: Date
  end: Date | null
}

/** A role at an employer. Dates are ISO calendar dates (YYYY-MM-DD, UTC), `end` null = present. */
export type EmployerRole = {
  experienceId: string
  title: string
  start: string
  end: string | null
}

export type EmployerGroup = {
  /** Stable key: the normalised company name as a slug. Unique within a profile. */
  key: string
  /** The company as written on the most recent role. */
  company: string
  /** The title of the most recent role, exactly as in the profile. */
  latestTitle: string
  /** Overall start: the earliest role start. */
  start: string
  /** Overall end: null (present) if any role is current, else the latest end. */
  end: string | null
  /** The roles at this employer, oldest first, each with its own dates. */
  roles: EmployerRole[]
  /** Plain-text progression sub-line; null for an employer with a single role. */
  progression: string | null
}

const LEGAL_SUFFIXES = new Set(['inc', 'incorporated', 'ltd', 'limited', 'llc', 'plc', 'corp', 'corporation', 'gmbh', 'co', 'ag', 'bv', 'sa', 'srl', 'pty'])

/** Company name as a comparable slug ('' when nothing comparable is left). */
export function normaliseEmployerName(name: string): string {
  const tokens = name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[.'’]/g, '') // S.A. = SA, McDonald's = McDonalds
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  if (tokens[0] === 'the' && tokens.length > 1) tokens.shift()
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop()
  return tokens.join('-')
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const FAR_FUTURE = Number.POSITIVE_INFINITY
const endMs = (r: Pick<RoleInput, 'end'>) => (r.end ? r.end.getTime() : FAR_FUTURE)

const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']

/** "2019–2024", "2019–present", or just "2019" when the span stays inside one year. */
function yearSpan(start: string, end: string | null): string {
  const from = start.slice(0, 4)
  if (!end) return `${from}–present`
  const to = end.slice(0, 4)
  return from === to ? from : `${from}–${to}`
}

/**
 * The progression sub-line, oldest title first: "Four roles at Unity
 * (2019–present): Program Manager → Senior Program Manager". Adjacent repeats
 * of one title are shown once. Null for fewer than two roles. Neutral by
 * design: it states what the profile records, and never says "promoted".
 */
export function progressionLine(company: string, roles: readonly EmployerRole[], start: string, end: string | null): string | null {
  if (roles.length < 2) return null
  const titles: string[] = []
  for (const r of roles) if (titles[titles.length - 1] !== r.title) titles.push(r.title)
  const count = roles.length <= 10 ? NUMBER_WORDS[roles.length] : String(roles.length)
  return `${count} roles at ${company} (${yearSpan(start, end)}): ${titles.join(' → ')}`
}

/**
 * Groups roles by employer. Employers come back newest first (by their most
 * recent role: a current role beats a finished one, then the later start).
 * `roles` of an employer are oldest first (by start, then end). The latest
 * title is the most recent role by end date, then start date. Ties keep the
 * order the roles were given in. A role whose company normalises to nothing
 * is its own employer (never merged with another blank one).
 */
export function groupEmployers(roles: readonly RoleInput[]): EmployerGroup[] {
  const byKey = new Map<string, RoleInput[]>()
  for (const r of roles) {
    const key = normaliseEmployerName(r.company) || `role-${r.experienceId}`
    byKey.set(key, [...(byKey.get(key) ?? []), r])
  }
  const recency = (a: RoleInput, b: RoleInput) => endMs(b) - endMs(a) || b.start.getTime() - a.start.getTime()

  const groups = [...byKey.entries()].map(([key, members]) => {
    const latest = [...members].sort(recency)[0]
    const oldestFirst = [...members].sort((a, b) => a.start.getTime() - b.start.getTime() || endMs(a) - endMs(b))
    const employerRoles: EmployerRole[] = oldestFirst.map((r) => ({
      experienceId: r.experienceId,
      title: r.title,
      start: iso(r.start),
      end: r.end ? iso(r.end) : null,
    }))
    const start = employerRoles[0].start
    const end = members.some((m) => !m.end)
      ? null
      : iso(new Date(Math.max(...members.map((m) => m.end!.getTime()))))
    const company = latest.company.trim() || latest.company
    return {
      group: {
        key,
        company,
        latestTitle: latest.title,
        start,
        end,
        roles: employerRoles,
        progression: progressionLine(company, employerRoles, start, end),
      } satisfies EmployerGroup,
      latest,
    }
  })
  return groups.sort((a, b) => recency(a.latest, b.latest)).map((g) => g.group)
}

/** "Jan 2019 – present" for an employer's overall span. */
export function employerPeriod(start: string | null, end: string | null): string | null {
  if (!start) return null
  const from = new Date(start)
  if (Number.isNaN(from.getTime())) return null
  const to = end ? new Date(end) : null
  return `${formatMonth(from)} – ${to && !Number.isNaN(to.getTime()) ? formatMonth(to) : 'present'}`
}
