/**
 * Form state for the "Eligibility & dealbreakers" card. The stored
 * `Eligibility` can't hold half-filled rows (a visa with no country yet, a
 * salary row with no floor yet), so the form edits a draft and converts it
 * back on save. Rows carry a `key` so React keeps focus and input state stable
 * when rows above them are removed. Keys of rows loaded from the profile are
 * deterministic (`visa-0`, `floor-0`, `deal-0`) so server and client render
 * the same ids; rows added in the browser get keys from a per-form counter
 * (see `EligibilityCard`). Salary amounts are kept as the text the user typed
 * and parsed by `parseAmount`, so "90k" or "90 000" can be entered and a bad
 * value gets an inline error instead of being dropped.
 *
 * Form helpers only: canonical normalisation happens server-side in
 * `saveSearchProfile` (`normalizeEligibility`).
 */

import {
  DEALBREAKER_MAX_COUNT,
  DEALBREAKER_MAX_LENGTH,
  type Eligibility,
} from '@/modules/search-profile/schema'
import { CURRENCIES } from '@/modules/job-assessment/eligibility'

export type VisaDraft = {
  key: string
  country: string | null
  type: string
  /** YYYY-MM-DD, or '' for no expiry (what a native date input gives back). */
  expiresOn: string
}

export type SalaryFloorDraft = {
  key: string
  currency: string
  /** Raw input text; see `parseAmount`. */
  floor: string
  /** Raw input text; '' for no target. */
  target: string
}

export type DealbreakerDraft = { key: string; text: string }

export type EligibilityDraft = {
  currentCountry: string | null
  /**
   * True while `currentCountry` is only the suggestion parsed from the profile
   * location. The spec has the user confirm it, so an unconfirmed suggestion
   * is shown but saved as null. Picking or confirming a country clears it.
   */
  currentCountrySuggested: boolean
  citizenships: string[]
  visas: VisaDraft[]
  salaryFloors: SalaryFloorDraft[]
  dealbreakers: DealbreakerDraft[]
}

export function toEligibilityDraft(e: Eligibility, suggestedCountry: string | null = null): EligibilityDraft {
  const suggest = e.currentCountry === null && suggestedCountry !== null
  return {
    currentCountry: suggest ? suggestedCountry : e.currentCountry,
    currentCountrySuggested: suggest,
    citizenships: [...e.citizenships],
    visas: e.visas.map((v, i) => ({ key: `visa-${i}`, country: v.country, type: v.type, expiresOn: v.expiresOn ?? '' })),
    salaryFloors: e.salaryFloors.map((f, i) => ({
      key: `floor-${i}`,
      currency: f.currency,
      floor: String(f.floor),
      target: f.target === null ? '' : String(f.target),
    })),
    dealbreakers: e.dealbreakers.map((text, i) => ({ key: `deal-${i}`, text })),
  }
}

/** Draft → stored shape. Untouched blank rows are dropped; invalid rows are caught by `validateEligibilityDraft` first. */
export function fromEligibilityDraft(d: EligibilityDraft): Eligibility {
  return {
    currentCountry: d.currentCountrySuggested ? null : d.currentCountry,
    citizenships: [...d.citizenships],
    visas: d.visas.flatMap((v) =>
      v.country ? [{ country: v.country, type: v.type.trim(), expiresOn: v.expiresOn || null }] : [],
    ),
    salaryFloors: d.salaryFloors.flatMap((f) => {
      const floor = parseAmount(f.floor)
      const target = parseAmount(f.target)
      if (!floor.ok || floor.value === null) return []
      return [{ currency: f.currency, floor: floor.value, target: target.ok ? target.value : null }]
    }),
    dealbreakers: d.dealbreakers
      .map((l) => l.text.trim().slice(0, DEALBREAKER_MAX_LENGTH))
      .filter((l) => l.length > 0)
      .slice(0, DEALBREAKER_MAX_COUNT),
  }
}

export type EligibilityDraftErrors = {
  /** Keyed by visa row key. */
  visas: Record<string, string>
  /** Keyed by salary row key. */
  floors: Record<string, { floor?: string; target?: string }>
}

export function validateEligibilityDraft(d: EligibilityDraft): EligibilityDraftErrors {
  const errors: EligibilityDraftErrors = { visas: {}, floors: {} }
  for (const v of d.visas) {
    if (!v.country && (v.type.trim() || v.expiresOn)) {
      errors.visas[v.key] = 'Choose a country, or remove this visa.'
    }
  }
  for (const f of d.salaryFloors) {
    const floor = parseAmount(f.floor)
    const target = parseAmount(f.target)
    const rowErrors: { floor?: string; target?: string } = {}
    if (!floor.ok) rowErrors.floor = floor.error
    if (!target.ok) rowErrors.target = target.error
    if (floor.ok && target.ok) {
      if (floor.value === null && target.value !== null) {
        rowErrors.floor = 'Enter your minimum, or remove this row.'
      } else if (floor.value !== null && target.value !== null && target.value < floor.value) {
        rowErrors.target = `Target must be at least your floor (${formatMoney(floor.value, f.currency)}).`
      }
    }
    if (rowErrors.floor || rowErrors.target) errors.floors[f.key] = rowErrors
  }
  return errors
}

export function hasDraftErrors(errors: EligibilityDraftErrors): boolean {
  return Object.keys(errors.visas).length > 0 || Object.keys(errors.floors).length > 0
}

/** Highest annual amount accepted; anything above is almost certainly a typo. */
export const AMOUNT_MAX = 100_000_000

export type ParsedAmount = { ok: true; value: number | null } | { ok: false; error: string }

/**
 * Read a typed salary amount. Accepts a leading currency symbol or code
 * ("€90,000", "CHF 120000"), thousands separators (comma, period, space,
 * apostrophe: "90,000", "90 000", "90.000"), decimals ("90000.50",
 * "90000,50") and a "k" suffix ("90k", "92.5k"). A single separator followed
 * by exactly three digits is read as thousands; otherwise as the decimal mark.
 * Empty → `{ ok: true, value: null }`.
 */
export function parseAmount(raw: string): ParsedAmount {
  let s = raw.trim()
  if (!s) return { ok: true, value: null }
  s = s.replace(/^[^\d.,-]+/, '') // leading symbol or code
  let multiplier = 1
  if (/k$/i.test(s)) {
    multiplier = 1000
    s = s.slice(0, -1)
  }
  s = s.replace(/[\s\u00a0\u202f']/g, '')
  if (!/^\d[\d.,]*$/.test(s) && !/^[.,]\d+$/.test(s)) {
    return { ok: false, error: 'Enter a number, e.g. 90000 or 90k.' }
  }

  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  let decimalMark: '.' | ',' | null = null
  if (lastDot !== -1 && lastComma !== -1) {
    decimalMark = lastDot > lastComma ? '.' : ','
  } else if (lastDot !== -1 || lastComma !== -1) {
    const mark = lastDot !== -1 ? '.' : ','
    const single = s.indexOf(mark) === s.lastIndexOf(mark)
    const digitsAfter = s.length - s.lastIndexOf(mark) - 1
    if (single && digitsAfter !== 3) decimalMark = mark
  }
  // Everything before the decimal mark is digits and thousands separators.
  const i = decimalMark ? s.lastIndexOf(decimalMark) : s.length
  const normalised = `${s.slice(0, i).replace(/[.,]/g, '')}.${s.slice(i + 1)}`

  const value = Math.round(Number(normalised) * multiplier * 100) / 100
  if (!Number.isFinite(value)) return { ok: false, error: 'Enter a number, e.g. 90000 or 90k.' }
  if (value > AMOUNT_MAX) {
    return { ok: false, error: `That looks too high. Enter an annual amount up to ${formatAmount(AMOUNT_MAX)}.` }
  }
  return { ok: true, value }
}

/** Format typed text for display when the field isn't being edited; unparseable text is shown as typed. */
export function formatAmountText(raw: string): string {
  const parsed = parseAmount(raw)
  return parsed.ok ? formatAmount(parsed.value) : raw
}

/** 90000 → "90,000"; null → "". */
export function formatAmount(value: number | null): string {
  return value === null ? '' : value.toLocaleString('en-GB')
}

export function currencySymbol(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code
}

export function formatMoney(value: number, currency: string): string {
  const symbol = currencySymbol(currency)
  const amount = formatAmount(value)
  // Letter symbols ("CHF", "kr") read better with a space.
  return /^[A-Za-z]/.test(symbol) && symbol.length > 1 ? `${symbol} ${amount}` : `${symbol}${amount}`
}

/** First currency in the list not already used by another row, or null when all are taken. */
export function nextUnusedCurrency(used: readonly string[], preferred?: string | null): string | null {
  if (preferred && !used.includes(preferred) && CURRENCIES.some((c) => c.code === preferred)) return preferred
  return CURRENCIES.find((c) => !used.includes(c.code))?.code ?? null
}
