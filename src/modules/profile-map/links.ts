// Derived links: capabilities a piece of text names, either by an exact
// mention ("Led the Jira rollout") or by an explicit [[wikilink]]. Worked out
// when the vault loads, never stored, so they follow every edit at once.
//
// Linear-time scans only (no backtracking regex): this runs over
// user-controlled text on every profile load. See pii.ts.

import { normalizeName } from './format'

const MAX_WIKILINK = 100

type Wikilink = { start: number; end: number; target: string; label: string | null }

/**
 * Every well-formed [[target]] or [[target|label]], in order. Linear: the
 * next "]]" is found once and reused until an opener passes it, and an inner
 * text longer than MAX_WIKILINK is skipped before it is sliced.
 */
function scanWikilinks(text: string): Wikilink[] {
  const found: Wikilink[] = []
  let close = -1
  let from = 0
  for (;;) {
    const open = text.indexOf('[[', from)
    if (open === -1) break
    if (close < open + 2) close = text.indexOf(']]', open + 2)
    if (close === -1) break
    if (close - open - 2 === 0 || close - open - 2 > MAX_WIKILINK) {
      from = open + 2
      continue
    }
    const inner = text.slice(open + 2, close)
    if (inner.includes('[') || inner.includes('\n')) {
      // A broken opener: resume just after it, so "[[a [[b]]" still finds b.
      from = open + 2
      continue
    }
    const bar = inner.indexOf('|')
    found.push({
      start: open,
      end: close + 2,
      target: (bar === -1 ? inner : inner.slice(0, bar)).trim(),
      label: bar === -1 ? null : inner.slice(bar + 1).trim(),
    })
    from = close + 2
  }
  return found
}

/** Names inside [[...]], trimmed, in order, without duplicates. `[[a|label]]` keeps `a`. */
export function parseWikilinks(text: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const { target } of scanWikilinks(text)) {
    const key = normalizeName(target)
    if (target && !seen.has(key)) {
      seen.add(key)
      names.push(target)
    }
  }
  return names
}

/** `[[Name]]` and `[[Name|label]]` as plain text, for prompts and renders. */
export function stripWikilinks(text: string): string {
  if (!text.includes('[[')) return text
  let out = ''
  let kept = 0
  for (const link of scanWikilinks(text)) {
    out += text.slice(kept, link.start) + (link.label || link.target)
    kept = link.end
  }
  return out + text.slice(kept)
}

const isAlnum = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
/** Around a one-letter name only spaces and plain punctuation count: "R&D" and "C/C++" are not "R" or "C". */
const isPlainBoundary = (c: number) => c === -1 || c === 32 || c === 9 || c === 10 || c === 13 || ',.;:!?()'.includes(String.fromCharCode(c))

/**
 * Names this short are matched case-sensitively, so "Go" (the language)
 * does not match "go to market", nor "R" every capital R.
 */
const CASE_SENSITIVE_MAX = 3

export type Mentionable = { id: string; name: string }

/**
 * Ids of the capabilities `text` mentions as a whole word or phrase. A match
 * must not touch a letter or digit on either side, so "Java" does not match
 * "JavaScript" but "C++" and "Node.js" match as written.
 */
export function findMentions(text: string, capabilities: Mentionable[]): string[] {
  const lower = text.toLowerCase()
  // toLowerCase can change the length of some non-ASCII text; then match exactly.
  const caseless = lower.length === text.length
  const found: string[] = []
  for (const cap of capabilities) {
    const name = cap.name.trim()
    if (!name) continue
    const exact = name.length <= CASE_SENSITIVE_MAX || !caseless
    const hay = exact ? text : lower
    const needle = exact ? name : name.toLowerCase()
    let at = hay.indexOf(needle)
    while (at !== -1) {
      const before = at === 0 ? -1 : text.charCodeAt(at - 1)
      const after = at + needle.length >= text.length ? -1 : text.charCodeAt(at + needle.length)
      const single = needle.length === 1
      const startsWord = single ? isPlainBoundary(before) : !isAlnum(needle.charCodeAt(0)) || before === -1 || !isAlnum(before)
      const endsWord = single ? isPlainBoundary(after) : !isAlnum(needle.charCodeAt(needle.length - 1)) || after === -1 || !isAlnum(after)
      if (startsWord && endsWord) {
        found.push(cap.id)
        break
      }
      at = hay.indexOf(needle, at + 1)
    }
  }
  return found
}
