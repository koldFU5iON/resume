/**
 * Shared types and tuning constants for the early job assessment (Jev).
 *
 * Source of truth: docs/superpowers/specs/2026-11-10-jev-early-assessment-design.md
 * (§3 facts schema, §5 combine rules). Every threshold and weight the pure
 * modules use lives in ASSESSMENT_CONFIG; change numbers here, never in the
 * modules, and bump PIPELINE_VERSION on any change so results from different
 * tunings never get mixed up.
 *
 * Pure module: no DB, no network.
 */

import * as z from 'zod'
import { toCountryCode } from './countries'

/** Stored on every run. Bump on any change to wording, thresholds or weights. */
export const PIPELINE_VERSION = 'early-v2'

/**
 * Job description cap, in characters, for every request built from it: the
 * verify state, the facts prompt and the judge state. Descriptions are rarely
 * near this; it bounds pathological pages.
 */
export const DESCRIPTION_MAX_CHARS = 40_000

// ── Facts (cheap model, spec §3) ────────────────────────────────────────────

export const REQUIREMENT_KINDS = [
  'education', 'certification', 'licence', 'clearance', 'language',
  'experience', 'skill', 'availability',
] as const

export type RequirementKind = typeof REQUIREMENT_KINDS[number]

/**
 * Kinds that block outright when a must-have scores below the gap threshold
 * (spec §5 Blockers). `education` is deliberately not here (early-v2): experience
 * outweighs a degree for non-regulated roles, so it is in SOFT_CREDENTIAL_KINDS.
 */
export const CREDENTIAL_KINDS: ReadonlySet<RequirementKind> = new Set([
  'certification', 'licence', 'clearance', 'language',
])

/**
 * Credential kinds that only warn: a must-have below the gap threshold becomes
 * an unconfirmed blocker and counts as one penalty item, never a hard block.
 */
export const SOFT_CREDENTIAL_KINDS: ReadonlySet<RequirementKind> = new Set(['education'])

// Model output is tolerated rather than rejected: over-long strings are
// trimmed and cut, over-long lists are cut, and unreadable country codes and
// currencies are dropped. One stray field must not fail the whole facts step.
// `.transform` (not `.preprocess`) keeps each field's JSON Schema for the
// model: the AI SDK converts with `io: 'input'`, where a transform keeps its
// input type and a preprocess would become "any". The limits are in
// `.describe` so the model still sees them.

/** Trimmed string cut to `max` chars instead of failing. */
function cutText(max: number, description: string) {
  return z.string().describe(`${description} (at most ${max} characters)`).transform((v) => v.trim().slice(0, max).trim())
}

/** ISO 3166-1 alpha-2 codes; aliases are normalised ("UK" → "GB"), unknown values dropped, duplicates removed. */
const CountryCodesSchema = z.array(z.string()).describe('ISO 3166-1 alpha-2 country codes').transform((values) =>
  [...new Set(values.map((v) => toCountryCode(v)).filter((c): c is string => c !== null))],
)

export const JobRequirementSchema = z.object({
  text: cutText(220, 'The requirement, in the description\'s own words'),
  kind: z.enum(REQUIREMENT_KINDS),
  importance: z.enum(['must', 'nice']),
  /** Set when the requirement names a number of years; `area` is the kind of work, without the number. A non-positive `min` reads as null. */
  years: z.object({ min: z.number(), area: cutText(160, 'The kind of work, without the number') })
    .nullable()
    .transform((y) => (y && y.min > 0 && y.area ? y : null)),
  /** Only for "all of these" lists; "or" alternatives are never split. Empty lists read as null. */
  parts: z.array(cutText(80, 'One distinct thing'))
    .describe('At most 6 parts')
    .nullable()
    .transform((p) => {
      const parts = p?.filter(Boolean).slice(0, 6) ?? []
      return parts.length > 0 ? parts : null
    }),
})

export type JobRequirement = z.infer<typeof JobRequirementSchema>

const SalarySchema = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
  currency: z.string().describe('ISO 4217 code, e.g. EUR'),
  period: z.enum(['year', 'month', 'day', 'hour']),
})
  .nullable()
  // A salary with no usable currency can't be compared with a floor: drop it.
  .transform((s) => {
    if (!s) return null
    const currency = s.currency.trim().toUpperCase()
    return /^[A-Z]{3}$/.test(currency) ? { ...s, currency } : null
  })

export const JobFactsSchema = z.object({
  requirements: z.array(JobRequirementSchema).describe('At most 14 requirements').transform((r) => r.slice(0, 14)),
  location: z.object({
    countries: CountryCodesSchema,
    mode: z.enum(['onsite', 'hybrid', 'remote_in_country', 'remote_region', 'remote_anywhere', 'unknown']),
    basedInRequired: z.boolean(),
    remoteRegions: z.array(z.string()).default([]),
  }),
  salary: SalarySchema,
  seniority: z.enum([
    'intern', 'junior', 'mid', 'senior', 'staff', 'principal', 'lead', 'manager', 'director', 'vp', 'exec', 'unknown',
  ]),
  employmentType: z.enum(['permanent', 'fixed_term', 'contract', 'internship', 'unknown']),
})

export type JobFacts = z.infer<typeof JobFactsSchema>

// ── Tuning constants (spec §4–§5) ───────────────────────────────────────────

export type AssessmentLevel = 'weak' | 'consider' | 'pursue' | 'priority'

export const ASSESSMENT_CONFIG = {
  verify: {
    /** Code check: description length after trimming. */
    minDescriptionChars: 600,
    /** Pass needs `is_full_description ≥` this. */
    isFullDescription: 0.7,
    /** Pass needs `has_requirements ≥` this. */
    hasRequirements: 0.5,
  },

  /** Noul bands for requirement questions (TypeSafe's suggested 0.7 / 0.3 starting points). */
  requirement: {
    /** `p ≥ met` reads as met → strength candidate. */
    met: 0.7,
    /** `p < gap` reads as not met → credential block / major gap. Between the two: unsettled. */
    gap: 0.3,
  },

  /** Coverage weights by importance. */
  coverageWeights: { must: 2, nice: 1 },

  /** Composite weights. `base` is used when direction_fit isn't asked (the tested set). */
  scoreWeights: {
    base: { coverage: 0.40, skills: 0.30, seniority: 0.18, domain: 0.12 },
    withDirection: { coverage: 0.34, skills: 0.26, seniority: 0.15, domain: 0.10, direction: 0.15 },
  },

  /** Value of each seniority_fit option; the signal is Σ p(option) · value. */
  seniorityValues: { well_below: 0.2, below: 0.6, match: 1, above: 0.6, well_above: 0.2 },

  /** Score levels: skills_match has 5 (0–4), domain_fit and direction_fit 4 (0–3). */
  rubricMax: { skills: 4, domain: 3, direction: 3 },

  /** −perItem for each major gap, years warning, years stretch and missing education must-have, at most −cap. */
  penalty: { perItem: 0.5, cap: 2 },

  /** Subtracted from the composite when the stated max pay is below the user's target. */
  belowTargetPayPenalty: 0.05,

  years: {
    /** Weight of each share option (spec §5). */
    shareWeights: { most_of_the_role: 1, about_half: 0.5, small_part: 0, none: 0 },
    /** A role counts only when its share is at least this. */
    countThreshold: 0.5,
    /** warn when est ≥ warnRatio × required … */
    warnRatio: 0.5,
    /** … or required − est ≤ warnGapYears. */
    warnGapYears: 2,
    /** A block becomes a stretch when capability ≥ this. */
    capabilityStretch: 0.7,
  },

  dealbreaker: {
    /** `p > hard` → hard blocker. */
    hard: 0.7,
    /** `p ≥ unconfirmed` (and ≤ hard) → unconfirmed. */
    unconfirmed: 0.3,
  },

  /** Up to this many must-haves with p ≥ met appear in strengths (met years requirements come on top). */
  maxStrengths: 3,

  /** Highest level whose `min` the score reaches. Spec: 1–2 weak · 3–4 consider · 5–7 pursue · 8–10 priority. */
  ladder: [
    { min: 8, level: 'priority' },
    { min: 5, level: 'pursue' },
    { min: 3, level: 'consider' },
    { min: 1, level: 'weak' },
  ] as ReadonlyArray<{ min: number; level: AssessmentLevel }>,
} as const

// ── Run state (stored on JobAssessment) ─────────────────────────────────────

export type AssessmentStatus = 'queued' | 'checking' | 'fetching' | 'assessing' | 'complete' | 'failed'

/** A run in progress for longer than this is treated as dead (its after() was killed). */
export const IN_PROGRESS_STALE_MS = 5 * 60_000

/** A queued row older than this is treated as dead (its drain never ran). */
export const QUEUED_STALE_MS = 15 * 60_000

/** In-progress statuses: a run in one of these is being worked on. */
export const IN_PROGRESS_STATUSES = ['checking', 'fetching', 'assessing'] as const satisfies readonly AssessmentStatus[]

/**
 * Why a run failed (stored in JobAssessment.failureKind).
 * - verification   the job details are too thin to assess, even after fetching
 * - no_llm_key     the user has no LLM key for the cheap-model steps
 * - not_configured TYPESAFE_API_KEY unset when the run started
 * - daily_cap      the profile hit JEV_DAILY_CALL_LIMIT
 * - rate_limited   TypeSafe returned 429 after retries
 * - overloaded     TypeSafe returned 529 after retries
 * - superseded     a newer run for the same job was queued before this one started
 * - error          anything else (also: a stale run, in the read view model)
 */
export type FailureKind =
  | 'verification'
  | 'no_llm_key'
  | 'not_configured'
  | 'daily_cap'
  | 'rate_limited'
  | 'overloaded'
  | 'superseded'
  | 'error'

// ── Result (combine.ts output) ──────────────────────────────────────────────

export type BlockerKind =
  | 'credential'   // credential must-have below the gap threshold
  | 'years'        // years must-have: block / warn / stretch
  | 'work_rights'
  | 'relocation'
  | 'pay'
  | 'dealbreaker'

/**
 * One flag from the spec §5 Blockers table (major gaps are not blockers; they
 * go to `gaps`).
 *
 * - `hard`        red; any hard blocker makes the result Blocked
 * - `unconfirmed` amber; the description doesn't settle it — the deep dive should check
 * - `stretch`     amber; years short but strong transferable experience (counts toward the penalty)
 * - `warn`        amber; years somewhat short (counts toward the penalty)
 *
 * Spec §5 "Detail contents" shows hard + unconfirmed under Blockers and years
 * warn/stretch under Gaps (ahead of major gaps); filter on `severity` to render.
 */
export interface Blocker {
  kind: BlockerKind
  severity: 'hard' | 'unconfirmed' | 'stretch' | 'warn'
  label: string
  detail?: string
}

export type YearsStatus = 'met' | 'warn' | 'stretch' | 'block'

/** How one role contributed to a years estimate. */
export interface YearsRoleBreakdown {
  /** `role_1` … (newest first). */
  key: string
  /** Role title, for display. */
  label: string
  /** Probability-weighted share, averaged over both option orders (0–1). */
  share: number
  /** share ≥ countThreshold. */
  counted: boolean
  /** Months in the role (to today for 'present'). */
  months: number
  /** Years this role adds to the estimate after overlap (overlapping months go to the highest share). */
  years: number
}

/** Years estimate for one years requirement, for display. */
export interface YearsRequirementResult {
  /** Index into `facts.requirements`. */
  requirementIndex: number
  text: string
  area: string
  importance: 'must' | 'nice'
  required: number
  /** Estimated years in the area. */
  estimate: number
  /** Capability noul (0–1), or null when not answered. */
  capability: number | null
  status: YearsStatus
  /** e.g. "~3.7 yrs: Senior Program Manager 2.3 + Communications Lead 0.7 + PR Manager 50% × 1.4" */
  summary: string
  roles: YearsRoleBreakdown[]
}

/** The normalised 0–1 signals and arithmetic behind the score, for debugging and tuning. */
export interface ScoreBreakdown {
  /** null when there were no scorable requirements (its weight is then spread over the rest). */
  coverage: number | null
  skills: number
  seniority: number
  domain: number
  /** null when direction_fit wasn't asked. */
  direction: number | null
  belowTargetPay: boolean
  composite: number
  /** 1 + 9 · composite, before the penalty. */
  raw: number
  /** Number of major gaps + years warnings + years stretches + missing education must-haves. */
  penaltyItems: number
  penalty: number
}

export interface AssessmentResult {
  pipelineVersion: string
  /** 1–10. */
  score: number
  level: AssessmentLevel
  /** Any hard blocker. Display as "Blocked · {score}/10"; `level` is still stored for tuning. */
  blocked: boolean
  /** Ordered hard → unconfirmed → stretch → warn. */
  blockers: Blocker[]
  /** Up to 3 must-haves with p ≥ 0.7, then met years must-haves with their estimate. */
  strengths: string[]
  /** Major gaps (red): experience/skill must-haves with p < 0.3. Years warn/stretch are in `blockers`. */
  gaps: string[]
  /** "Check these": must-haves with 0.3 ≤ p < 0.7 (years requirements excluded; they have their own rule). */
  unsettled: string[]
  /** Informational lines that are neither blockers nor gaps, e.g. "Location unknown". */
  notes: string[]
  /** One entry per years requirement, in requirement order. */
  years: YearsRequirementResult[]
  breakdown: ScoreBreakdown
}
