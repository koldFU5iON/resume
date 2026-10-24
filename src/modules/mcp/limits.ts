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
