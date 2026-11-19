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
 * trailing legal suffix (Ltd, Inc, GmbH...) are ignored; "Acme Cloud" and "Acme Cloud
 * Technologies" stay two employers (`relatedEmployerNotes` says so in the log).
 * Roles that are not adjacent (A, then B, then A again) are still one employer;
 * each role keeps its own dates in `roles`.
 *
 * DATES: an employer's dates are its `stints`, never a single overall span. A
 * returnee (Acme Cloud 2015-17, Globex 2017-19, Acme Cloud 2019-present) must not read
 * as "Acme Cloud 2015-present" next to Globex 2017-2019. A stint is a run of the
 * employer's roles whose dates touch, overlap or sit within STINT_GAP_MONTHS of
 * each other; `start` / `end` stay on the group only as bounds for ordering.
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

/** One continuous stretch at an employer. ISO calendar dates; `end` null = present. */
export type Stint = { start: string; end: string | null }

export type EmployerGroup = {
  /** Stable key: the normalised company name as a slug. Unique within a profile. */
  key: string
  /** The company as written on the roles: the most frequent spelling (not an all-lowercase one when another exists). */
  company: string
  /** The title of the most recent role, exactly as in the profile. */
  latestTitle: string
  /** Bounds for ordering only (earliest start; null end if any role is current). NOT for display: a returnee has gaps. Use `stints`. */
  start: string
  end: string | null
  /** The employer's dates, oldest first: its roles' ranges merged where they touch, overlap or sit within STINT_GAP_MONTHS. The only dates the CV may show. */
  stints: Stint[]
  /** The roles at this employer, oldest first, each with its own dates. */
  roles: EmployerRole[]
  /** Plain-text progression sub-line; null for an employer with a single role. */
  progression: string | null
}

/**
 * Trailing words that are not part of the name. 'company' is here ("The Walt
 * Disney Company" = "Walt Disney"). 'software', 'technologies', 'group' and the
 * like are NOT: "Acme Cloud Software" and "Orbit Software" are not safely the same
 * company as "Acme Cloud" and "Orbit", and the owner decided "Acme Cloud" and "Acme Cloud
 * Technologies" stay apart; `relatedEmployerNotes` flags such pairs instead.
 */
const LEGAL_SUFFIXES = new Set(['inc', 'incorporated', 'ltd', 'limited', 'llc', 'plc', 'corp', 'corporation', 'gmbh', 'co', 'company', 'ag', 'bv', 'sa', 'srl', 'pty'])

/** Roles of one employer that start within this many months of the previous one ending are one stint. */
export const STINT_GAP_MONTHS = 3

/** The comparable words of a company name (no case, accents, punctuation, leading "the" or trailing legal suffix). */
function nameTokens(name: string): string[] {
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
  return tokens
}

/** Company name as a comparable slug ('' when nothing comparable is left). */
export function normaliseEmployerName(name: string): string {
  return nameTokens(name).join('-')
}

/**
 * Log notes for employers whose names look related but were kept apart: one
 * name's words are all among the other's ("Acme Cloud" and "Acme Cloud Technologies").
 * Pure; at most `max` pairs are named.
 */
export function relatedEmployerNotes(companies: readonly string[], max = 3): string[] {
  const named = [...new Set(companies.map((c) => c.trim()).filter(Boolean))]
    .map((company) => ({ company, tokens: nameTokens(company) }))
    .filter((n) => n.tokens.join('-') !== '')
  const pairs: string[] = []
  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const [a, b] = [named[i], named[j]]
      if (a.tokens.join('-') === b.tokens.join('-')) continue
      const [small, big] = a.tokens.length <= b.tokens.length ? [a, b] : [b, a]
      if (small.tokens.every((t) => big.tokens.includes(t))) {
        pairs.push(`'${small.company}' and '${big.company}' were kept apart; give them the same company name in your profile to merge them.`)
      }
    }
  }
  return pairs.length > max ? [...pairs.slice(0, max), `${pairs.length - max} more employer ${pairs.length - max === 1 ? 'name looks' : 'names look'} related and ${pairs.length - max === 1 ? 'was' : 'were'} kept apart.`] : pairs
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

/** "2015–2017, 2019–present": the stints as year spans. */
export function stintYears(stints: readonly Stint[]): string {
  return stints.map((s) => yearSpan(s.start, s.end)).join(', ')
}

const addMonthsMs = (iso: string, months: number) => {
  const d = new Date(iso)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate())
}

/**
 * Merges date ranges into stints, oldest first: ranges that touch, overlap or
 * start within `gapMonths` of the previous one ending are one stint; a current
 * range (end null) runs on and absorbs everything after it. Pure.
 */
export function mergeStints(ranges: ReadonlyArray<{ start: string; end: string | null }>, gapMonths = STINT_GAP_MONTHS): Stint[] {
  const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start) || (a.end ?? '9999').localeCompare(b.end ?? '9999'))
  const stints: Stint[] = []
  for (const r of sorted) {
    const last = stints[stints.length - 1]
    if (last && (last.end === null || new Date(r.start).getTime() <= addMonthsMs(last.end, gapMonths))) {
      if (last.end !== null && (r.end === null || r.end > last.end)) last.end = r.end
    } else {
      stints.push({ start: r.start, end: r.end })
    }
  }
  return stints
}

/**
 * The progression sub-line, oldest title first: "Two roles at Acme Cloud
 * (2015–2017, 2019–present): Program Manager → Senior Program Manager". The
 * dates are the employer's stints, so a gap is never hidden. Adjacent repeats
 * of one title are shown once and the count is of the titles shown, so the
 * count and the list always agree; null when one distinct title is left.
 * Neutral by design: it states what the profile records, and never says
 * "promoted".
 */
export function progressionLine(company: string, roles: readonly EmployerRole[], stints: readonly Stint[]): string | null {
  const titles: string[] = []
  for (const r of roles) {
    const last = titles[titles.length - 1]
    if (last === undefined || last.trim().toLowerCase() !== r.title.trim().toLowerCase()) titles.push(r.title)
  }
  if (titles.length < 2) return null
  const count = titles.length <= 10 ? NUMBER_WORDS[titles.length] : String(titles.length)
  return `${count} roles at ${company} (${stintYears(stints)}): ${titles.join(' → ')}`
}

/** The spelling used most often among an employer's roles; ties and all-lowercase ones lose to a properly cased spelling, then to the latest role's. */
function pickCompanySpelling(members: readonly RoleInput[], latest: RoleInput): string {
  const counts = new Map<string, number>()
  for (const m of members) {
    const name = m.company.trim() || m.company
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const allLower = (n: string) => n === n.toLowerCase() && n !== n.toUpperCase()
  const latestName = latest.company.trim() || latest.company
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || Number(allLower(a[0])) - Number(allLower(b[0])) || Number(b[0] === latestName) - Number(a[0] === latestName),
  )[0][0]
}

/** Compares two end dates, later first; a current role (null end) is the latest, two current ones tie. */
const laterEnd = (a: Pick<RoleInput, 'end'>, b: Pick<RoleInput, 'end'>) => (endMs(a) === endMs(b) ? 0 : endMs(b) > endMs(a) ? 1 : -1)

/**
 * A role that starts later wins the employer's latest title only when it also
 * ends within this many months of the earlier-starting role's end (or is
 * current). A nested role (an "Interim Head" 2019-2020 inside a "Program
 * Manager" 2016-2023) ended years before the person left, so it does not
 * show on the heading.
 */
export const LATEST_TITLE_END_TOLERANCE_MONTHS = 6

/**
 * Which of two roles at ONE employer is the later one (negative: `a` is later).
 * 1. A current role (no end date) wins; of two current roles the later start.
 * 2. Otherwise the LATER START wins, but only when its end is no more than
 *    LATEST_TITLE_END_TOLERANCE_MONTHS before the other role's end; a role that
 *    starts later but finished much earlier (it was nested inside the longer
 *    one) loses to the role that kept running.
 * 3. Equal starts: the later end.
 * Why not the end date first: roles in a promotion chain often share or overlap
 * end dates (one "left the company" date entered on each, or an earlier role
 * left open a month longer), and then the end date picks the oldest title
 * (Initech: Co-ordinator, Executive, Manager showed the Co-ordinator title).
 * Exported for tests.
 */
export function laterRole(a: RoleInput, b: RoleInput): number {
  const current = Number(b.end === null) - Number(a.end === null)
  if (current !== 0) return current
  const byStart = b.start.getTime() - a.start.getTime()
  if (byStart === 0) return laterEnd(a, b)
  if (a.end === null) return byStart // both current: the later start
  // Both finished, different starts: the later-starting role must not have ended well before the other.
  const [later, earlier] = byStart > 0 ? [b, a] : [a, b]
  const floor = Date.UTC(earlier.end!.getUTCFullYear(), earlier.end!.getUTCMonth() - LATEST_TITLE_END_TOLERANCE_MONTHS, earlier.end!.getUTCDate())
  const laterWins = later.end!.getTime() >= floor
  return laterWins === (later === a) ? -1 : 1
}

/**
 * How recently a person worked at an EMPLOYER (negative: `a` is more recent):
 * any current role first, then the latest end date over all its roles (a current
 * role counts as the latest possible end), then the later start of its latest
 * role, so of two current employers the one started more recently comes first. This is employer-level on purpose: when you
 * left a company is what orders a work history, and it does not have the
 * latest-title flaw (it never reads one role's end date as the title's).
 */
type EmployerRecency = { current: boolean; end: number; start: number }
const byEmployerRecency = (a: EmployerRecency, b: EmployerRecency) =>
  Number(b.current) - Number(a.current) || (a.end === b.end ? 0 : b.end > a.end ? 1 : -1) || b.start - a.start

/**
 * Groups roles by employer. Employers come back newest first (by when they
 * were last worked at: a current role beats a finished one, then the latest
 * end date, then the later start of the latest role). `roles` of an employer
 * are oldest first (by start, then end). The latest title is the title of the
 * latest role by `laterRole` (current role, else the later START unless it
 * ended more than LATEST_TITLE_END_TOLERANCE_MONTHS before the other role, end
 * date only as the tiebreak for equal starts). Ties keep the order the roles were given in. A role whose
 * company normalises to nothing is its own employer (never merged with another
 * blank one).
 */
export function groupEmployers(roles: readonly RoleInput[]): EmployerGroup[] {
  const byKey = new Map<string, RoleInput[]>()
  for (const r of roles) {
    const key = normaliseEmployerName(r.company) || `role-${r.experienceId}`
    byKey.set(key, [...(byKey.get(key) ?? []), r])
  }

  const groups = [...byKey.entries()].map(([key, members]) => {
    const latest = members.reduce((best, r) => (laterRole(r, best) < 0 ? r : best))
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
    const stints = mergeStints(employerRoles)
    const company = pickCompanySpelling(members, latest)
    const recency: EmployerRecency = {
      current: members.some((m) => !m.end),
      // A current role is the latest possible end, so two current employers tie here and fall through to the start date.
      end: Math.max(...members.map((m) => (m.end ? m.end.getTime() : FAR_FUTURE))),
      start: latest.start.getTime(),
    }
    return {
      recency,
      group: {
        key,
        company,
        latestTitle: latest.title,
        start,
        end,
        stints,
        roles: employerRoles,
        progression: progressionLine(company, employerRoles, stints),
      } satisfies EmployerGroup,
    }
  })
  return groups.sort((a, b) => byEmployerRecency(a.recency, b.recency)).map((g) => g.group)
}

/**
 * "Jan 2015 – Dec 2017, Jan 2019 – present": an employer's dates as its stints.
 * Rows stored before stints existed have none: they read as one stint from
 * `start` to `end`.
 */
export function employerPeriod(e: { start: string | null; end: string | null; stints?: readonly Stint[] }): string | null {
  const stints = e.stints && e.stints.length > 0 ? e.stints : e.start ? [{ start: e.start, end: e.end }] : []
  const parts = stints.flatMap((s) => {
    const from = new Date(s.start)
    if (Number.isNaN(from.getTime())) return []
    const to = s.end ? new Date(s.end) : null
    return [`${formatMonth(from)} – ${to && !Number.isNaN(to.getTime()) ? formatMonth(to) : 'present'}`]
  })
  return parts.length > 0 ? parts.join(', ') : null
}
