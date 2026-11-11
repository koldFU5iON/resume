import type { Contact } from './types'

export type PiiMode = 'scrub' | 'include'

// Linear-time on purpose. The scrubber runs synchronously over user-controlled
// text (summaries, notes, evidence), so it must not use a regex that can
// backtrack: an unanchored, unbounded email pattern retries at every position
// of a long non-matching input and goes quadratic (Vercel Security Review
// resume/1). Email parts are bounded by RFC 5321 lengths.
const MAX_LOCAL = 64
const MAX_DOMAIN = 255

const isWordChar = (c: number) =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 // 0-9 A-Z a-z _
const isLocalChar = (c: number) => isWordChar(c) || c === 46 || c === 43 || c === 45 // . + -
const isLabelChar = (c: number) => isWordChar(c) || c === 45 // -
const isBlank = (c: number) => c === 32 || c === 9 // space, tab

/** End index (exclusive) of `label(.label)+` starting at `from`, or -1. */
function domainEnd(text: string, from: number): number {
  const limit = Math.min(text.length, from + MAX_DOMAIN)
  let i = from
  while (i < limit && isLabelChar(text.charCodeAt(i))) i++
  if (i === from) return -1
  let end = -1
  while (i + 1 < limit && text.charCodeAt(i) === 46 && isLabelChar(text.charCodeAt(i + 1))) {
    i += 1
    while (i < limit && isLabelChar(text.charCodeAt(i))) i++
    end = i
  }
  return end
}

/**
 * Removes every email address, along with the spaces or tabs before it.
 * Each `@` looks at most MAX_LOCAL characters back and MAX_DOMAIN ahead, and
 * leading blanks are only consumed back to the previous removal, so the whole
 * pass is linear in the input.
 */
function removeEmails(text: string): string {
  let out = ''
  let kept = 0
  let at = text.indexOf('@')
  while (at !== -1) {
    let start = at
    while (start > kept && at - start < MAX_LOCAL && isLocalChar(text.charCodeAt(start - 1))) start--
    const end = start < at ? domainEnd(text, at + 1) : -1
    if (end === -1) {
      at = text.indexOf('@', at + 1)
      continue
    }
    while (start > kept && isBlank(text.charCodeAt(start - 1))) start--
    out += text.slice(kept, start)
    kept = end
    at = text.indexOf('@', end)
  }
  return kept === 0 ? text : out + text.slice(kept)
}

/** Removes every occurrence of `value` (case-insensitive) with the blanks before it. Linear. */
function removeValue(text: string, value: string): string {
  // toLowerCase can change the length of some non-ASCII text; then match exactly.
  const lower = text.toLowerCase()
  const caseless = lower.length === text.length
  const hay = caseless ? lower : text
  const needle = caseless ? value.toLowerCase() : value
  let out = ''
  let kept = 0
  let at = hay.indexOf(needle)
  while (at !== -1) {
    let start = at
    while (start > kept && isBlank(text.charCodeAt(start - 1))) start--
    out += text.slice(kept, start)
    kept = at + needle.length
    at = hay.indexOf(needle, kept)
  }
  return kept === 0 ? text : out + text.slice(kept)
}

/**
 * Removes the user's own contact values and any email address from free text.
 * Deliberately narrower than Jev's scrubber (candidate-state.ts): project and
 * portfolio URLs are legitimate content for writing features, so only the
 * contact fields themselves and emails go. Each removed value takes the
 * blanks before it ("Email: x@y.z" leaves "Email:"); other whitespace is left
 * alone, so Markdown hard breaks and indented lists survive.
 */
export function makeContactScrubber(contact: Contact): (text: string) => string {
  const exact = [contact.email, contact.phone, contact.linkedIn, contact.github, contact.website]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v && v.length >= 4))
    .sort((a, b) => b.length - a.length)
  return (text) => removeEmails(exact.reduce(removeValue, text))
}
