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

import { figuresIn, normalised } from './checks'
import { splitSentences } from './bullets'

/** Negation and exclusion words. */
export const NEGATION_WORDS = ['no', 'not', 'never', 'without', 'none', 'zero', 'nor', 'neither'] as const

/** Negation words in `text` that `evidence` does not contain, in order, once each. */
export function negationDrift(text: string, evidence: string): string[] {
  const have = new Set(normalised(evidence))
  const out: string[] = []
  for (const w of normalised(text)) {
    if ((NEGATION_WORDS as readonly string[]).includes(w) && !have.has(w) && !out.includes(w)) out.push(w)
  }
  return out
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

/**
 * Claims or figures of `text` that lose the qualifier the evidence gives them.
 * Each evidence sentence that holds a claim and a qualifier is checked: a
 * bullet that repeats the claim without the qualifier is a drift. A sentence
 * with "to date" / "at the time" and a figure the bullet also states is a drift
 * when the bullet leaves the qualifier out. Once per qualifier. Pure.
 */
export function scopeDrift(text: string, evidence: readonly string[]): ScopeDrift[] {
  const out: ScopeDrift[] = []
  const add = (d: ScopeDrift) => { if (!out.some((o) => o.qualifier === d.qualifier)) out.push(d) }
  const bulletFigures = new Set(figuresIn(text).map((f) => f.key))
  for (const sentence of evidence.flatMap((e) => splitSentences(e))) {
    const qualifiers = QUALIFIERS.filter(([, re]) => re.test(sentence)).map(([name]) => name)
    if (qualifiers.length === 0) continue
    for (const q of qualifiers) {
      const qre = QUALIFIERS.find(([name]) => name === q)![1]
      if (qre.test(text)) continue
      const claim = CLAIMS.find(([, re]) => re.test(sentence) && re.test(text))
      if (claim) { add({ claim: claim[0], qualifier: q }); continue }
      if (FIGURE_QUALIFIERS.has(q)) {
        const shared = figuresIn(sentence).find((f) => bulletFigures.has(f.key))
        if (shared) add({ claim: shared.raw, qualifier: q })
      }
    }
  }
  return out
}
