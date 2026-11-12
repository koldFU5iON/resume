/**
 * Search for the "Replace with a CV…" picker (#383). cmdk values must be
 * unique, so each carries the CV's id after SOURCE_ID_SEPARATOR; only the
 * label part is searched. Every word typed must appear in the label (cmdk's
 * default fuzzy match is too loose for CV titles).
 */
export const SOURCE_ID_SEPARATOR = "\u0000"

export function sourceOptionValue(label: string, id: string): string {
  return `${label}${SOURCE_ID_SEPARATOR}${id}`
}

export function matchSourceLabel(value: string, search: string): number {
  const label = value.split(SOURCE_ID_SEPARATOR)[0].toLowerCase()
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  return words.every(word => label.includes(word)) ? 1 : 0
}
