import type { Contact } from './types'

export type PiiMode = 'scrub' | 'include'

const EMAIL_RE = /[ \t]*[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Removes the user's own contact values and any email address from free text.
 * Deliberately narrower than Jev's scrubber (candidate-state.ts): project and
 * portfolio URLs are legitimate content for writing features, so only the
 * contact fields themselves and emails go.
 */
export function makeContactScrubber(contact: Contact): (text: string) => string {
  const exact = [contact.email, contact.phone, contact.linkedIn, contact.github, contact.website]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v && v.length >= 4))
    .sort((a, b) => b.length - a.length)
  // Each removed value takes the spaces before it, so "Email: x@y.z" leaves
  // "Email:" without collapsing whitespace anywhere else (Markdown hard
  // breaks and indented lists survive).
  const exactRe = exact.length > 0 ? new RegExp(`[ \\t]*(?:${exact.map(escapeRegExp).join('|')})`, 'gi') : null
  return (text) => {
    const out = exactRe ? text.replace(exactRe, '') : text
    return out.replace(EMAIL_RE, '')
  }
}
