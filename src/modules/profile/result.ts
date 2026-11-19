// A structured result: the figure an achievement produced, with what it
// measures, where it started and the period it covers. Stored in
// RoleActivity.result (Json?). Pure: no database.
//
// Why: figures typed into prose carry no baseline or period, so two results
// ("3 weeks to 1 hour", "4 weeks to 1 week") cannot be told apart from one
// result stated twice. With the fields the profile, the readiness check and
// the CV generator all read the same thing.

import * as z from 'zod'

const MEASURE_MAX = 120
const FIGURE_MAX = 80

const optionalField = z.string().trim().max(FIGURE_MAX).nullish().transform((v) => v || null)

/** What the profile form sends and the server accepts. */
export const ResultInputSchema = z.object({
  /** What the figure measures: "asset turnaround time", "earned articles". */
  measure: z.string().trim().min(1, 'Say what the result measures').max(MEASURE_MAX),
  /** The result itself, with its unit: "1 hour", "150+", "38%". */
  value: z.string().trim().min(1, 'Enter the result').max(FIGURE_MAX),
  /** Where it started: "3 weeks". Optional. */
  baseline: optionalField,
  /** When or over what time: "Q3 2023", "first year". Optional. */
  period: optionalField,
})

export type Result = z.output<typeof ResultInputSchema>
export type ResultInput = z.input<typeof ResultInputSchema>

/** A stored value as a Result, or null when there is none or it is unreadable (a bad row must never break a page or a run). */
export function parseResult(raw: unknown): Result | null {
  if (raw === null || raw === undefined) return null
  const parsed = ResultInputSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** "asset turnaround time: 1 hour (from 3 weeks), Q3 2023". */
export function formatResult(r: Result): string {
  return `${r.measure}: ${r.value}${r.baseline ? ` (from ${r.baseline})` : ''}${r.period ? `, ${r.period}` : ''}`
}

// A figure is a number with the unit that follows it ("6 weeks", "40%", "2m"), so "2 squads" is not "2 weeks".
const FIGURE = /(?<![A-Za-z\d])(\d[\d,]*(?:\.\d+)?)\s?(%|[a-zA-Z]+)?/g
type Figure = { n: string; unit: string }
const figuresOf = (t: string): Figure[] =>
  [...t.matchAll(FIGURE)].map((m) => ({ n: m[1].replace(/,/g, ''), unit: (m[2] ?? '').toLowerCase().replace(/(?<=\w{3})s$/, '') }))
/** A figure is stated by the result when it has the same number and the same unit (or either has none). */
const stated = (f: Figure, known: Figure[]) => known.some((k) => k.n === f.n && (!f.unit || !k.unit || f.unit === k.unit))

/**
 * The impact text of an activity as readers should see it: the structured
 * result first, then the owner's free-text impact unless it only restates the
 * result's figures (every figure in it, number and unit, is in the result).
 * Without a result it is the free text unchanged. This is the one place the two
 * are merged, so Select, the writers, Review, the figure check and the
 * readiness checks never disagree about what an achievement says.
 */
export function combineImpact(impact: string | null | undefined, result: Result | null): string | null {
  const text = impact?.trim() || null
  if (!result) return text
  const formatted = formatResult(result)
  if (!text) return formatted
  const figures = figuresOf(text)
  if (figures.length > 0) {
    const known = figuresOf(formatted)
    if (figures.every((f) => stated(f, known))) return formatted
  }
  return `${formatted}; ${text}`
}
