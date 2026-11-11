/**
 * Shared types, Zod schemas and tuning constants for the job deep dive.
 *
 * Source of truth: docs/superpowers/specs/2026-11-11-job-deep-dive-design.md
 * (§3.2 Finding, §4.1 statuses, §6 report).
 *
 * Model output is tolerated rather than rejected, the same way as the early
 * assessment's facts schema: over-long strings and lists are cut, and bad
 * entries are dropped in transforms. `.transform` (not `.preprocess`) keeps
 * each field's JSON Schema for the model, and limits are in `.describe` so the
 * model still sees them. Schemas sent to a provider avoid optional fields and
 * unions (nullable fields and flat objects instead), so they work on
 * Anthropic, OpenAI strict mode and Gemini alike.
 *
 * Pure module: no DB, no network. No model ids (roles choose models).
 */

import * as z from 'zod'

// ── Run lifecycle ───────────────────────────────────────────────────────────

export const DEEP_DIVE_STATUSES = ['queued', 'gathering', 'researching', 'synthesising', 'complete', 'failed'] as const
export type DeepDiveStatus = typeof DEEP_DIVE_STATUSES[number]

export const ACTIVE_STATUSES = ['queued', 'gathering', 'researching', 'synthesising'] as const satisfies readonly DeepDiveStatus[]

export const FAILURE_KINDS = ['no_llm_key', 'no_description', 'timeout', 'rate_limited', 'overloaded', 'refusal', 'error'] as const
export type DeepDiveFailureKind = typeof FAILURE_KINDS[number]

/** A run still active after this long is treated as failed (`timeout`): its after() callback died. */
export const DEEP_DIVE_STALE_MS = 10 * 60_000

/** Hard limit on concurrent runs per profile (admitted under an advisory lock, queries.ts). */
export const DEEP_DIVE_CONCURRENCY_PER_PROFILE = 2

/** maxDuration (s) of every route segment that starts a deep dive: the run executes in after(). */
export const DEEP_DIVE_ROUTE_MAX_DURATION_S = 300

/** Time budgets (spec §8). Research runs in parallel, so its budget is per stage, not per researcher. */
export const TIME_BUDGET_MS = {
  research: 120_000,
  /** The search call's share of the research budget; the rest is left for structuring. */
  researchSearch: 90_000,
  synthesis: 120_000,
} as const

/**
 * Output caps. Generous on purpose (#359: an 800-token cap truncated JSON).
 * 16k stays within every current model's output limit, including older
 * OpenAI models with a 16,384 cap; reasoning models count thinking against it.
 */
export const MAX_OUTPUT_TOKENS = {
  researchNotes: 4_000,
  structure: 8_000,
  synthesis: 16_000,
} as const

/** Company research is shared across users and reused for this long. */
export const COMPANY_RESEARCH_TTL_MS = 30 * 24 * 60 * 60_000

/** Feature tags (spec §7). Every LLM call of a run carries one, plus attribution { jobApplicationId, runId }. */
export const DEEP_DIVE_FEATURES = {
  research: {
    company: 'deep-dive:research:company',
    pay: 'deep-dive:research:pay',
    practicalities: 'deep-dive:research:practicalities',
  },
  structure: 'deep-dive:structure',
  synthesis: 'deep-dive:synthesis',
} as const

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Trimmed string cut to `max` chars instead of failing. */
function cutText(max: number, description: string) {
  return z.string().describe(`${description} (at most ${max} characters)`).transform((v) => v.trim().slice(0, max).trim())
}

/** Nullable string cut to `max`; blank reads as null. */
function cutTextOrNull(max: number, description: string) {
  return z.string().nullable().describe(`${description} (at most ${max} characters)`)
    .transform((v) => {
      const t = v?.trim().slice(0, max).trim()
      return t ? t : null
    })
}

/** Array cut to `max` items instead of failing. */
function capped<T extends z.ZodType>(item: T, max: number, description: string) {
  return z.array(item).describe(`${description} (at most ${max})`).transform((a) => a.slice(0, max))
}

// ── Findings (spec §3.2) ────────────────────────────────────────────────────

export const RESEARCHERS = ['company', 'pay', 'practicalities'] as const
export type Researcher = typeof RESEARCHERS[number]

export const CONFIDENCES = ['low', 'medium', 'high'] as const

export const FindingSchema = z.object({
  topic: cutText(60, "Short snake_case topic, e.g. 'office_locations', 'pay_band', 'sponsorship_wording'"),
  claim: cutText(400, 'One factual statement, no judgement or advice'),
  sourceUrl: cutTextOrNull(500, 'URL of the page that supports the claim; null only for claims read from the job description'),
  quote: cutTextOrNull(300, 'The supporting text, copied from the source'),
  publishedAt: cutTextOrNull(40, 'Date of the source if known, e.g. 2026-09 or 2026-09-14'),
  confidence: z.enum(CONFIDENCES),
})

export type Finding = z.infer<typeof FindingSchema>

/** Output of the structuring call (role: fast). */
export const StructuredFindingsSchema = z.object({
  findings: capped(FindingSchema, 15, 'Findings'),
})

/** One researcher's result as stored on the run. */
export type ResearcherOutcome = {
  status: 'ok' | 'cached' | 'skipped' | 'failed' | 'timeout'
  /** Why it was skipped or failed (no web search, an LLMError kind, …). */
  reason: string | null
  findings: Finding[]
  /** Model that searched; null when nothing ran. */
  model: string | null
  /** Pages the provider reported for the search. */
  sourceCount: number
  /** Cached CompanyResearch row the findings came from. */
  cachedResearchId?: string | null
}

/** JobDeepDive.research. */
export type DeepDiveResearch = {
  researchers: Record<Researcher, ResearcherOutcome>
  /** Every finding in synthesis order: the index synthesis evidence cites. */
  findings: (Finding & { researcher: Researcher })[]
}

/** All findings in a fixed order (company, pay, practicalities): the indexes the report cites. */
export function flattenFindings(researchers: Record<Researcher, ResearcherOutcome>): DeepDiveResearch['findings'] {
  return RESEARCHERS.flatMap((r) => researchers[r].findings.map((f) => ({ ...f, researcher: r })))
}

// ── Report (spec §6) ────────────────────────────────────────────────────────

export type Evidence =
  | { kind: 'jd'; quote: string }
  | { kind: 'profile'; ref: string; text: string }
  | { kind: 'finding'; index: number }
  | { kind: 'register' }

/**
 * Evidence as the model writes it: one flat object (no union, which some
 * providers' structured output handles poorly), turned into `Evidence` or
 * dropped when the fields for its kind are missing.
 */
const EvidenceInputSchema = z.object({
  kind: z.enum(['jd', 'profile', 'finding', 'register']),
  quote: z.string().nullable().describe("kind 'jd': the job description's exact words (at most 300 characters); else null"),
  ref: z.string().nullable().describe("kind 'profile': which profile item, e.g. 'Senior PM — Acme' or a skill name; else null"),
  text: z.string().nullable().describe("kind 'profile': what the item says that matters here; else null"),
  index: z.number().nullable().describe("kind 'finding': the finding's index from the Findings list; else null"),
})

function toEvidence(e: z.infer<typeof EvidenceInputSchema>): Evidence | null {
  switch (e.kind) {
    case 'jd': {
      const quote = e.quote?.trim().slice(0, 300)
      return quote ? { kind: 'jd', quote } : null
    }
    case 'profile': {
      const ref = e.ref?.trim().slice(0, 120)
      const text = e.text?.trim().slice(0, 300) ?? ''
      return ref ? { kind: 'profile', ref, text } : null
    }
    case 'finding':
      return e.index !== null && Number.isInteger(e.index) && e.index >= 0 ? { kind: 'finding', index: e.index } : null
    case 'register':
      return { kind: 'register' }
  }
}

const EvidenceListSchema = z.array(EvidenceInputSchema)
  .describe('Evidence for this item (at most 4)')
  .transform((list) => list.map(toEvidence).filter((e): e is Evidence => e !== null).slice(0, 4))

export const VERDICTS = ['apply', 'apply_with_caveats', 'long_shot', 'dont_apply'] as const
export type Verdict = typeof VERDICTS[number]

export const REGISTER_RESULTS = ['licensed', 'licensed_other_route', 'not_listed', 'unknown', 'not_applicable'] as const
export type ReportRegisterResult = typeof REGISTER_RESULTS[number]

const MoneySchema = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
  currency: cutText(3, 'ISO 4217 code'),
})

export const DeepDiveReportSchema = z.object({
  verdict: z.enum(VERDICTS),
  verdictSummary: cutText(600, '2–3 sentences'),
  worthTailoredCv: z.object({ answer: z.boolean(), reason: cutText(300, 'Why') }),
  likelihood: z.object({
    band: z.enum(['low', 'medium', 'high']).describe('Chance of getting to interview; no percentages'),
    reason: cutText(300, 'Why'),
  }),

  blockers: capped(z.object({
    label: cutText(120, 'The blocker'),
    status: z.enum(['hard', 'confirm_with_recruiter', 'cleared']),
    fromEarlyAssessment: z.boolean().describe('True when it was one of the early assessment blockers'),
    reason: cutText(400, 'Why it has this status'),
    evidence: EvidenceListSchema,
  }), 8, 'Blockers'),

  gaps: capped(z.object({
    requirement: cutText(200, 'The requirement'),
    closability: z.enum(['closable_now', 'closable_later', 'not_closable'])
      .describe('closable_now = evidence exists but is not on the profile or CV yet; closable_later = needs real work'),
    action: cutText(300, 'What to add (closable_now) or do (closable_later)'),
    weeksToClose: z.number().nullable().describe('Rough weeks for closable_later; else null'),
    evidence: EvidenceListSchema,
  }), 10, 'Gaps'),

  strengths: capped(z.object({ point: cutText(200, 'The strength'), evidence: EvidenceListSchema }), 6, 'Strengths'),

  practicalities: z.object({
    location: z.object({
      summary: cutText(300, 'Where the work is and what that means for the candidate'),
      workMode: z.enum(['remote', 'hybrid', 'onsite', 'unknown']),
      relocationNeeded: z.boolean().nullable(),
    }),
    sponsorship: z.object({
      needed: z.boolean().describe('Copy the value given under Sponsorship facts when it is known'),
      register: z.enum(REGISTER_RESULTS).describe('Copy the register result given under Sponsorship facts'),
      adWording: z.enum(['offers', 'not_offered', 'right_to_work_required', 'silent']),
      meetsSalaryThreshold: z.boolean().nullable(),
      summary: cutText(400, 'What this means, citing the register and the ad separately'),
    }),
    employmentType: cutTextOrNull(60, 'Permanent, fixed term, contract, …'),
    other: capped(z.object({ label: cutText(60, 'Label'), detail: cutText(240, 'Detail') }), 6, 'Other practicalities, e.g. start date, travel, on-call'),
  }),

  pay: z.object({
    stated: MoneySchema.nullable().describe('Pay stated in the job ad (annual); null when none'),
    market: z.object({
      min: z.number(),
      max: z.number(),
      currency: cutText(3, 'ISO 4217 code'),
      evidence: EvidenceListSchema,
    }).nullable().describe('Market range from sourced findings only; null when no finding gives figures'),
    ask: z.object({
      floor: z.number(),
      target: z.number(),
      stretch: z.number(),
      currency: cutText(3, 'ISO 4217 code'),
      reasoning: cutText(400, 'How the numbers were reached, naming their sources'),
    }).nullable(),
    vsSearchProfile: cutText(300, "How the pay compares with the candidate's floors and targets"),
  }),

  company: z.object({
    summary: cutText(500, 'What the company does, its size and stage'),
    signals: capped(z.object({
      label: cutText(160, 'The signal'),
      tone: z.enum(['positive', 'neutral', 'negative']),
      evidence: EvidenceListSchema,
    }), 6, 'Signals'),
  }),

  cvStrategy: z.object({
    leadWith: capped(cutText(160, 'Item'), 4, 'What the CV should open with'),
    emphasise: capped(z.object({ item: cutText(160, 'Item'), why: cutText(200, 'Why') }), 6, 'What to emphasise'),
    playDown: capped(cutText(160, 'Item'), 4, 'What to play down'),
    positioning: cutText(400, '1–2 sentences'),
  }),

  questionsToAsk: capped(cutText(240, 'Question'), 6, 'Questions for the recruiter or hiring manager'),
  unknowns: capped(cutText(240, 'Unknown'), 8, "What research couldn't settle"),
})

export type DeepDiveReport = z.infer<typeof DeepDiveReportSchema>
