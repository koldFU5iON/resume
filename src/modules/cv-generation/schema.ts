/**
 * Shared types, Zod schemas and constants for CV generation (writing desk).
 *
 * Plan and implementation record: docs/cv-generation.md. The run row is
 * modelled on JobDeepDive (src/modules/deep-dive/schema.ts): a string status,
 * a `failureKind`, and native Json columns that are validated with Zod on read.
 *
 * Pure module: no DB, no network. No model ids (roles choose models).
 */

import * as z from 'zod'

// ── Run lifecycle ───────────────────────────────────────────────────────────

/**
 * One status per pipeline stage (docs/cv-generation.md, stages 0-6), in
 * pipeline order, between `queued` and the two terminal statuses. Assemble
 * runs before Review, as in the plan's table.
 */
export const CV_GENERATION_STATUSES = [
  'queued',
  'gathering',
  'briefing',
  'selecting',
  'writing',
  'assembling',
  'reviewing',
  'landing',
  'complete',
  'failed',
] as const
export type CvGenerationStatus = typeof CV_GENERATION_STATUSES[number]

export const ACTIVE_STATUSES = [
  'queued', 'gathering', 'briefing', 'selecting', 'writing', 'assembling', 'reviewing', 'landing',
] as const satisfies readonly CvGenerationStatus[]
export type ActiveCvGenerationStatus = typeof ACTIVE_STATUSES[number]

export function isActiveStatus(status: string): status is ActiveCvGenerationStatus {
  return (ACTIVE_STATUSES as readonly string[]).includes(status)
}

/** The stages of a run, in order (plan stages 0-6). */
export const CV_GENERATION_STAGES = ['gather', 'brief', 'select', 'write', 'assemble', 'review', 'land'] as const
export type CvGenerationStage = typeof CV_GENERATION_STAGES[number]

/** The run status while each stage executes. */
export const STAGE_STATUS = {
  gather: 'gathering',
  brief: 'briefing',
  select: 'selecting',
  write: 'writing',
  assemble: 'assembling',
  review: 'reviewing',
  land: 'landing',
} as const satisfies Record<CvGenerationStage, ActiveCvGenerationStatus>

export function stageForStatus(status: string): CvGenerationStage | null {
  return CV_GENERATION_STAGES.find((s) => STAGE_STATUS[s] === status) ?? null
}

export const FAILURE_KINDS = [
  'no_llm_key',
  'no_description',
  'timeout',
  'rate_limited',
  'overloaded',
  'refusal',
  'invalid_output',
  'draft_exists',
  'error',
] as const
export type CvGenerationFailureKind = typeof FAILURE_KINDS[number]

/** A run still active after this long is treated as failed (`timeout`): its after() callback died. */
export const CV_GENERATION_STALE_MS = 15 * 60_000

/** Hard limit on concurrent runs per profile (admitted under an advisory lock, run.ts). */
export const CV_GENERATION_CONCURRENCY_PER_PROFILE = 2

// ── Run log ─────────────────────────────────────────────────────────────────

export const FLAGGED_CLAIM_VERDICTS = ['uncertain', 'unsupported'] as const

/** A factual claim the Review stage could not fully support against the profile. */
export const FlaggedClaimSchema = z.object({
  claim: z.string(),
  /** uncertain: listed for the owner to verify; unsupported: removed from the draft. */
  verdict: z.enum(FLAGGED_CLAIM_VERDICTS),
  section: z.string().nullable().default(null),
  reason: z.string().nullable().default(null),
})
export type FlaggedClaim = z.infer<typeof FlaggedClaimSchema>

export const LOG_ENTRY_STATUSES = ['ok', 'skipped', 'failed'] as const

/** What one stage did. Code-only stages (gather, assemble, land) have a null model and zero tokens. */
export const StageLogEntrySchema = z.object({
  stage: z.enum(CV_GENERATION_STAGES),
  status: z.enum(LOG_ENTRY_STATUSES).default('ok'),
  /** The model the stage's calls ran on; null for code stages. */
  model: z.string().nullable().default(null),
  /** ISO timestamp. */
  startedAt: z.string().nullable().default(null),
  durationMs: z.number().nonnegative().nullable().default(null),
  tokens: z.object({
    input: z.number().nonnegative().default(0),
    output: z.number().nonnegative().default(0),
  }).default({ input: 0, output: 0 }),
  /** Estimated from list prices; absent when the model has no known price. */
  costUsd: z.number().nonnegative().nullable().default(null),
  /** Free-text observations ("used jobAnalysis: no complete deep dive"). */
  notes: z.array(z.string()).default([]),
  /** Select: evidence kept per section, by label. */
  kept: z.array(z.string()).default([]),
  /** Select: evidence dropped, by label. */
  dropped: z.array(z.string()).default([]),
  /** Validation retries the stage needed. */
  retries: z.number().int().nonnegative().default(0),
  /** Review: claims that were not plainly supported. */
  flaggedClaims: z.array(FlaggedClaimSchema).default([]),
})
export type StageLogEntry = z.infer<typeof StageLogEntrySchema>

/** What is stored in `CvGeneration.log`. */
export const CvGenerationLogSchema = z.object({
  entries: z.array(StageLogEntrySchema),
})
export type CvGenerationLog = z.infer<typeof CvGenerationLogSchema>

/**
 * The entries of a stored log, tolerating null, a non-object, a missing list
 * and individually bad entries (dropped): a malformed row must show a
 * shorter log, never crash the page. Later entries for the same stage
 * replace earlier ones; the result is in pipeline order.
 */
export function parseCvGenerationLog(value: unknown): StageLogEntry[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { entries?: unknown }).entries)
      ? (value as { entries: unknown[] }).entries
      : []
  const byStage = new Map<CvGenerationStage, StageLogEntry>()
  for (const item of raw) {
    const parsed = StageLogEntrySchema.safeParse(item)
    if (parsed.success) byStage.set(parsed.data.stage, parsed.data)
  }
  return CV_GENERATION_STAGES.flatMap((s) => byStage.get(s) ?? [])
}

/** Stage timings in ms, keyed by stage. Unknown keys and non-numbers are dropped. */
export function parseStageTimings(value: unknown): Partial<Record<CvGenerationStage, number>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Partial<Record<CvGenerationStage, number>> = {}
  for (const s of CV_GENERATION_STAGES) {
    const v = (value as Record<string, unknown>)[s]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[s] = v
  }
  return out
}

/** A stored status, or 'failed' for anything unrecognised so a bad row never reads as running. */
export function asStatus(value: unknown): CvGenerationStatus {
  return (CV_GENERATION_STATUSES as readonly unknown[]).includes(value) ? (value as CvGenerationStatus) : 'failed'
}

/** A stored failure kind, or null when absent or unknown. */
export function asFailureKind(value: unknown): CvGenerationFailureKind | null {
  return (FAILURE_KINDS as readonly unknown[]).includes(value) ? (value as CvGenerationFailureKind) : null
}
