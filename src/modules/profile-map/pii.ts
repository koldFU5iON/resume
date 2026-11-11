import type { Contact } from './types'

export type PiiMode = 'scrub' | 'include'

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g

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
  const exactRe = exact.length > 0 ? new RegExp(exact.map(escapeRegExp).join('|'), 'gi') : null
  return (text) => {
    let out = exactRe ? text.replace(exactRe, '') : text
    out = out.replace(EMAIL_RE, '')
    return out.replace(/[ \t]{2,}/g, ' ')
  }
}
