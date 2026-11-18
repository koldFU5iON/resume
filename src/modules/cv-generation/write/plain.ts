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
 * implied subject. Capital "I" on its own (not "I/O", "I." or inside a word),
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

/** Nouns a roman-numeral "I" follows ("Phase I", "World War I", "Grade I listed"). */
const ROMAN_HEADS = new Set(['phase', 'war', 'grade', 'part', 'type', 'class', 'level', 'stage', 'tier', 'chapter', 'volume', 'book', 'act', 'step', 'category', 'group', 'section', 'series', 'wave', 'round', 'tranche', 'mark'])
const WORD = /[\p{L}\p{N}'’]+/gu
const wordsOf = (text: string) => [...text.matchAll(WORD)].map((m) => ({ w: m[0].replace(/’/g, "'").toLowerCase(), raw: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))

/**
 * A first-person match is NOT a violation when it is part of a verbatim name
 * the evidence also contains: the 2-4 words around it (e.g. "My Talking Tom",
 * "Our World in Data", "I'm Lovin' It", "Me Too") appear in `evidence`, or when
 * it is a roman numeral "I" after a capitalised noun ("Phase I", "World War I").
 * The evidence is the candidate's own profile text, never model output.
 */
function isVerbatimOrNumeral(text: string, tokens: ReturnType<typeof wordsOf>, k: number, evidenceWords: string): boolean {
  const t = tokens[k]
  if (t.raw === 'I') {
    const prev = tokens[k - 1]
    if (prev && /^\p{Lu}/u.test(prev.raw)) {
      if (ROMAN_HEADS.has(prev.w)) return true
      // "Final Fantasy I": a capitalised word mid-sentence and nothing after the numeral.
      const sentenceStart = !tokens[k - 2] || /[.!?:;]\s*$/.test(text.slice(tokens[k - 2].end, prev.start))
      if (!sentenceStart && !tokens[k + 1]) return true
    }
  }
  if (!evidenceWords) return false
  for (let len = 2; len <= 4; len++) {
    for (let from = Math.max(0, k - len + 1); from <= k && from + len <= tokens.length; from++) {
      if (evidenceWords.includes(` ${tokens.slice(from, from + len).map((x) => x.w).join(' ')} `)) return true
    }
  }
  return false
}

const has = (re: RegExp, text: string): boolean => {
  re.lastIndex = 0
  const found = re.test(text)
  re.lastIndex = 0
  return found
}

/** What a model string breaks, as short phrases for the retry feedback; empty when it is plain. `evidence` is the candidate's own text: a first-person word inside a verbatim name from it is not a violation. */
export function plainProblems(text: string, evidence = ''): string[] {
  const out: string[] = []
  if ([IMAGE, LINK, REF_LINK, AUTOLINK].some((re) => has(re, text))) out.push('links or images')
  if (has(TAG, text)) out.push('HTML tags')
  if (text.split(/\r?\n/).some((l) => LEADING_MARKER.test(l))) out.push('a heading, quote or list marker')
  if (text.includes(':::')) out.push('":::"')
  if (text.includes('{{') || text.includes('}}')) out.push('"{{"')
  if (hasFirstPerson(text, evidence)) out.push('first person ("I", "my", "we"): use an implied subject, with no pronouns')
  return out
}

/** Whether the text uses first-person pronouns (a verbatim name from `evidence`, or a roman numeral "I", does not count). */
export function hasFirstPerson(text: string, evidence = ''): boolean {
  FIRST_PERSON.lastIndex = 0
  const matches = [...text.matchAll(FIRST_PERSON)]
  FIRST_PERSON.lastIndex = 0
  if (matches.length === 0) return false
  const tokens = wordsOf(text)
  const evidenceWords = evidence ? ` ${wordsOf(evidence).map((x) => x.w).join(' ')} ` : ''
  return matches.some((m) => {
    const k = tokens.findIndex((t) => t.start <= (m.index ?? 0) && (m.index ?? 0) < t.end)
    return k < 0 || !isVerbatimOrNumeral(text, tokens, k, evidenceWords)
  })
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
export function plainFeedback(label: string, text: string, evidence = ''): string | null {
  const p = plainProblems(text, evidence)
  return p.length > 0 ? `${label} contains ${p.join(', ')}; write plain text only (no Markdown, links, HTML or ":::"), in the third person implied: no "I", "my", "we"` : null
}

/** Short phrases for the log ("first person", "links or images") for a field's problems, or []. */
export function plainReasons(text: string, evidence = ''): string[] {
  return plainProblems(text, evidence).map((p) => (p.startsWith('first person') ? 'first person' : p))
}

/**
 * `text` cut at its last sentence or clause boundary (a period, semicolon,
 * colon, comma or dash followed by a space) so it has at most `max` words, or
 * null when no boundary leaves at least half of `max` words (cutting there
 * would drop the meaning, so the caller keeps the text as written). Pure.
 */
export function shortenToWords(text: string, max: number): string | null {
  const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length
  const t = text.trim()
  if (words(t) <= max) return t
  let best: string | null = null
  const boundary = /[.;:,]\s+|\s[—–-]\s+/g
  for (let m = boundary.exec(t); m; m = boundary.exec(t)) {
    const head = t.slice(0, m.index + (/^[.;:,]/.test(m[0]) ? 1 : 0)).trim()
    const n = words(head)
    if (n <= max && n * 2 >= max) best = head
  }
  if (!best) return null
  const stem = best.replace(/[\s,;:—–-]+$/, '')
  return /[.!?]$/.test(stem) ? stem : /[.!?]$/.test(t) ? `${stem}.` : stem
}
