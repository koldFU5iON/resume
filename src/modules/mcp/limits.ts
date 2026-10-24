// Every MCP tool response is capped so an oversized result (or injected text
// inside one) cannot flood the client. Truncation is always visible.
export const MAX_TOOL_RESPONSE_CHARS = 60_000

// Keeps the first `max` characters verbatim and appends a marker naming how
// many characters were dropped. Text at or under the cap is returned as is.
export function capText(text: string, max: number = MAX_TOOL_RESPONSE_CHARS): string {
  if (text.length <= max) return text
  const omitted = text.length - max
  return `${text.slice(0, max)}\n[truncated: ${omitted} characters omitted]`
}

export function escapedLength(text: string): number {
  return JSON.stringify(text).length - 2
}

// Keeps the start of `text`, cutting so it is at most `maxChars` characters and
// `maxEscaped` characters once JSON-escaped, and appends a visible marker.
export function capField(text: string, maxEscaped: number, maxChars = Infinity): string {
  if (text.length <= maxChars && escapedLength(text) <= maxEscaped) return text
  let cut = Math.min(text.length, maxChars)
  while (cut > 0 && escapedLength(text.slice(0, cut)) > maxEscaped) {
    cut = Math.floor(cut * 0.9)
  }
  return `${text.slice(0, cut)}\n[truncated: ${text.length - cut} characters omitted]`
}
