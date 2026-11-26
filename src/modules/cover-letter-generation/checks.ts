/**
 * Code checks on a cover letter (issue #471). Pure: no DB, no network.
 *
 * All soft except invalid desk Markdown: a letter is never blocked, a problem
 * gets one retry (call.ts completeChecked) and then a note.
 *
 * - Length: body words within the chosen length's range.
 * - Clichés: phrases hiring guidance and recruiters flag as generic.
 * - Figures: every number in the letter must appear in a source (profile,
 *   the owner's answers, the job description, the company facts). Personal
 *   statements can't be checked in code; the prompts allow them only from the
 *   owner's answers and Review re-reads for it.
 * - Company facts: an angle's "why them" fact is marked verified when most of
 *   its content words are in the deep dive's company facts or the job text.
 */

import { CONTACT_PLACEHOLDER } from '@/modules/profile-map/contact'
import { validateDraftMarkdown } from '@/modules/writing-desk/validate'
import { LENGTH_WORDS, type LetterLength, type WriteOutput } from './schema'

/** Generic phrases that read as boilerplate (lowercase, matched on word boundaries, straight or curly apostrophes). */
export const CLICHES = [
  'i am writing to apply',
  'i am writing to express my interest',
  'i am excited to apply',
  "i'm excited to apply",
  'i am thrilled to apply',
  'to whom it may concern',
  'team player',
  'passionate about',
  'hard-working',
  'hardworking',
  'results-driven',
  'detail-oriented',
  'go-getter',
  'think outside the box',
  'synergy',
  'perfect fit',
  'ideal candidate',
  'i believe i would be a great',
  'proven track record',
  'please find attached',
  'thank you for your time and consideration',
] as const

const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ')

export function findCliches(text: string): string[] {
  const t = ` ${norm(text)} `
  return CLICHES.filter((c) => new RegExp(`(^|[^a-z])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(t))
}

export function wordCount(paragraphs: readonly string[]): number {
  return paragraphs.join(' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

/** Numbers as written ("40%", "£1.2m", "14,000", "3"): the digits of each. Single digits are ignored (counts like "two teams" are too common to police). */
export function figuresIn(text: string): string[] {
  const found = text.match(/\d[\d,.]*\d|\d{2,}/g) ?? []
  return [...new Set(found.map((f) => f.replace(/[,]/g, '').replace(/\.$/, '')))]
}

/** Figures in the letter that no source contains. */
export function unsupportedFigures(letter: string, sources: readonly string[]): string[] {
  const haystack = sources.join('\n').replace(/,/g, '')
  return figuresIn(letter).filter((f) => !haystack.includes(f))
}

const STOPWORDS = new Set(('a an and are as at be been but by for from has have in into is it its of on or our that the their them they this to was were which with will your you we who what how more most new over also than then there these those about after across before being both each just only other such through under very while'.split(' ')))

function contentWords(s: string): string[] {
  return norm(s).replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOPWORDS.has(w))
}

/** True when at least 60% of the fact's content words (and at least two) are in the sources. */
export function isFactSupported(fact: string, sources: readonly string[]): boolean {
  const words = [...new Set(contentWords(fact))]
  if (words.length === 0) return false
  const pool = new Set(sources.flatMap(contentWords))
  const hits = words.filter((w) => pool.has(w)).length
  return hits >= Math.min(2, words.length) && hits / words.length >= 0.6
}

/** The letter as writing desk Markdown: a header with the name and {{contact}}, then the letter. */
export function letterMarkdown(name: string, out: WriteOutput): string {
  const clean = (s: string) => s.replace(/\r/g, '').trim()
  return [
    `:::header\n# ${name.replace(/\s+/g, ' ').trim() || 'Cover Letter'}\n${CONTACT_PLACEHOLDER}\n:::`,
    clean(out.salutation),
    ...out.paragraphs.map(clean),
    `${clean(out.closing)}\n\n${name.replace(/\s+/g, ' ').trim()}`,
  ].join('\n\n')
}

export type LetterCheck = { hard: string[]; soft: string[]; why: string[] }

/** Every check on a written letter. `sources` are the texts figures may come from. */
export function checkLetter(name: string, out: WriteOutput, opts: { length: LetterLength; sources: readonly string[] }): LetterCheck {
  const hard: string[] = []
  const soft: string[] = []
  const why: string[] = []
  const validation = validateDraftMarkdown(letterMarkdown(name, out))
  if (!validation.ok) {
    hard.push(`the letter is not valid Markdown for the writing desk: ${validation.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; ')}`)
    why.push('invalid Markdown')
  }
  const { min, max } = LENGTH_WORDS[opts.length]
  const words = wordCount(out.paragraphs)
  if (words < min || words > max) {
    soft.push(`the body is ${words} words; keep it between ${min} and ${max}`)
    why.push(`${words} words (${min}-${max})`)
  }
  const body = [out.salutation, ...out.paragraphs, out.closing].join('\n')
  const cliches = findCliches(body)
  if (cliches.length > 0) {
    soft.push(`remove these generic phrases and say something specific instead: ${cliches.map((c) => `"${c}"`).join(', ')}`)
    why.push(`generic phrases: ${cliches.join(', ')}`)
  }
  const figures = unsupportedFigures(out.paragraphs.join('\n'), opts.sources)
  if (figures.length > 0) {
    soft.push(`these figures are not in the profile, the answers or the job description, so remove or correct them: ${figures.join(', ')}`)
    why.push(`figures not in sources: ${figures.join(', ')}`)
  }
  return { hard, soft, why }
}
