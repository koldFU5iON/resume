const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "Jul 2024". Profile dates are calendar dates stored as UTC midnight, so read
 * them in UTC: local-time formatting shifts them a month back west of UTC.
 */
export function formatMonth(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/** "Jul 2024 – present", or null when there is no start date. */
export function formatSpan(start: Date | null, end: Date | null): string | null {
  if (!start) return null
  return `${formatMonth(start)} – ${end ? formatMonth(end) : 'present'}`
}

/** First line, cut to `max` chars at a word boundary. */
export function oneLine(text: string, max = 140): string {
  const line = text.trim().split('\n').find((l) => l.trim()) ?? ''
  const clean = line.replace(/^#+\s*|^[-*]\s+/, '').trim()
  if (clean.length <= max) return clean
  const cut = clean.lastIndexOf(' ', max - 1)
  return `${clean.slice(0, cut > max / 2 ? cut : max - 1).trimEnd()}…`
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Keeps whole lines up to `max` characters and says how many were dropped, so
 * a tool result stays bounded without cutting mid-line (or mid-JSON later).
 */
export function capLines(text: string, max: number, hint = ''): string {
  if (text.length <= max) return text
  const lines = text.split('\n')
  let used = 0
  let kept = 0
  while (kept < lines.length && used + lines[kept].length + 1 <= max) used += lines[kept++].length + 1
  return `${lines.slice(0, kept).join('\n')}\n[${lines.length - kept} more lines omitted${hint ? `; ${hint}` : ''}]`
}
