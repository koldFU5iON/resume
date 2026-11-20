/**
 * What a project says, for Select, the writers, Review and the profile-readiness
 * thin check: ONE function, so none of them can disagree. A project's text is
 * its description, a deterministic digest of its notes (no model) and the
 * achievements attached to it. The profile-map body is description + notes
 * (build.ts); reading only `description` and `highlights` left a project with
 * an empty description and a long notes body "thin" and hid the figures of a
 * long notes body.
 *
 * The text is built ONCE: one line, parts joined with " — " and at most
 * PROJECT_EVIDENCE_MAX_CHARS. The writer prompt, the figures check and Review all
 * use exactly that string, so a figure the writer never saw is never evidence.
 * Scrubbing covers the owner's own contact values and email addresses
 * (profile-map/pii.ts), not other people's phone numbers.
 *
 * Pure: no DB, no network.
 */

import { makeContactScrubber } from '@/modules/profile-map/pii'
import { stripWikilinks } from '@/modules/profile-map/links'
import type { ProjectNote, Vault } from '@/modules/profile-map/types'
import { parseWritingDeskMarkdown } from '@/modules/writing-desk/markdown'
import { PROJECT_EVIDENCE_MAX_CHARS, isThinProject } from './write/limits'
import { plainLine } from './write/plain'
import { formatResult } from '@/modules/profile/result'

export const RESULT_WORDING = /\b(?:reduced|increased|grew|fell|cut|saved|delivered|generated|launched|achieved|won|drove|scaled|doubled|tripled|halved|improved|boosted|accelerated|exceeded|surpassed|secured|earned|raised|expanded|eliminated|enabled|unlocked|resulting|resulted|led to|from\s+\S+\s+to)\b/i

/** A heading with one of these words makes every line under it a result line (English; French, German and Spanish equivalents). */
const RESULT_HEADING = /result|outcome|metric|impact|learning|r[ée]sultat|ergebnis|resultado|m[ée]trica|m[ée]trique|kennzahl|logro|erfolg|aprendizaje|enseignement/i
/** The first sentences of the notes are always kept, up to this many characters. */
export const NOTES_LEAD_MAX_CHARS = 300
/** A sentence longer than this is split at ; and , (then at a word) so no single unit can swallow the budget. */
const UNIT_MAX_CHARS = 240
/** Room kept for the description and the notes digest when atoms are long. */
const DESCRIPTION_RESERVE_CHARS = 500
const DIGEST_MIN_CHARS = 500
/** Separator between the parts of the shown text. */
const SEP = ' — '

export type ProjectAtom = { id: string; kind: 'responsibility' | 'achievement'; text: string; impact: string | null; highlighted: boolean; resultText?: string | null }

/** One atom as the experience writer is shown it (without its label). Review uses the same function. */
export function activityPromptText(a: { kind: string; text: string; impact: string | null }): string {
  return `${a.kind}: ${a.text}${a.impact ? ` — impact: ${a.impact}` : ''}`
}

const keyOf = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const YEAR = /\b(?:19|20)\d{2}\b/g

/** The figures a text states, normalised ("2.4M", "3.8%", "1,400" → "1400"); a bare 4-digit year is not a figure. */
export function figureKeys(t: string): Set<string> {
  const out = new Set<string>()
  for (const m of t.replace(YEAR, ' ').matchAll(/\d[\d,]*(?:\.\d+)?\s?(?:%|[kKmMbB]\b)?/g)) out.add(m[0].replace(/[,\s]/g, '').toLowerCase())
  return out
}
const hasFigure = (t: string) => figureKeys(t).size > 0
const stems = (t: string) => new Set((t.toLowerCase().match(/\p{L}{3,}/gu) ?? []).map((w) => w.slice(0, 5)))
const overlap = (a: Set<string>, b: Set<string>) => {
  if (a.size === 0 || b.size === 0) return 0
  let n = 0
  for (const x of a) if (b.has(x)) n++
  return n / Math.min(a.size, b.size)
}

/**
 * Two texts that state the same thing: the same figures AND at least `minOverlap` of the shorter one's word stems in
 * common. With `subset`, the figures of `a` need only be stated by `b` (a notes sentence that an atom already covers).
 * Text without figures is a duplicate only when its words match exactly. Pure.
 */
export function nearDuplicate(a: string, b: string, opts: { minOverlap?: number; subset?: boolean } = {}): boolean {
  const ka = keyOf(a)
  if (ka && ka === keyOf(b)) return true
  const fa = figureKeys(a)
  const fb = figureKeys(b)
  if (fa.size === 0) return false
  const same = opts.subset ? [...fa].every((f) => fb.has(f)) : fa.size === fb.size && [...fa].every((f) => fb.has(f))
  return same && overlap(stems(a), stems(b)) >= (opts.minOverlap ?? 0.6)
}

function cutWords(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const at = cut.search(/\s\S*$/)
  return `${(at > max / 2 ? cut.slice(0, at) : cut).trimEnd()}…`
}

/** Markdown simplified to plain lines: headings reported separately; emphasis, bullets, list numbers, quotes, link syntax and table pipes removed. */
function plainLines(body: string): Array<{ text: string; heading: string | null; blankBefore: boolean }> {
  const out: Array<{ text: string; heading: string | null; blankBefore: boolean }> = []
  let heading: string | null = null
  let blank = true
  for (const raw of body.split(/\r?\n/)) {
    const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(raw)
    const clean = (h ? h[1] : raw)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s*>\s?/, '')
      .replace(/^\s*(?:[-*+•]|\d{1,3}[.)])\s+/, '')
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

/** A text as sentences, none over UNIT_MAX_CHARS: long ones are split at ; and ,, then at a word (never inside a figure). */
function units(text: string): string[] {
  const out: string[] = []
  for (const s of text.split(/(?<=[.!?])\s+/)) {
    if (s.length <= UNIT_MAX_CHARS) { out.push(s); continue }
    let acc = ''
    for (const piece of s.split(/(?<=[;,])\s+|\s+/)) {
      if (acc && acc.length + 1 + piece.length > UNIT_MAX_CHARS) { out.push(acc); acc = piece } else acc = acc ? `${acc} ${piece}` : piece
    }
    if (acc) out.push(acc)
  }
  return out.filter(Boolean)
}

/**
 * A long text reduced to what carries evidence, in original order: its first sentences (up to NOTES_LEAD_MAX_CHARS),
 * then every later sentence with a figure or result wording, or under a Results/Outcomes/Metrics/Impact/Learnings
 * heading. Repeats, and anything an atom already states (`exclude`), are left out. Cut at sentence boundaries, never
 * above `max` (`sep` is the length of the separator between kept pieces). A text that fits whole is returned whole.
 */
export function digestUnits(body: string, opts: { max?: number; exclude?: readonly string[]; sep?: number } = {}): string[] {
  const max = opts.max ?? PROJECT_EVIDENCE_MAX_CHARS
  const sep = opts.sep ?? 1
  const lines = plainLines(body)
  if (lines.length === 0 || max <= 0) return []
  const exclude = opts.exclude ?? []
  const seen = new Set<string>()
  const keep = (text: string): boolean => {
    const k = keyOf(text)
    if (!k || seen.has(k)) return false
    const figs = figureKeys(text)
    const stated = (e: string) => {
      const fe = figureKeys(e)
      return [...figs].every((f) => fe.has(f))
    }
    // Dropped when an atom already states it: near-identical, or one contains the other and the sentence has no figure the atom lacks.
    if (exclude.some((e) => e.trim().length >= 12 && ((figs.size > 0 && nearDuplicate(text, e, { subset: true, minOverlap: 0.3 })) || (stated(e) && (keyOf(e).includes(k) || k.includes(keyOf(e))))))) return false
    seen.add(k)
    return true
  }
  const all: Array<{ text: string; hot: boolean }> = []
  for (const l of lines) {
    const hotHeading = l.heading !== null && RESULT_HEADING.test(l.heading)
    for (const u of units(l.text)) all.push({ text: u, hot: hotHeading || hasFigure(u) || RESULT_WORDING.test(u) })
  }
  const picked: string[] = []
  let used = 0
  const add = (t: string): boolean => {
    const extra = t.length + (picked.length > 0 ? sep : 0)
    if (used + extra > max || !keep(t)) return false
    picked.push(t)
    used += extra
    return true
  }
  const total = all.reduce((n, u) => n + u.text.length + sep, -sep)
  if (total <= max) { for (const u of all) add(u.text); return picked }
  // The lead: the first sentences up to NOTES_LEAD_MAX_CHARS (the first one always, cut at a word when it is longer).
  let leadLen = 0
  let i = 0
  for (; i < all.length; i++) {
    const t = all[i].text
    if (i > 0 && leadLen + t.length + 1 > Math.min(NOTES_LEAD_MAX_CHARS, max)) break
    add(i === 0 ? cutWords(t, Math.min(NOTES_LEAD_MAX_CHARS, max)) : t)
    leadLen += t.length + 1
  }
  for (; i < all.length; i++) if (all[i].hot) add(all[i].text)
  return picked
}

/** `digestUnits` joined with newlines. */
export function digestNotes(body: string, opts: { max?: number; exclude?: readonly string[] } = {}): string {
  return digestUnits(body, opts).join('\n')
}

/** The notes part of a project's body (the body is description + notes, build.ts). */
function notesOf(note: ProjectNote): string {
  const body = (note.body ?? '').trim()
  const desc = note.props.description.trim()
  return desc && body.startsWith(desc) ? body.slice(desc.length).trim() : body
}

export const figureRich = (a: Pick<ProjectAtom, 'text' | 'impact'>) => Number(Boolean(a.impact?.trim())) + Number(hasFigure(a.text))

export type ProjectEvidenceText = {
  /** Description, notes digest and atoms, contact-scrubbed: ONE line joined with " — ", at most PROJECT_EVIDENCE_MAX_CHARS. */
  text: string
  /** Every atom the project owns (also those left out of `text`), figure-rich first. */
  atoms: ProjectAtom[]
  /** Description + digest + atoms together are under THIN_PROJECT_MIN_CHARS beyond the project's own name (limits.ts). */
  thin: boolean
}

const oneLine = (t: string) => t.replace(/\s*\n+\s*/g, SEP).replace(/\s+/g, ' ').trim()

const NOTE_INSTRUCTIONS = /^(?:\[!|\{\{|:::|(?:tbd|to[ -]?do|instructions?|templates?|placeholders?|drafts?|reminders?|next steps|open questions|notes? to self|contact|e-?mail|phone)\b|(?:add|insert|describe|explain|summarize|summarise|write|replace|list|include|fill in|remember to)\b)/i
const URL = /\b(?:[a-z][a-z\d+.-]*:\/\/|mailto:|www\.)[^\s<>]+/gi
const TELEPHONE = /\btel:\s*\+?\d[\d(). \-]*\d|\btel:\s*\+?\d/gi
const CONTACT_LINK = /\b(?:linkedin\.com\/(?:in|pub)|github\.com|(?:twitter|x|facebook|instagram)\.com)\/[^\s<>]+/gi

type VisibleNode = { type: string; value?: string; url?: string; children?: readonly VisibleNode[] }

/** Read labels and visible text, never link destinations, HTML comments, images or code blocks. */
function visibleText(node: VisibleNode): string {
  if (['html', 'image', 'imageReference', 'code', 'definition'].includes(node.type)) return ''
  if (node.type === 'link' && /^(?:tel|mailto):/i.test(node.url ?? '')) return ''
  if (node.type === 'break') return ' '
  return node.children ? node.children.map(visibleText).join(['list', 'listItem', 'writingDeskBlock'].includes(node.type) ? ' ' : '') : node.value ?? ''
}

const withoutComments = (text: string) => stripWikilinks(text).replace(/<!--[\s\S]*?(?:-->|$)/g, '')
const scrubProjectText = (text: string, scrub: (text: string) => string) =>
  scrub(text).replace(TELEPHONE, '').replace(URL, '').replace(CONTACT_LINK, '').replace(/\s+/g, ' ').trim()

/** Parse Markdown destinations instead of trying to balance their parentheses with a regular expression. */
export function cleanProjectLine(text: string, scrub: (text: string) => string): string {
  const visible = parseWritingDeskMarkdown(withoutComments(text)).map(visibleText).join(' ')
  return scrubProjectText(plainLine(visible), scrub)
}

/** Only visible prose and ordinary (non-task) list items supply context without accepted atoms. */
function cvContext(body: string, scrub: (text: string) => string): string {
  const clean = (text: string) => {
    const raw = text.trim()
    if (NOTE_INSTRUCTIONS.test(raw) || /^\[[^\]]+\]$/.test(raw)) return ''
    const line = scrubProjectText(raw, scrub)
    return NOTE_INSTRUCTIONS.test(line) ? '' : line
  }
  let instructionDepth = 0
  return parseWritingDeskMarkdown(withoutComments(body)).flatMap((node) => {
    if (node.type === 'heading') {
      if (instructionDepth && node.depth > instructionDepth) return []
      const heading = visibleText(node)
      instructionDepth = NOTE_INSTRUCTIONS.test(heading) ? node.depth : 0
      return instructionDepth ? [] : [`## ${heading}`]
    }
    if (instructionDepth) return []
    if (node.type === 'paragraph') return [clean(visibleText(node))].filter(Boolean)
    if (node.type === 'list') return node.children.flatMap((item) => item.checked != null ? [] :
      item.children.flatMap((child) => child.type === 'paragraph' ? [clean(visibleText(child))].filter(Boolean) : []))
    return []
  }).join('\n')
}

/** Do not repeat an already embedded structured result, but keep any separate free-text outcome. */
export function projectAtomText(atom: ProjectAtom): string {
  let impact = atom.impact
  if (atom.resultText && atom.text.includes(atom.resultText) && impact?.includes(atom.resultText)) {
    impact = impact.replace(atom.resultText, '').replace(/^[\s;—]+|[\s;—]+$/g, '') || null
  }
  if (impact === atom.text) impact = null
  return atom.text ? atom.text + (impact ? ` (${impact})` : '') : impact ?? ''
}

export function substantiveProjectAtom(atom: ProjectAtom, name: string): boolean {
  const rest = ` ${keyOf(projectAtomText(atom))} `.split(` ${keyOf(name)} `).join(' ').trim()
  const words = rest.split(/\s+/).filter((word) => word !== 'i' && /\p{L}/u.test(word))
  return words.length >= 2 && (rest.match(/\p{L}/gu)?.length ?? 0) >= 4
}

/**
 * The evidence text of one project note: description + digest of the notes + its own atoms rendered like
 * activityPromptText. The description gets whatever the digest and atoms leave (up to the cap); only when the total
 * would exceed it is the description digested (its first sentences, then its figure sentences). `excludeAtomIds` are
 * atoms that are bullets of their own (the writer must not repeat them): left out of `text`, still counted for `thin`.
 */
export function projectEvidenceText(note: ProjectNote, vault: Vault, opts: { excludeAtomIds?: ReadonlySet<string>; forCvOutput?: boolean } = {}): ProjectEvidenceText {
  const scrub = makeContactScrubber(vault.identity.props.contact)
  const clean = opts.forCvOutput
    ? (t: string) => cleanProjectLine(t, scrub)
    : (t: string) => scrub(stripWikilinks(String(t))).trim()
  const atoms: ProjectAtom[] = []
  for (const l of note.links) {
    const a = l.type === 'has' ? vault.notes.get(l.id) : undefined
    if (a?.type === 'evidence') atoms.push({ id: a.id, kind: a.props.kind, text: clean(a.props.description), impact: a.props.impact ? clean(a.props.impact) : null, highlighted: a.props.highlighted, ...(opts.forCvOutput ? { resultText: a.props.result ? clean(formatResult(a.props.result)) : null } : {}) })
  }
  atoms.sort((x, y) => figureRich(y) - figureRich(x))
  if (opts.forCvOutput) {
    // Accepted atoms are rendered directly, with no repeat of their source notes or legacy highlights.
    if (atoms.length > 0) return { text: '', atoms, thin: !atoms.some((a) => substantiveProjectAtom(a, clean(note.props.name))) }
    const name = clean(note.props.name)
    const parts = [note.props.description, notesOf(note), ...note.props.highlights]
    const context = parts.map((part) => cvContext(part, scrub)).filter(Boolean).join('\n\n## Context\n\n')
    const text = digestUnits(context, { sep: SEP.length }).filter((line) => keyOf(line) !== keyOf(name)).join(SEP)
    return { text, atoms, thin: isThinProject({ name, text }) }
  }
  // Legacy highlights only stand in when there are no atoms (profile/project-highlights.ts).
  const legacy = atoms.length === 0 ? note.props.highlights.map(clean).filter(Boolean) : []
  const atomLines = [...atoms.map(activityPromptText), ...legacy]
  const shown = [...atoms.filter((a) => !opts.excludeAtomIds?.has(a.id)).map(activityPromptText), ...legacy].map(oneLine)

  const max = PROJECT_EVIDENCE_MAX_CHARS
  const descFull = oneLine(clean(note.props.description))
  const rawNotes = clean(notesOf(note))
  const exclude = [...atoms.flatMap((a) => [a.text, a.impact ?? '', `${a.text} ${a.impact ?? ''}`]), ...legacy, descFull]
  const fullDigest = digestUnits(rawNotes, { max, exclude, sep: SEP.length })
  const digestFullLen = fullDigest.join(SEP).length

  // Atoms first (they are the strongest evidence), keeping room for a description and a digest.
  const atomBudget = max - Math.min(descFull.length, DESCRIPTION_RESERVE_CHARS) - Math.min(digestFullLen, DIGEST_MIN_CHARS) - 2 * SEP.length
  const atomOut: string[] = []
  let atomUsed = 0
  for (const l of shown) {
    if (atomUsed + l.length + SEP.length > atomBudget) continue
    atomOut.push(l)
    atomUsed += l.length + SEP.length
  }
  // The description takes what the atoms and the digest leave; cut (figure sentences kept) only when it must be.
  const descBudget = max - atomUsed - Math.min(digestFullLen, DIGEST_MIN_CHARS) - (digestFullLen > 0 ? SEP.length : 0)
  const description = descFull.length <= descBudget ? descFull : digestUnits(descFull, { max: Math.max(0, descBudget), sep: SEP.length }).join(SEP)
  const digestBudget = max - atomUsed - description.length - (description ? SEP.length : 0)
  const digest = digestFullLen <= digestBudget ? fullDigest : digestUnits(rawNotes, { max: Math.max(0, digestBudget - SEP.length), exclude, sep: SEP.length })
  const text = [description, ...digest, ...atomOut].filter(Boolean).join(SEP)
  const thin = isThinProject({ name: note.props.name, text: [descFull, ...fullDigest, ...atomLines].join('\n') })
  return { text, atoms, thin }
}
