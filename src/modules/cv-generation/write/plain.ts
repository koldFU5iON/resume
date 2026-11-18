/**
 * The one cleaner for every model-written string (summary, bullets, profile,
 * headline, competency lines, group labels). The CV is assembled from `:::`
 * blocks and shown in a Markdown preview, so a model string must be plain
 * text: no images, links, HTML, headings, quotes, list markers, `:::` or
 * `{{...}}` (the latter would be taken for the contact placeholder).
 *
 * Writers run `plainProblems` as a check (a violation is retried once with
 * feedback, like any soft problem) and then ALWAYS apply `plainLine` to what
 * they keep, so a stray marker never reaches Assemble. Pure.
 */

const IMAGE = /!\[[^\]]*\]\([^)]*\)/g
const LINK = /\[([^\]]*)\]\([^)]*\)/g
const REF_LINK = /\[([^\]]+)\]\[[^\]]*\]/g
const AUTOLINK = /<(?:https?:\/\/|mailto:)[^>\s]+>/gi
const TAG = /<\/?[a-z][^>]*>/gi
const LEADING_MARKER = /^\s*(?:#{1,6}\s+|>+\s*|[-*•+]\s+)/
const FENCE = /:{3,}/g
const BRACES = /\{\{|\}\}/g
/** Emphasis and code marks: removed silently (not worth a retry). */
const EMPHASIS = /\*\*|__|`/g

/**
 * First person ("I led", "my team", "we shipped"): a CV is written with an
 * implied subject. Capital "I" on its own (not "I/O", "I." or inside a word; a
 * roman numeral like "Phase I" is a rare false positive, and the check is soft),
 * and my / me / mine / myself / we / our / ours / ourselves in lower or
 * title case, with the common contractions. "us" is not matched ("US" is a
 * country), nor all-caps "ME" / "WE".
 */
const FIRST_PERSON = new RegExp(
  [
    "(?<![\\p{L}\\p{N}'’./-])I(?:['’](?:m|ve|ll|d))?(?![\\p{L}\\p{N}./-])",
    "(?<![\\p{L}\\p{N}'’-])(?:[Mm]y|[Mm]e|[Mm]ine|[Mm]yself|[Ww]e|[Oo]ur|[Oo]urs|[Oo]urselves)(?:['’](?:re|ve|ll|d))?(?![\\p{L}\\p{N}'’-])",
  ].join('|'),
  'gu',
)

const has = (re: RegExp, text: string): boolean => {
  re.lastIndex = 0
  const found = re.test(text)
  re.lastIndex = 0
  return found
}

/** What a model string breaks, as short phrases for the retry feedback; empty when it is plain. */
export function plainProblems(text: string): string[] {
  const out: string[] = []
  if ([IMAGE, LINK, REF_LINK, AUTOLINK].some((re) => has(re, text))) out.push('links or images')
  if (has(TAG, text)) out.push('HTML tags')
  if (text.split(/\r?\n/).some((l) => LEADING_MARKER.test(l))) out.push('a heading, quote or list marker')
  if (text.includes(':::')) out.push('":::"')
  if (text.includes('{{') || text.includes('}}')) out.push('"{{"')
  if (hasFirstPerson(text)) out.push('first person ("I", "my", "we"): use an implied subject, with no pronouns')
  return out
}

/** Whether the text uses first-person pronouns. */
export function hasFirstPerson(text: string): boolean {
  return has(FIRST_PERSON, text)
}

/** Plain, single-line text: images and links reduced to their text, tags, markers, ":::" and "{{" removed, whitespace collapsed. */
export function plainLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(LEADING_MARKER, ''))
    .join(' ')
    .replace(IMAGE, '')
    .replace(LINK, '$1')
    .replace(REF_LINK, '$1')
    .replace(AUTOLINK, '')
    .replace(TAG, '')
    .replace(FENCE, '')
    .replace(BRACES, '')
    .replace(EMPHASIS, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The retry feedback for a field that is not plain, or null. */
export function plainFeedback(label: string, text: string): string | null {
  const p = plainProblems(text)
  return p.length > 0 ? `${label} contains ${p.join(', ')}; write plain text only (no Markdown, links, HTML or ":::"), in the third person implied: no "I", "my", "we"` : null
}

/** Short phrases for the log ("first person", "links or images") for a field's problems, or []. */
export function plainReasons(text: string): string[] {
  return plainProblems(text).map((p) => (p.startsWith('first person') ? 'first person' : p))
}
