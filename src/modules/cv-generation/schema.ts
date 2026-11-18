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
import { BUDGET_CAPS, FLAT_SECTIONS, type BudgetSection } from './caps'

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

/** maxDuration (s) of every route segment that starts a run: the pipeline executes in after(). */
export const CV_GENERATION_ROUTE_MAX_DURATION_S = 300

/** Time budgets. `run` ends a run on its row (failed / timeout) before the platform kills it. */
export const TIME_BUDGET_MS = {
  brief: 90_000,
  select: 60_000,
  run: (CV_GENERATION_ROUTE_MAX_DURATION_S - 20) * 1_000,
} as const

/** Usage tags (also labelled in src/app/dashboard/settings/usage/_components/feature-labels.ts). */
export const CV_GENERATION_FEATURES = {
  brief: 'cv-gen-brief',
  select: 'cv-gen-select',
  /** analyseJob, when neither a deep dive nor jobAnalysis exists; keeps its own tag. */
  analyse: 'cv-job-analysis',
} as const

/** Output caps (tokens): small JSON, but generous enough that a cut-off is not the usual failure. */
export const MAX_OUTPUT_TOKENS = {
  brief: 2_000,
  briefRetry: 4_000,
  select: 4_000,
  selectRetry: 8_000,
} as const

/** Where the Brief's strategy input came from (gather stage). `none`: analyseJob also failed, so the Brief reads the job description alone. */
export const STRATEGY_SOURCES = ['deep-dive', 'job-analysis', 'analysed', 'none'] as const
export type StrategySource = typeof STRATEGY_SOURCES[number]

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
  /**
   * True when the run stopped after Select because the later stages are not
   * built yet (a preview run); the page labels it so it never reads as a
   * finished CV.
   */
  partial: z.boolean().default(false),
})
export type CvGenerationLog = z.infer<typeof CvGenerationLogSchema>

/** Whether a stored log says its run was a preview that stopped early. Tolerates any value. */
export function isPartialLog(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && (value as { partial?: unknown }).partial === true
}

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

// ── Brief and Selection (stages 1 and 2) ────────────────────────────────────

/** Trimmed string cut to `max` chars instead of failing. */
function cutText(max: number, description: string) {
  return z.string().describe(`${description} (at most ${max} characters)`).transform((v) => v.trim().slice(0, max).trim())
}

/** Array cut to `max` items instead of failing. */
function capped<T extends z.ZodType>(item: T, max: number, description: string) {
  return z.array(item).describe(`${description} (at most ${max})`).transform((a) => a.slice(0, max))
}

/** A count clamped into 0..cap (1..cap for roles: the CV always has one) instead of failing. */
function budget(section: BudgetSection, description: string) {
  const cap = BUDGET_CAPS[section]
  const min = section === 'experiences' ? 1 : 0
  return z.number().describe(`${description} (an integer from ${min} to ${cap})`)
    .transform((v) => Math.min(cap, Math.max(min, Math.round(v))))
}

/**
 * Stage 1 output. Strategy fields mirror the deep dive's `cvStrategy`
 * (`leadWith`, `emphasise`, `playDown`, `positioning`) so either source feeds
 * the same shape. The budgets are the model's request; select.ts clamps them
 * again against caps.ts, so a stored brief can never ask for more than a cap.
 */
export const CvBriefSchema = z.object({
  hiddenQuestion: cutText(400, 'The problem this role is hired to solve, in 1–2 sentences'),
  leadWith: capped(cutText(160, 'Item'), 4, 'What the CV should open with'),
  emphasise: capped(z.object({ item: cutText(160, 'Item'), why: cutText(200, 'Why it matters for this role') }), 6, 'What to emphasise'),
  playDown: capped(cutText(160, 'Item'), 4, 'What to play down or leave out'),
  positioning: cutText(400, '1–2 sentences on the story the CV tells'),
  tone: cutText(160, 'Voice for the writing, e.g. "plain and specific, senior but not grand"'),
  budgets: z.object({
    experiences: budget('experiences', 'Roles to show'),
    skills: budget('skills', 'Skills to show'),
    tools: budget('tools', 'Tools to show'),
    competencies: budget('competencies', 'Competencies to show'),
    certifications: budget('certifications', 'Certifications to show'),
    education: budget('education', 'Education entries to show'),
    projects: budget('projects', 'Projects to show'),
  }),
})
export type CvBrief = z.infer<typeof CvBriefSchema>

/** A stored brief, or null when absent or unreadable (never throws). */
export function parseBrief(value: unknown): CvBrief | null {
  const parsed = CvBriefSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export const SelectedItemSchema = z.object({
  id: z.string(),
  /** What the item is, for display (the profile may change after the run). */
  label: z.string(),
  /** Why the model kept it; empty for fallback picks that carry none. */
  reason: z.string().default(''),
})
export type SelectedItem = z.infer<typeof SelectedItemSchema>

export const DROP_REASONS = ['not_selected', 'over_cap', 'unknown_id', 'duplicate', 'role_not_kept'] as const
export type DropReason = typeof DROP_REASONS[number]

export const DROP_REASON_LABEL: Record<DropReason, string> = {
  not_selected: 'not selected',
  over_cap: 'over the limit',
  unknown_id: 'not in the profile',
  duplicate: 'picked twice',
  role_not_kept: 'its role was not kept',
}

export const DroppedItemSchema = z.object({
  section: z.string(),
  id: z.string(),
  label: z.string().default(''),
  /** Activities: the role (experience id) they belong to. */
  parentId: z.string().optional(),
  why: z.enum(DROP_REASONS),
})
export type DroppedItem = z.infer<typeof DroppedItemSchema>

const SelectedList = z.array(SelectedItemSchema).default([])

/**
 * Stage 2 output as stored: ids that exist in the profile, each with a
 * display label and the model's reason, and what code dropped and why.
 * `activities` is keyed by experience id and only has kept roles.
 */
export const CvSelectionSchema = z.object({
  /** model: the fast model's picks, capped by code; fallback: chosen by rules after the call failed or returned junk. */
  mode: z.enum(['model', 'fallback']),
  experiences: SelectedList,
  activities: z.record(z.string(), SelectedList).default({}),
  skills: SelectedList,
  tools: SelectedList,
  competencies: SelectedList,
  certifications: SelectedList,
  education: SelectedList,
  projects: SelectedList,
  dropped: z.array(DroppedItemSchema).default([]),
  /** Candidates dropped in all; `dropped` lists at most MAX_RECORDED_DROPPED of them. */
  droppedTotal: z.number().int().nonnegative().default(0),
})
export type CvSelection = z.infer<typeof CvSelectionSchema>
export type FlatSelectionKey = typeof FLAT_SECTIONS[number]

/** A stored selection, or null when absent or unreadable (never throws). */
export function parseSelection(value: unknown): CvSelection | null {
  const parsed = CvSelectionSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
