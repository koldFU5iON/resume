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

/** Light stem: a plural "s" dropped, then the first six letters, so "automation" and "automated" meet. */
function stem(w: string): string {
  const base = w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w
  return base.length > 6 ? base.slice(0, 6) : base
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

/** How many of a name's words a text needs to contain: all of one or two, two thirds of more. */
function wordsNeeded(n: number): number {
  return n <= 2 ? n : Math.ceil((n * 2) / 3)
}

/**
 * Whether `text` names `name`: its normalised words contain the name's words
 * as a phrase, or at least `wordsNeeded` of them anywhere. A name with no
 * usable word (only a year, say) matches nothing.
 */
export function matchesName(text: string, name: string): boolean {
  const want = nameTokens(name)
  if (want.length === 0) return false
  const have = nameTokens(text)
  const haveSet = new Set(have)
  const present = want.filter((w) => haveSet.has(w)).length
  if (present === want.length) return true
  return present >= wordsNeeded(want.length)
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
