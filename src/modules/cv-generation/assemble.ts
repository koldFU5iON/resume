/**
 * Stage 4, Assemble. No model. Puts the written and code-rendered sections in
 * the order of the DEFAULT CV structure (buildStructureGuide(null): never the
 * master CV, decision 1) plus Earlier Experience right after Professional
 * Experience (cvStructure; the shared default stays as the writing contract
 * external agents read), adds the header block with the candidate's name, the
 * headline and the literal `{{contact}}` placeholder (never contact details:
 * the app fills it in when the owner accepts a draft), then validates the
 * document with the writing desk's own validator and fact-checks it against
 * the profile.
 *
 * Block validity is a hard requirement (`ok: false` names the section); the
 * fact check only produces warnings. Pure: no DB, no network.
 */

import { CONTACT_PLACEHOLDER } from '@/modules/profile-map/contact'
import type { ProfileSnapshot } from '@/modules/profile/snapshot'
import { checkFacts } from '@/modules/writing-desk/fact-check'
import { buildStructureGuide, type StructureGuide } from '@/modules/writing-desk/structure-guide'
import { validateDraftMarkdown } from '@/modules/writing-desk/validate'
import { MAX_CHECK_NOTES, type AssembledSection, type CvAssembled, type CvSelection } from './schema'
import { CV_BODY_WORDS_SOFT_LIMIT } from './write/limits'
import { plainLine } from './write/plain'
import type { WrittenSection } from './write/types'

export type AssembleInput = {
  /** The candidate's name from the profile: not a contact detail. */
  name: string
  /** A short descriptor under the name; null when there is none. */
  headline: string | null
  sections: readonly WrittenSection[]
  /** The selection's employers fix the order of the experience entries (newest first). */
  employerOrder: readonly string[]
  /** "Worth a quick check" notes from the writers; cut to MAX_CHECK_NOTES. */
  checkNotes: readonly string[]
  snapshot: ProfileSnapshot
}

export type AssembleResult =
  | { ok: true; assembled: CvAssembled }
  | { ok: false; issues: string[] }

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The header block: name, headline, contact placeholder. */
export function renderHeader(name: string, headline: string | null): string {
  return [':::header', `# ${oneLine(name) || 'Curriculum Vitae'}`, ...(headline && plainLine(headline) ? [`## ${plainLine(headline)}`] : []), CONTACT_PLACEHOLDER, ':::'].join('\n')
}

/** The section key and heading of the Earlier Experience list (employers shown without bullets). */
export const EARLIER_EXPERIENCE = { key: 'earlier-experience', heading: 'Earlier Experience' } as const

/** The default CV structure with Earlier Experience right after Professional Experience. */
export function cvStructure(): StructureGuide {
  const base = buildStructureGuide(null)
  const at = base.sections.findIndex((s) => s.key === 'experience')
  const sections = [...base.sections]
  sections.splice(at < 0 ? sections.length : at + 1, 0, { ...EARLIER_EXPERIENCE })
  return { ...base, sections }
}

export function assembleCv(input: AssembleInput): AssembleResult {
  const guide = cvStructure()
  const byKind = (kind: string) => input.sections.filter((s) => s.kind === kind)
  const pieces: AssembledSection[] = []
  const strip = (s: WrittenSection, markdown: string): AssembledSection => ({
    id: s.id, kind: s.kind, ...(s.employerKey ? { employerKey: s.employerKey } : {}), markdown,
    ...(s.bullets && s.bullets.length > 0 ? { bullets: s.bullets } : {}),
    ...(s.model ? { model: s.model } : {}), ...(s.tokens && (s.tokens.input > 0 || s.tokens.output > 0) ? { tokens: s.tokens } : {}),
  })

  for (const { key, heading } of guide.sections) {
    if (key === 'header') {
      pieces.push({ id: 'header', kind: 'header', markdown: renderHeader(input.name, input.headline) })
      continue
    }
    if (key === 'experience') {
      const order = new Map(input.employerOrder.map((k, i) => [k, i]))
      const entries = byKind('experience').sort((a, b) => (order.get(a.employerKey ?? '') ?? 1e9) - (order.get(b.employerKey ?? '') ?? 1e9))
      entries.forEach((s, i) => pieces.push(strip(s, i === 0 ? `## ${heading}\n\n${s.markdown}` : s.markdown)))
      continue
    }
    for (const s of byKind(key)) if (s.markdown.trim()) pieces.push(strip(s, `## ${heading}\n\n${s.markdown}`))
  }

  const markdown = `${pieces.map((p) => p.markdown).join('\n\n')}\n`
  const validation = validateDraftMarkdown(markdown, guide)
  const errors = validation.issues.filter((i) => i.severity === 'error')
  if (errors.length > 0) {
    // Name the section: validate each piece alone.
    const culprit = pieces.filter((p) => !validateDraftMarkdown(p.markdown).ok).map((p) => p.id)
    return {
      ok: false,
      issues: [...errors.map((e) => e.message), ...(culprit.length > 0 ? [`Invalid blocks in: ${culprit.join(', ')}.`] : [])],
    }
  }

  const warnings = [
    ...validation.issues.filter((i) => i.severity === 'warning').map((i) => `${i.message}${i.line ? ` (line ${i.line})` : ''}`),
    ...checkFacts(markdown, input.snapshot).map((w) => `${w.message} “${w.excerpt}”`),
  ]
  return {
    ok: true,
    assembled: { markdown, sections: pieces, warnings, checkNotes: input.checkNotes.slice(0, MAX_CHECK_NOTES) },
  }
}

/**
 * Validates and fact-checks a CV Markdown again after the Review stage edited
 * it, with the same validator and structure as `assembleCv`. `errors` is empty
 * when the document is valid; `warnings` are the (soft) block and fact-check
 * findings for the new text.
 */
export function recheckMarkdown(markdown: string, snapshot: ProfileSnapshot): { errors: string[]; warnings: string[] } {
  const validation = validateDraftMarkdown(markdown, cvStructure())
  return {
    errors: validation.issues.filter((i) => i.severity === 'error').map((i) => i.message),
    warnings: [
      ...validation.issues.filter((i) => i.severity === 'warning').map((i) => `${i.message}${i.line ? ` (line ${i.line})` : ''}`),
      ...checkFacts(markdown, snapshot).map((w) => `${w.message} “${w.excerpt}”`),
    ],
  }
}

/** The employer keys of a selection in CV order. */
export function employerOrderOf(selection: Pick<CvSelection, 'employers'>): string[] {
  return selection.employers.map((e) => e.key)
}

/** Words of the CV body: everything but the header block (name, headline, contact placeholder) and the block fences and Markdown marks. */
export function bodyWordCount(markdown: string): number {
  return markdown
    .replace(/^:::header\n[\s\S]*?\n:::\n?/m, '')
    .split('\n')
    .filter((l) => !/^:::/.test(l.trim()))
    .join(' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
    .length
}

/**
 * A SOFT note when the CV body is longer than about two and a half pages (words over
 * CV_BODY_WORDS_SOFT_LIMIT), else null. Nothing is trimmed: the writers' limits
 * should keep a CV under it, so a note means a limit leaked.
 */
export function lengthNote(markdown: string): string | null {
  const words = bodyWordCount(markdown)
  return words > CV_BODY_WORDS_SOFT_LIMIT
    ? `The CV body is about ${words} words, over the ~${CV_BODY_WORDS_SOFT_LIMIT} that fit about two and a half pages. Nothing was trimmed; consider shortening it in the editor.`
    : null
}
