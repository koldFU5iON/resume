/**
 * Matching the Brief's lead-with and emphasise items to the profile, by NAME.
 *
 * An item is `{ name, framing }`: the framing is a long sentence ("Unity:
 * storytelling for a developer platform across ..."), which matched nothing
 * word for word, so covered items (Unity itself) were reported uncovered. The
 * match is on the short name: a normalised phrase (substring) or most of its
 * words, ignoring years and ordinals ("17th Unity Awards" matches a project
 * called "Unity Awards 2022"). Pure: no DB, no network.
 */

import type { BriefItem } from './schema'

export type NamedItem = BriefItem & { kind: 'lead-with' | 'emphasise' }

const FILLER = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'their', 'into', 'across', 'of', 'a', 'an', 'to', 'in', 'on', 'at', 'by'])

/** A year ("2022") or an ordinal ("17th"): never part of a name. */
const YEAR_OR_ORDINAL = /^(?:(?:19|20)\d{2}|\d+(?:st|nd|rd|th))$/

/** Single-word names this generic match nothing in a running text: they need a short, title-like text (a project label, a company), see `matchesName`. */
const GENERIC_WORDS = (['marketing', 'communication', 'product', 'program', 'programme', 'team', 'management', 'strategy', 'launch', 'design', 'engineering', 'sales', 'operation', 'delivery', 'content', 'brand', 'growth', 'project', 'platform'])

/** `GENERIC_WORDS` as stems (the comparison is on stems). */
const GENERIC_NAMES = new Set(GENERIC_WORDS.map((w) => stem(w)))

/** The longest text (in words) a single generic name may match: a label, not a sentence. */
const GENERIC_MAX_TEXT_WORDS = 3

/** Light stem: plural -s/-es and -ed/-ing only, so "launches" meets "launch" but "production" never meets "product". */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2)
  if (w.length > 4 && /(?:ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

/** The words of a text as stems: lower-case, years, ordinals and filler removed. */
export function nameTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter((w) => w.length >= 2 && !FILLER.has(w) && !YEAR_OR_ORDINAL.test(w))
    .map(stem)
}

/**
 * Whether `text` names `name`: EVERY word of a name of up to three words is
 * among the text's words (as a set, any order); a longer name needs a majority.
 * A name of one very generic word ("Marketing") matches only a short,
 * title-like text. Years and ordinals are ignored; a name with no usable word
 * matches nothing.
 */
export function matchesName(text: string, name: string): boolean {
  const want = nameTokens(name)
  if (want.length === 0) return false
  const have = nameTokens(text)
  if (want.length === 1 && GENERIC_NAMES.has(want[0]) && have.length > GENERIC_MAX_TEXT_WORDS) return false
  const haveSet = new Set(have)
  const present = want.filter((w) => haveSet.has(w)).length
  return present >= (want.length <= 3 ? want.length : Math.floor(want.length / 2) + 1)
}

/** How many of the name's words the text carries (0 when it does not match at all). */
export function matchedWords(text: string, name: string): number {
  if (!matchesName(text, name)) return 0
  const have = new Set(nameTokens(text))
  return nameTokens(name).filter((w) => have.has(w)).length
}

/** The lead-with and emphasise items as one list, de-duplicated by name (an item in both is emphasise). */
export function namedItems(brief: { leadWith?: readonly BriefItem[]; emphasise?: ReadonlyArray<BriefItem> }): NamedItem[] {
  const out: NamedItem[] = (brief.emphasise ?? []).map((e) => ({ name: e.name, framing: e.framing, kind: 'emphasise' }))
  for (const l of brief.leadWith ?? []) {
    if (!out.some((o) => o.name.trim().toLowerCase() === l.name.trim().toLowerCase())) out.push({ name: l.name, framing: l.framing, kind: 'lead-with' })
  }
  return out
}

/** The first of the items whose name `text` carries, or undefined. */
export function firstNamed(text: string, items: readonly NamedItem[]): NamedItem | undefined {
  return items.find((i) => matchesName(text, i.name))
}
