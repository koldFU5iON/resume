/**
 * What a project says, for Select, the writers, Review and the profile-readiness
 * thin check: ONE function, so none of them can disagree. A project's text is
 * its description, a deterministic digest of its notes (no model) and the
 * achievements attached to it. The profile-map body is description + notes
 * (build.ts); reading only `description` and `highlights` left a project with
 * an empty description and a long notes body "thin" and hid the figures of a
 * long notes body.
 *
 * Pure: no DB, no network.
 */

import { makeContactScrubber } from '@/modules/profile-map/pii'
import { stripWikilinks } from '@/modules/profile-map/links'
import type { ProjectNote, Vault } from '@/modules/profile-map/types'
import { PROJECT_EVIDENCE_MAX_CHARS, isThinProject } from './write/limits'

export const RESULT_WORDING = /\b(?:reduced|increased|grew|cut|saved|delivered|generated|launched|achieved|won|drove|scaled|doubled|tripled|halved|improved|boosted|accelerated|exceeded|surpassed|secured|earned|raised|expanded|eliminated|enabled|unlocked|resulting|resulted|led to|from\s+\S+\s+to)\b/i

/** A heading with one of these words makes every line under it a result line. */
const RESULT_HEADING = /result|outcome|metric|impact|learning/i
/** The first paragraph of the notes is always kept, up to this many characters. */
export const NOTES_LEAD_MAX_CHARS = 300
/** The description is kept up to this many characters when the budget is tight. */
const DESCRIPTION_MAX_CHARS = 500
/** Notes digest budget kept free when atoms are long. */
const DIGEST_MIN_CHARS = 500

export type ProjectAtom = { id: string; kind: 'responsibility' | 'achievement'; text: string; impact: string | null; highlighted: boolean }

/** One atom as the experience writer is shown it (without its label). Review uses the same function. */
export function activityPromptText(a: { kind: string; text: string; impact: string | null }): string {
  return `${a.kind}: ${a.text}${a.impact ? ` — impact: ${a.impact}` : ''}`
}

const keyOf = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

function cutWords(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const at = cut.search(/\s\S*$/)
  return `${(at > max / 2 ? cut.slice(0, at) : cut).trimEnd()}…`
}

/** Markdown simplified to plain lines: headings reported separately, emphasis, bullets, quotes, link syntax and table pipes removed. */
function plainLines(body: string): Array<{ text: string; heading: string | null; blankBefore: boolean }> {
  const out: Array<{ text: string; heading: string | null; blankBefore: boolean }> = []
  let heading: string | null = null
  let blank = true
  for (const raw of body.split(/\r?\n/)) {
    const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(raw)
    const clean = (h ? h[1] : raw)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s*>\s?/, '')
      .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, (m) => (/\d/.test(m) ? m : ''))
      .replace(/(\*\*|__|`|~~)/g, '')
      .replace(/(^|\s)\*([^*\s][^*]*)\*(?=\s|$|[.,;:])/g, '$1$2')
      .replace(/\|/g, ' ')
      .replace(/^\s*[-=_*]{3,}\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (h) { heading = clean; blank = true; continue }
    if (!clean) { blank = true; continue }
    out.push({ text: clean, heading, blankBefore: blank })
    blank = false
  }
  return out
}

/**
 * A long notes body reduced to what carries evidence, in original order: the
 * first paragraph (up to NOTES_LEAD_MAX_CHARS), then every sentence with a digit
 * or result wording, or under a Results/Outcomes/Metrics/Impact/Learnings
 * heading; repeats and anything an atom already states are left out. Cut at
 * line or sentence boundaries, never above `max`. A body that fits whole (after
 * those removals) is returned whole. Pure.
 */
export function digestNotes(body: string, opts: { max?: number; exclude?: readonly string[] } = {}): string {
  const max = opts.max ?? PROJECT_EVIDENCE_MAX_CHARS
  const lines = plainLines(body)
  if (lines.length === 0 || max <= 0) return ''
  const exclude = (opts.exclude ?? []).map(keyOf).filter((k) => k.length >= 12)
  const seen = new Set<string>()
  const keep = (text: string): boolean => {
    const k = keyOf(text)
    if (!k || seen.has(k)) return false
    if (exclude.some((e) => e.includes(k) || (k.length >= 12 && k.includes(e)))) return false
    seen.add(k)
    return true
  }

  // First paragraph: the first run of lines with no blank line between.
  const leadEnd = lines.findIndex((l, i) => i > 0 && l.blankBefore)
  const lead = lines.slice(0, leadEnd < 0 ? lines.length : leadEnd)
  const leadText = lead.map((l) => l.text).join(' ')
  const units: Array<{ text: string; hot: boolean; lead: boolean }> = []
  if (leadEnd < 0 && leadText.length <= max) {
    // Everything is one paragraph: keep it whole when it fits.
  }
  const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).filter(Boolean)
  lines.forEach((l, i) => {
    const inLead = i < (leadEnd < 0 ? lines.length : leadEnd)
    if (inLead) return
    const hotHeading = l.heading !== null && RESULT_HEADING.test(l.heading)
    for (const s of sentences(l.text)) units.push({ text: s, hot: hotHeading || /\d/.test(s) || RESULT_WORDING.test(s), lead: false })
  })

  const whole = [leadText, ...units.map((u) => u.text)]
  const wholeLen = whole.reduce((n, t) => n + t.length + 1, -1)
  const picked: string[] = []
  let used = 0
  const add = (t: string, force = false): boolean => {
    const piece = t.trim()
    if (!piece) return false
    const extra = piece.length + (picked.length > 0 ? 1 : 0)
    if (used + extra > max && !force) return false
    if (!keep(piece)) return false
    picked.push(piece)
    used += extra
    return true
  }
  if (wholeLen <= max) {
    for (const t of whole) add(t)
    return picked.join('\n')
  }
  const leadCap = Math.min(NOTES_LEAD_MAX_CHARS, max)
  let leadOut = leadText
  if (leadOut.length > leadCap) {
    const ss = sentences(leadOut)
    let acc = ''
    for (const s of ss) { if ((acc ? acc.length + 1 : 0) + s.length > leadCap) break; acc = acc ? `${acc} ${s}` : s }
    leadOut = acc || cutWords(leadOut, leadCap)
  }
  add(leadOut)
  for (const u of units) if (u.hot) add(u.text)
  return picked.join('\n')
}

/** The notes part of a project's body (the body is description + notes, build.ts). */
function notesOf(note: ProjectNote): string {
  const body = (note.body ?? '').trim()
  const desc = note.props.description.trim()
  return desc && body.startsWith(desc) ? body.slice(desc.length).trim() : body
}

const figureRich = (a: ProjectAtom) => Number(Boolean(a.impact?.trim())) + Number(/\d/.test(a.text))

export type ProjectEvidenceText = {
  /** Description, notes digest and atoms, contact-scrubbed, at most PROJECT_EVIDENCE_MAX_CHARS. */
  text: string
  /** Every atom the project owns (also those left out of `text`), figure-rich first. */
  atoms: ProjectAtom[]
  /** Description + digest + atoms together are under THIN_PROJECT_MIN_CHARS beyond the project's own name (limits.ts). */
  thin: boolean
}

/**
 * The evidence text of one project note: description + digest of the notes + its
 * own atoms rendered like activityPromptText. `excludeAtomIds` are atoms that are
 * bullets of their own (the writer must not repeat them): left out of `text`,
 * still counted for `thin`. Pure.
 */
export function projectEvidenceText(note: ProjectNote, vault: Vault, opts: { excludeAtomIds?: ReadonlySet<string> } = {}): ProjectEvidenceText {
  const scrub = makeContactScrubber(vault.identity.props.contact)
  const clean = (t: string) => scrub(stripWikilinks(String(t))).trim()
  const atoms: ProjectAtom[] = []
  for (const l of note.links) {
    const a = l.type === 'has' ? vault.notes.get(l.id) : undefined
    if (a?.type === 'evidence') atoms.push({ id: a.id, kind: a.props.kind, text: clean(a.props.description), impact: a.props.impact ? clean(a.props.impact) : null, highlighted: a.props.highlighted })
  }
  atoms.sort((x, y) => figureRich(y) - figureRich(x))
  // Legacy highlights only stand in when there are no atoms (profile/project-highlights.ts).
  const legacy = atoms.length === 0 ? note.props.highlights.map(clean).filter(Boolean) : []
  const atomLines = [...atoms.map(activityPromptText), ...legacy]
  const shown = [...atoms.filter((a) => !opts.excludeAtomIds?.has(a.id)).map(activityPromptText), ...legacy]

  const max = PROJECT_EVIDENCE_MAX_CHARS
  const description = cutWords(clean(note.props.description), DESCRIPTION_MAX_CHARS)
  const rawNotes = clean(notesOf(note))
  const atomKeys = [...atoms.flatMap((a) => [a.text, a.impact ?? '', `${a.text} ${a.impact ?? ''}`]), ...legacy]
  const fullDigest = digestNotes(rawNotes, { max, exclude: [...atomKeys, description] })

  let used = description.length
  const atomOut: string[] = []
  const atomBudget = max - used - Math.min(fullDigest.length, DIGEST_MIN_CHARS)
  let atomUsed = 0
  for (const l of shown) {
    if (atomUsed + l.length + 1 > atomBudget) continue
    atomOut.push(l)
    atomUsed += l.length + 1
  }
  used += atomUsed + 1
  const digest = fullDigest.length <= max - used ? fullDigest : digestNotes(rawNotes, { max: Math.max(0, max - used - 1), exclude: [...atomKeys, description] })
  const text = [description, digest, ...atomOut].filter(Boolean).join('\n')
  const thin = isThinProject({ name: note.props.name, text: [description, fullDigest, ...atomLines].join('\n') })
  return { text, atoms, thin }
}
