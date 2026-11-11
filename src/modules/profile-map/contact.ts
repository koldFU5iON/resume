// The contact placeholder for Markdown documents written by agents. Agents
// never see contact details (prompts and MCP results are scrubbed), so they
// write CONTACT_PLACEHOLDER where the contact line goes and the app fills it
// in code, at the point the owner accepts the document.

import type { Contact } from './types'

export const CONTACT_PLACEHOLDER = '{{contact}}'

const PLACEHOLDER_RE = /\{\{\s*contact\s*\}\}/gi

/** "robin@example.test | +33 6 … | linkedin.com/in/robin", skipping empty fields. */
export function contactLine(contact: Contact): string {
  return [contact.email, contact.phone, contact.linkedIn, contact.github, contact.website]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(' | ')
}

export function hasContactPlaceholder(markdown: string): boolean {
  return new RegExp(PLACEHOLDER_RE.source, 'i').test(markdown)
}

/**
 * Replaces every placeholder with the contact line. A line left empty (the
 * profile has no contact details) is dropped rather than kept blank.
 */
export function fillContactPlaceholder(markdown: string, contact: Contact): string {
  const line = contactLine(contact)
  return markdown
    .split('\n')
    .flatMap((row) => {
      if (!hasContactPlaceholder(row)) return [row]
      const filled = row.replace(PLACEHOLDER_RE, line)
      return filled.trim() ? [filled] : []
    })
    .join('\n')
}
