// Company-name normalisation: the matching key for Company.normalizedName and
// aliases. Exact matches on this key are linked automatically; nothing fuzzier
// is (a wrong sponsor result is worse than none).

/** Legal-form and country suffixes stripped from the end of a name, repeatedly. */
const TRAILING_SUFFIXES = new Set([
  'ltd', 'limited', 'plc', 'llp', 'lp', 'inc', 'incorporated', 'llc', 'corp', 'corporation',
  'co', 'gmbh', 'ag', 'sa', 'sas', 'sarl', 'bv', 'nv', 'srl', 'spa', 'pty', 'pte', 'uk',
])

/** Normalised names that stand for "no company given", never matched or created. */
const PLACEHOLDERS = new Set([
  '', 'unknown', 'n a', 'na', 'none', 'confidential', 'undisclosed', 'not specified',
  'not disclosed', 'company', 'private', 'stealth', 'tbc', 'tba',
])

/** "X LTD T/A Y" / "X trading as Y": the legal name and the trading name. */
const TRADING_AS = /\s+(?:t\/a|t\.a\.|trading\s+as)\s+/i

/**
 * Lowercase, accents and punctuation removed, `&` read as "and", a leading
 * "the" and trailing legal suffixes (ltd, limited, plc, inc, gmbh, uk, …)
 * dropped. Returns '' for a blank name. A name made only of suffixes keeps
 * them ("Limited" → "limited") rather than becoming empty.
 */
export function normalizeCompanyName(raw: string | null | undefined): string {
  if (!raw) return ''
  const words = raw
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // accents, after NFKD
    .toLowerCase()
    .replace(/&/g, ' and ')
    // Dropped, not spaced: "S.A." → "sa", "U.K." → "uk".
    .replace(/['’`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  if (words.length === 0) return ''

  const kept = [...words]
  if (kept[0] === 'the' && kept.length > 1) kept.shift()
  while (kept.length > 1 && TRAILING_SUFFIXES.has(kept[kept.length - 1])) kept.pop()
  // "Smith & Co Ltd" → "smith and" after the suffixes go; drop the dangling "and".
  while (kept.length > 1 && kept[kept.length - 1] === 'and') kept.pop()
  return kept.join(' ')
}

/** True when a job's company field holds no usable name ("(unknown)", "Confidential", …). */
export function isPlaceholderCompany(raw: string | null | undefined): boolean {
  return PLACEHOLDERS.has(normalizeCompanyName(raw))
}

export type ParsedCompanyName = {
  /** Matching key for the legal name. */
  normalizedName: string
  /** Other keys the same company is known by (trading names), excluding normalizedName. */
  aliases: string[]
}

/**
 * Splits a register or job name into its legal-name key and trading-name
 * aliases: "BRANOS OXFORD LTD T/A LILO" → { normalizedName: 'branos oxford', aliases: ['lilo'] }.
 */
export function parseCompanyName(raw: string): ParsedCompanyName {
  const [legal, ...trading] = raw.split(TRADING_AS)
  const normalizedName = normalizeCompanyName(legal)
  const aliases = [...new Set(trading.map(normalizeCompanyName))]
    .filter((a) => a !== normalizedName && !PLACEHOLDERS.has(a))
  return { normalizedName, aliases }
}
