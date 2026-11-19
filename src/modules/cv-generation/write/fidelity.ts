/**
 * Paraphrase fidelity checks for bullets: a rewording may change length, never
 * meaning. Two soft, best-effort checks (a retry reason in the writer, an edit
 * refusal in Review):
 *
 * - negationDrift: a negation or exclusion word the bullet has and its
 *   evidence does not ("voluntarily adopted ... rather than mandate" must not
 *   become "with no mandate").
 * - scopeDrift: evidence that makes a superlative or first/only claim inside a
 *   scope ("the territory's largest order", "best result ever in the team")
 *   keeps that scope, or the bullet drops the superlative; and a figure the
 *   evidence ties to "to date" / "at the time" keeps that qualifier.
 *
 * Pure.
 */

import { figuresIn } from './checks'
import { splitSentences } from './bullets'

/** Negation and exclusion words, ONE class: "no", "zero" and "without" are interchangeable renderings of the same exclusion. */
export const NEGATION_WORDS = ['no', 'not', 'never', 'without', 'none', 'zero', 'nor', 'neither', 'cannot'] as const

/** Non-negating idioms ("not only X but Y", "no longer", "No. 1") removed before looking for a negation. Conservative. */
const NON_NEGATING = /\bnot (?:only|just|least)\b|\bno longer\b|\bno\.?\s*\d+\b/gi
const NEGATION = new RegExp(`\\b(?:${NEGATION_WORDS.join('|')})\\b|\\b\\w+n['\u2019]t\\b`, 'gi')

/** The negation tokens in a text, lower-cased, in order (idioms excluded). */
export function negationsIn(text: string): string[] {
  return [...text.replace(NON_NEGATING, ' ').matchAll(NEGATION)].map((m) => m[0].toLowerCase())
}

/**
 * The negations `text` adds: those it has when its evidence has NONE (any
 * negation word in the evidence covers the whole class). Only the ADDED
 * direction is checked; a negation dropped from a bullet is not flagged (a
 * rewording such as "uninterrupted" for "with no downtime" is legitimate).
 */
export function negationDrift(text: string, evidence: string): string[] {
  const mine = negationsIn(text)
  if (mine.length === 0 || negationsIn(evidence).length > 0) return []
  return [...new Set(mine)]
}

/** Superlative and first/only claims. */
const CLAIMS: Array<[string, RegExp]> = [
  ['largest', /\blargest\b/i], ['biggest', /\bbiggest\b/i], ['first', /\bfirst\b/i], ['only', /\bonly\b/i], ['best', /\bbest\b/i], ['most', /\bmost\b/i], ['record', /\brecord\b/i],
]
/** Scope qualifiers that bound a claim. */
const QUALIFIERS: Array<[string, RegExp]> = [
  ['territory', /\bterritor(?:y|ies)\b/i], ['region', /\bregion(?:s|al)?\b/i], ['at the time', /\bat the time\b/i], ['to date', /\bto date\b/i],
  ['in the company', /\bin the company\b/i], ['ever', /\bever\b/i], ['annual', /\bannual(?:ly)?\b/i],
]
/** The qualifiers that stay attached to a figure. */
const FIGURE_QUALIFIERS = new Set(['at the time', 'to date'])

export type ScopeDrift = { claim: string; qualifier: string }

/** The qualifier must sit within this many words of the claim (or figure) in the evidence sentence to count as its scope. */
export const SCOPE_PROXIMITY_WORDS = 4
/** Words after a claim word that make it a non-claim ("first quarter", "most senior", "only a few"...). */
const NON_CLAIM_NEXT = /^(?:quarter|half|year|month|week|day|line|step|phase|draft|time|senior|recent|common|of|a|an|few)\b/i

/** Words between two character positions of a sentence. */
function wordsBetween(sentence: string, i: number, j: number): number {
  const [a, b] = i <= j ? [i, j] : [j, i]
  return sentence.slice(a, b).trim().split(/\s+/).filter(Boolean).length
}

/**
 * Claims or figures of `text` that lose the qualifier the evidence gives them.
 * An evidence sentence is checked when a claim word and a qualifier stand
 * within SCOPE_PROXIMITY_WORDS of each other (and the claim word is a real
 * claim, not "first quarter" or "most senior"): a bullet that repeats the
 * claim without the qualifier is a drift. "to date" / "at the time" next to a
 * figure the bullet also states must be kept too. Once per qualifier. Pure.
 */
export function scopeDrift(text: string, evidence: readonly string[]): ScopeDrift[] {
  const out: ScopeDrift[] = []
  const add = (d: ScopeDrift) => { if (!out.some((o) => o.qualifier === d.qualifier)) out.push(d) }
  const bulletFigures = new Set(figuresIn(text).map((f) => f.key))
  for (const sentence of evidence.flatMap((e) => splitSentences(e))) {
    for (const [qname, qre] of QUALIFIERS) {
      const qm = qre.exec(sentence)
      if (!qm || qre.test(text)) continue
      const claim = CLAIMS.find(([, re]) => {
        const m = re.exec(sentence)
        if (!m || !re.test(text)) return false
        if (NON_CLAIM_NEXT.test(sentence.slice(m.index + m[0].length).trim())) return false
        return wordsBetween(sentence, m.index, qm.index) <= SCOPE_PROXIMITY_WORDS
      })
      if (claim) { add({ claim: claim[0], qualifier: qname }); continue }
      if (FIGURE_QUALIFIERS.has(qname)) {
        const shared = figuresIn(sentence).find((f) => bulletFigures.has(f.key) && sentence.indexOf(f.raw) >= 0 && wordsBetween(sentence, sentence.indexOf(f.raw), qm.index) <= SCOPE_PROXIMITY_WORDS + 1)
        if (shared) add({ claim: shared.raw, qualifier: qname })
      }
    }
  }
  return out
}
