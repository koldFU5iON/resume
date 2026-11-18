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
  return out
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
  return p.length > 0 ? `${label} contains ${p.join(', ')}; write plain text only (no Markdown, links, HTML or ":::")` : null
}
