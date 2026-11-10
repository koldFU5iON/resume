import * as z from 'zod'
// Dependency-free data module (no imports), so this doesn't create a
// search-profile ↔ job-assessment import cycle.
import { toCountryCode } from '@/modules/job-assessment/countries'

export const SalaryBandSchema = z.object({
  min: z.number().nullable().default(null),
  max: z.number().nullable().default(null),
  currency: z.string().default('GBP'),
})

export type SalaryBand = z.infer<typeof SalaryBandSchema>

/**
 * Lenient array: a non-array becomes [], and items that fail `item` are dropped
 * instead of failing the whole profile.
 */
function lenientArray<T extends z.ZodType>(item: T) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((items): z.output<T>[] =>
      items.flatMap((raw) => {
        const r = item.safeParse(raw)
        return r.success ? [r.data] : []
      }),
    )
}

/**
 * A real ISO 3166-1 alpha-2 country, normalised with `toCountryCode`: "fr" →
 * "FR", "UK" → "GB", "France" → "FR". Codes that aren't countries ("EU",
 * "ZZ") fail.
 */
const CountryCodeSchema = z.string().transform((value, ctx) => {
  const code = toCountryCode(value)
  if (code) return code
  ctx.addIssue({ code: 'custom', message: 'Not a country' })
  return z.NEVER
})

/** Trimmed string, truncated to `max` instead of failing. Non-strings still fail. */
function truncatedText(max: number) {
  return z.string().transform((s) => s.trim().slice(0, max).trimEnd())
}

/** Tolerant text field: like `truncatedText`, but anything that isn't a string becomes ''. */
function lenientText(max: number) {
  return truncatedText(max).catch('')
}

/** ISO 4217 shape ("eur" → "EUR"). */
const CurrencyCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/)

/** A real calendar date written as YYYY-MM-DD. */
const IsoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
  })

export const VisaSchema = z.object({
  country:   CountryCodeSchema,
  /** Free text, e.g. "Skilled Worker", "H-1B", "Blue Card". */
  type:      z.string().trim().max(100).catch('').default(''),
  /** YYYY-MM-DD, or null for no expiry. A malformed date drops the whole visa (see EligibilitySchema). */
  expiresOn: IsoDateSchema.nullable().default(null),
})

export type Visa = z.infer<typeof VisaSchema>

export const SalaryFloorSchema = z.object({
  currency: CurrencyCodeSchema,
  /** Lowest acceptable annual gross pay in `currency`. */
  floor:    z.number().nonnegative(),
  /** Annual pay the user is aiming for; null when unset. */
  target:   z.number().nonnegative().nullable().catch(null).default(null),
})

export type SalaryFloor = z.infer<typeof SalaryFloorSchema>

export const DEALBREAKER_MAX_COUNT = 10
export const DEALBREAKER_MAX_LENGTH = 200

/**
 * Work-rights, location and pay facts used by the early job assessment
 * (spec §2). Parsing never throws: a malformed field becomes its empty value
 * and invalid list items are dropped. Normalisation applied on every parse:
 *
 * - country and currency codes are trimmed and uppercased; anything not shaped
 *   like a code is dropped (currentCountry becomes null)
 * - citizenships are de-duplicated
 * - a visa with a missing/invalid country or a malformed `expiresOn` is dropped
 *   (an unreadable expiry must not be read as "never expires")
 * - salaryFloors keep the first entry per currency; a `target` below its
 *   `floor` is dropped (set to null) rather than rejecting the floor
 * - dealbreakers are trimmed; empty, duplicate and over-long (> 200 chars)
 *   lines are dropped, and only the first 10 are kept
 */
export const EligibilitySchema = z.object({
  /** Where the user lives now. ISO alpha-2 or null. */
  currentCountry: CountryCodeSchema.nullable().catch(null).default(null),
  /** ISO alpha-2, unique. */
  citizenships: lenientArray(CountryCodeSchema).transform((codes) => [...new Set(codes)]),
  visas: lenientArray(VisaSchema),
  /** At most one floor per currency. */
  salaryFloors: lenientArray(SalaryFloorSchema).transform((floors) => {
    const seen = new Set<string>()
    return floors.flatMap((f) => {
      if (seen.has(f.currency)) return []
      seen.add(f.currency)
      return [{ ...f, target: f.target !== null && f.target < f.floor ? null : f.target }]
    })
  }),
  /** Short lines such as "Fixed-term contract"; matched against the job by Jev. */
  dealbreakers: lenientArray(z.string().trim().min(1).max(DEALBREAKER_MAX_LENGTH)).transform((lines) =>
    [...new Set(lines)].slice(0, DEALBREAKER_MAX_COUNT),
  ),
})

export type Eligibility = z.infer<typeof EligibilitySchema>

function makeEmptyEligibility(): Eligibility {
  return { currentCountry: null, citizenships: [], visas: [], salaryFloors: [], dealbreakers: [] }
}

export const emptyEligibility: Eligibility = makeEmptyEligibility()

/** Parse any stored or submitted value into a clean Eligibility; never throws. */
export function normalizeEligibility(value: unknown): Eligibility {
  const result = EligibilitySchema.safeParse(value ?? {})
  return result.success ? result.data : makeEmptyEligibility()
}

export function eligibilityHasContent(e: Eligibility): boolean {
  return (
    e.currentCountry !== null ||
    e.citizenships.length > 0 ||
    e.visas.length > 0 ||
    e.salaryFloors.length > 0 ||
    e.dealbreakers.length > 0
  )
}

export const SEARCH_PROFILE_FIELDS = [
  'preferredName', 'currentRole', 'roles', 'countries',
  'remotePreference', 'salaryBand', 'careerGoals', 'pivotContext', 'extraContext',
] as const

export type SearchProfileField = typeof SEARCH_PROFILE_FIELDS[number]

/**
 * Tolerant per field: a missing or malformed field falls back to its empty
 * value, over-long text is truncated, and non-string list items are dropped,
 * so one bad field never empties the whole profile. Only a non-object input
 * fails to parse.
 */
export const SearchProfileSchema = z.object({
  preferredName:    lenientText(120),
  currentRole:      lenientText(200),
  roles:            lenientArray(truncatedText(100)),
  countries:        lenientArray(truncatedText(100)),
  remotePreference: z.enum(['remote', 'hybrid', 'onsite', 'flexible', '']).catch('').default(''),
  salaryBand:       SalaryBandSchema.nullable().catch(null).default(null),
  careerGoals:      lenientText(3000),
  pivotContext:     lenientText(3000),
  extraContext:     lenientText(3000),
  eligibility:      EligibilitySchema.catch(makeEmptyEligibility).default(makeEmptyEligibility),
})

export type SearchProfile = z.infer<typeof SearchProfileSchema>

export const SearchSuggestionSchema = z.object({
  id:             z.string(),
  field:          z.enum(SEARCH_PROFILE_FIELDS),
  suggestedValue: z.unknown(),
  reason:         z.string(),
  source:         z.enum(['job-fit', 'chat', 'cover-letter', 'interview-prep']),
  createdAt:      z.string(),
})

export type SearchSuggestion = z.infer<typeof SearchSuggestionSchema>

export const emptySearchProfile: SearchProfile = {
  preferredName: '', currentRole: '', roles: [], countries: [],
  remotePreference: '', salaryBand: null,
  careerGoals: '', pivotContext: '', extraContext: '',
  eligibility: emptyEligibility,
}

export function normalizeSearchProfile(value: unknown): SearchProfile {
  const result = SearchProfileSchema.safeParse(value ?? {})
  return result.success ? result.data : { ...emptySearchProfile, eligibility: makeEmptyEligibility() }
}

export function searchProfileHasContent(profile: SearchProfile): boolean {
  return (
    profile.preferredName.length > 0 ||
    profile.currentRole.length > 0 ||
    profile.roles.length > 0 ||
    profile.countries.length > 0 ||
    profile.remotePreference !== '' ||
    profile.salaryBand !== null ||
    profile.careerGoals.length > 0 ||
    profile.pivotContext.length > 0 ||
    profile.extraContext.length > 0 ||
    eligibilityHasContent(profile.eligibility)
  )
}

export function normalizeSuggestions(value: unknown): SearchSuggestion[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const r = SearchSuggestionSchema.safeParse(item)
    return r.success ? [r.data] : []
  })
}

export function formatSalaryBand(band: SalaryBand): string {
  const symbol = band.currency === 'GBP' ? '£' : band.currency === 'EUR' ? '€' : '$'
  const min = band.min != null ? `${symbol}${band.min.toLocaleString()}` : null
  const max = band.max != null ? `${symbol}${band.max.toLocaleString()}` : null
  if (min && max) return `${min}–${max} ${band.currency}`
  if (min) return `${min}+ ${band.currency}`
  if (max) return `${max} ${band.currency}`
  return band.currency
}
