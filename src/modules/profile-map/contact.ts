// The contact placeholder for Markdown documents written by agents. Agents
// never see contact details (prompts and MCP results are scrubbed), so they
// write CONTACT_PLACEHOLDER where the contact line goes and the app fills it
// in code, at the point the owner accepts the document.

import type { Contact } from './types'

export const CONTACT_PLACEHOLDER = '{{contact}}'

const PLACEHOLDER_RE = /\{\{\s*contact\s*\}\}/gi
const HAS_PLACEHOLDER_RE = /\{\{\s*contact\s*\}\}/i
/** A placeholder with the separator before it, removed when there is no contact line. */
const PLACEHOLDER_WITH_SEPARATOR_RE = /[ \t]*[·|•,–-]?[ \t]*\{\{\s*contact\s*\}\}/gi

/** "robin@example.test | +33 6 … | linkedin.com/in/robin", skipping empty fields. */
export function contactLine(contact: Contact): string {
  return [contact.email, contact.phone, contact.linkedIn, contact.github, contact.website]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(' | ')
}

export function hasContactPlaceholder(markdown: string): boolean {
  return HAS_PLACEHOLDER_RE.test(markdown)
}

/**
 * Replaces every placeholder with the contact line. With no contact details,
 * the placeholder goes along with the separator before it, and a line left
 * empty is dropped rather than kept blank.
 */
export function fillContactPlaceholder(markdown: string, contact: Contact): string {
  const line = contactLine(contact)
  return markdown
    .split('\n')
    .flatMap((row) => {
      if (!hasContactPlaceholder(row)) return [row]
      // A function replacement: `$` in a contact value must stay literal.
      const filled = line ? row.replace(PLACEHOLDER_RE, () => line) : row.replace(PLACEHOLDER_WITH_SEPARATOR_RE, '').trimEnd()
      return filled.trim() ? [filled] : []
    })
    .join('\n')
}
