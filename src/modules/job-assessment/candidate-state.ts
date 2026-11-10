/**
 * Builds the `candidate` part of the Jev judge state from a profile snapshot
 * (spec §4.2 `buildCandidateState`), plus the structured role timeline that
 * years.ts does its month arithmetic on.
 *
 * Rules (spec §1, §4.2):
 * - Every role is kept, newest first, with its dates. The text is never cut
 *   from the end of the whole profile: a cut that drops older roles makes
 *   every years estimate collapse to the latest role.
 * - Each role's description is capped (1,200 chars, cut at a sentence end).
 * - No name, email, phone, links or address. Emails and URLs inside free text
 *   are removed too, and any exact copy of the contact fields.
 * - `dates` is text for people to read; Jev is never asked to do date maths.
 *
 * Size budget: CANDIDATE_STATE_CHAR_BUDGET (32k chars of JSON ≈ 8k tokens at
 * ~4 chars/token, the spec's target). A profile over budget is shrunk by
 * lowering the per-role cap step by step, then trimming skills — roles and
 * dates are never dropped.
 *
 * Pure module: consumes the ProfileSnapshot type only.
 */

import type { ProfileSnapshot } from '@/modules/profile/snapshot'

/** ≈ 8k tokens of JSON at ~4 chars/token (spec §4.2 target). */
export const CANDIDATE_STATE_CHAR_BUDGET = 32_000

/** Per-role description cap (spec §4.2). */
export const ROLE_DESCRIPTION_MAX_CHARS = 1_200

/** headline + summary cap (spec §4.2). */
export const SUMMARY_MAX_CHARS = 600

/** Per-role caps tried in order when the state is over budget. */
const SHRINK_STEPS = [ROLE_DESCRIPTION_MAX_CHARS, 900, 600, 400, 250, 150, 80]
const SKILLS_PER_CATEGORY_WHEN_SHRINKING = 12

export interface CandidateRole {
  title: string
  company: string
  /** Human text, e.g. "Jul 2024 – present". */
  dates: string
  description: string
}

/** The `candidate` state object sent to Jev. Keys are stable: `role_1` is the newest role. */
export interface CandidateState {
  summary: string
  roles: Record<string, CandidateRole>
  education: string[]
  certifications: string[]
  languages: string[]
  /** Skill names grouped by category. Competencies appear under "Competencies". */
  skills: Record<string, string[]>
}

/** Calendar month; `m` is 1–12. */
export interface YearMonth {
  y: number
  m: number
}

/** One role's dated span, for years arithmetic. Same order and keys as `state.roles`. */
export interface RoleTimelineEntry {
  key: string
  /** Role title, for display in years breakdowns. */
  label: string
  start: YearMonth
  end: YearMonth | 'present'
}

export interface CandidateStateResult {
  state: CandidateState
  timeline: RoleTimelineEntry[]
}

/**
 * The snapshot plus the profile's free-text summary. ProfileSnapshot has no
 * `summary` field today; pass `Profile.summary` alongside it.
 */
export type CandidateSource = ProfileSnapshot & { summary?: string | null }

// ── Text helpers ────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Dates come from Postgres DATE/timestamp columns; read them as UTC calendar months. */
export function toYearMonth(d: Date): YearMonth {
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }
}

function formatYearMonth(ym: YearMonth): string {
  return `${MONTHS[ym.m - 1]} ${ym.y}`
}

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b(?:linkedin\.com|github\.com)\/\S*/gi

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Removes emails, URLs and exact copies of the contact fields from free text. */
function makeScrubber(snapshot: CandidateSource): (text: string) => string {
  const exact = [snapshot.email, snapshot.phone, snapshot.website, snapshot.linkedin]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v && v.length >= 4))
  const exactRe = exact.length > 0 ? new RegExp(exact.map(escapeRegExp).join('|'), 'gi') : null
  const name = snapshot.name?.trim()
  const nameRe = name && name.length >= 3 ? new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi') : null

  return (text: string) => {
    let out = text
    if (exactRe) out = out.replace(exactRe, '')
    out = out.replace(EMAIL_RE, '').replace(URL_RE, '')
    if (nameRe) out = out.replace(nameRe, 'The candidate')
    return out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim()
  }
}

/**
 * Cuts `text` to at most `max` chars at the last sentence end (". ", "! ",
 * "? " or a line break). Falls back to the last word boundary + "…" when no
 * sentence end lies in the second half of the window.
 */
export function cutAtSentence(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  const window = t.slice(0, max)
  let cut = -1
  const re = /[.!?](?=\s)|\n/g
  for (let m = re.exec(window); m; m = re.exec(window)) cut = m.index + (m[0] === '\n' ? 0 : 1)
  // A period right at the end of the window also ends a sentence.
  if (/[.!?]$/.test(window) && /\s/.test(t[max] ?? ' ')) cut = max
  if (cut >= max / 2) return window.slice(0, cut).trim()
  const space = window.lastIndexOf(' ', max - 1)
  return `${window.slice(0, space > max / 2 ? space : max - 1).trimEnd()}…`
}

function sentence(s: string): string {
  const t = s.trim()
  if (!t) return ''
  return /[.!?…]$/.test(t) ? t : `${t}.`
}

/** Role summary, then activities (highlighted first, as the snapshot orders them) as sentences. */
function roleText(exp: ProfileSnapshot['experiences'][number], scrub: (s: string) => string): string {
  const parts: string[] = []
  if (exp.summary?.trim()) parts.push(scrub(exp.summary))
  for (const a of exp.activities) {
    const desc = scrub(a.description)
    if (!desc) continue
    const impact = a.impact ? scrub(a.impact) : ''
    parts.push(sentence(impact ? `${desc.replace(/[.!?]$/, '')} (${impact.replace(/[.!?]$/, '')})` : desc))
  }
  return parts.filter(Boolean).join('\n')
}

// ── Builder ─────────────────────────────────────────────────────────────────

interface Built {
  state: CandidateState
  timeline: RoleTimelineEntry[]
}

function build(snapshot: CandidateSource, roleCap: number, skillsPerCategory: number | null): Built {
  const scrub = makeScrubber(snapshot)

  const summary = cutAtSentence(
    [snapshot.headline, snapshot.summary].map((s) => (s ? scrub(s) : '')).filter(Boolean).map(sentence).join(' '),
    SUMMARY_MAX_CHARS,
  )

  // Newest first by start date; stable for equal dates.
  const experiences = snapshot.experiences
    .map((exp, i) => ({ exp, i }))
    .sort((a, b) => b.exp.startDate.getTime() - a.exp.startDate.getTime() || a.i - b.i)
    .map(({ exp }) => exp)

  const roles: Record<string, CandidateRole> = {}
  const timeline: RoleTimelineEntry[] = []
  experiences.forEach((exp, i) => {
    const key = `role_${i + 1}`
    const start = toYearMonth(exp.startDate)
    const end = exp.endDate ? toYearMonth(exp.endDate) : 'present'
    roles[key] = {
      title: scrub(exp.role),
      company: scrub(exp.company),
      dates: `${formatYearMonth(start)} – ${end === 'present' ? 'present' : formatYearMonth(end)}`,
      description: cutAtSentence(roleText(exp, scrub), roleCap),
    }
    timeline.push({ key, label: scrub(exp.role), start, end })
  })

  const education = snapshot.educations.map((ed) => {
    const field = ed.field ? ` in ${ed.field}` : ''
    const years = ed.endDate ? ` (${ed.endDate.getUTCFullYear()})` : ' (in progress)'
    const grade = ed.grade ? `, ${ed.grade}` : ''
    return scrub(`${ed.qualification}${field}, ${ed.institution}${years}${grade}`)
  })

  const certifications = snapshot.certifications.map((c) => {
    const issuer = c.issuer ? `, ${c.issuer}` : ''
    const year = c.issueDate ? ` (${c.issueDate.getUTCFullYear()})` : ''
    return scrub(`${c.name}${issuer}${year}`)
  })

  const languages = snapshot.languages.map((l) => (l.proficiency ? `${l.name} (${l.proficiency})` : l.name))

  const skills: Record<string, string[]> = {}
  for (const s of snapshot.skills) {
    const category = s.category?.trim() || 'Other'
    ;(skills[category] ??= []).push(s.name)
  }
  if (snapshot.competencies.length > 0) {
    ;(skills.Competencies ??= []).push(...snapshot.competencies.map((c) => c.name))
  }
  if (skillsPerCategory !== null) {
    for (const k of Object.keys(skills)) skills[k] = skills[k].slice(0, skillsPerCategory)
  }

  return { state: { summary, roles, education, certifications, languages, skills }, timeline }
}

export function candidateStateSize(state: CandidateState): number {
  return JSON.stringify(state).length
}

/**
 * Builds the judge's `candidate` state and the role timeline (same keys, newest
 * first). Stays under CANDIDATE_STATE_CHAR_BUDGET by shrinking role
 * descriptions, then skill lists; roles and dates are always kept, so a
 * pathological profile (dozens of roles) may still exceed it.
 */
export function buildCandidateState(snapshot: CandidateSource): CandidateStateResult {
  let built = build(snapshot, SHRINK_STEPS[0], null)
  for (const cap of SHRINK_STEPS.slice(1)) {
    if (candidateStateSize(built.state) <= CANDIDATE_STATE_CHAR_BUDGET) break
    built = build(snapshot, cap, null)
  }
  if (candidateStateSize(built.state) > CANDIDATE_STATE_CHAR_BUDGET) {
    built = build(snapshot, SHRINK_STEPS[SHRINK_STEPS.length - 1], SKILLS_PER_CATEGORY_WHEN_SHRINKING)
  }
  return built
}
