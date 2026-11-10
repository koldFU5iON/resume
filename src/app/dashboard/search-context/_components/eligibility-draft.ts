/**
 * Form state for the "Eligibility & dealbreakers" card. The stored
 * `Eligibility` can't hold half-filled rows (a visa with no country yet, a
 * salary row with no floor yet), so the form edits a draft and converts it
 * back on save. Rows carry a `key` so React keeps focus and input state stable
 * when rows above them are removed.
 *
 * Form helpers only: canonical normalisation happens server-side in
 * `saveSearchProfile` (`normalizeEligibility`).
 */

import {
  DEALBREAKER_MAX_COUNT,
  DEALBREAKER_MAX_LENGTH,
  type Eligibility,
} from '@/modules/search-profile/schema'
import { CURRENCIES, toCountryCode } from '@/modules/job-assessment/eligibility'

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
  floor: number | null
  target: number | null
}

export type DealbreakerDraft = { key: string; text: string }

export type EligibilityDraft = {
  currentCountry: string | null
  citizenships: string[]
  visas: VisaDraft[]
  salaryFloors: SalaryFloorDraft[]
  dealbreakers: DealbreakerDraft[]
}

let keyCounter = 0
export function newRowKey(): string {
  keyCounter += 1
  return `row-${keyCounter}`
}

export function toEligibilityDraft(e: Eligibility, suggestedCountry: string | null = null): EligibilityDraft {
  return {
    currentCountry: e.currentCountry ?? suggestedCountry,
    citizenships: [...e.citizenships],
    visas: e.visas.map((v) => ({ key: newRowKey(), country: v.country, type: v.type, expiresOn: v.expiresOn ?? '' })),
    salaryFloors: e.salaryFloors.map((f) => ({ key: newRowKey(), currency: f.currency, floor: f.floor, target: f.target })),
    dealbreakers: e.dealbreakers.map((text) => ({ key: newRowKey(), text })),
  }
}

/** Draft → stored shape. Untouched blank rows are dropped; invalid rows are caught by `validateEligibilityDraft` first. */
export function fromEligibilityDraft(d: EligibilityDraft): Eligibility {
  return {
    currentCountry: d.currentCountry,
    citizenships: [...d.citizenships],
    visas: d.visas.flatMap((v) =>
      v.country ? [{ country: v.country, type: v.type.trim(), expiresOn: v.expiresOn || null }] : [],
    ),
    salaryFloors: d.salaryFloors.flatMap((f) =>
      f.floor !== null ? [{ currency: f.currency, floor: f.floor, target: f.target }] : [],
    ),
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
    if (f.floor === null && f.target !== null) {
      errors.floors[f.key] = { floor: 'Enter your minimum, or remove this row.' }
    } else if (f.floor !== null && f.target !== null && f.target < f.floor) {
      errors.floors[f.key] = {
        target: `Target must be at least your floor (${formatMoney(f.floor, f.currency)}).`,
      }
    }
  }
  return errors
}

export function hasDraftErrors(errors: EligibilityDraftErrors): boolean {
  return Object.keys(errors.visas).length > 0 || Object.keys(errors.floors).length > 0
}

/** Digits only → number; anything else (separators, symbols) is ignored. Empty → null. */
export function parseAmount(raw: string): number | null {
  const digits = raw.replace(/[^0-9]/g, '')
  return digits ? Number(digits) : null
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

/**
 * Best-effort country from a free-text profile location ("Paris, France",
 * "London, UK", "FR"). Tries the whole string, then each comma/slash-separated
 * part from the last one in. Null when nothing matches.
 */
export function countryFromLocation(location: string | null | undefined): string | null {
  if (!location) return null
  const whole = toCountryCode(location)
  if (whole) return whole
  const parts = location.split(/[,/|·]/).map((p) => p.trim()).filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i--) {
    const code = toCountryCode(parts[i])
    if (code) return code
  }
  return null
}
