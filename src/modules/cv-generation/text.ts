/** Small wording helpers for log lines and notes. Pure. */

/**
 * "1 pick", "3 picks". For a pair of words that are not a plain "s" plural
 * pass both: countOf(1, 'employer is', 'employers are') is "1 employer is".
 */
export function countOf(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : many ?? `${one}s`}`
}

const LETTER_FOLDS: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', þ: 'th', ł: 'l', ı: 'i' }

/**
 * Lower-case with accents removed, for matching names: "Wētā Tools" is
 * "weta tools", "Müller" is "muller" (NFD, combining marks stripped, and the
 * few letters NFD does not decompose folded: ß ae oe ø ...). Pure.
 */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[ßæœøđðþłı]/g, (c) => LETTER_FOLDS[c])
}
