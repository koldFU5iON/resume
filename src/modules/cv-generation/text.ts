/** Small wording helpers for log lines and notes. Pure. */

/**
 * "1 pick", "3 picks". For a pair of words that are not a plain "s" plural
 * pass both: countOf(1, 'employer is', 'employers are') is "1 employer is".
 */
export function countOf(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : many ?? `${one}s`}`
}
