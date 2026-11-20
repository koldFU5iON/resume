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
import { BUDGET_CAPS, BUDGET_FLOORS, clampBudgetValue, FLAT_SECTIONS, MAX_RELEVANCE, MIN_RELEVANCE, NEUTRAL_RELEVANCE, type BudgetSection } from './caps'

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
  /** The job already holds the most writing desk documents (and none of them is a previous generated CV to reuse). */
  'document_limit',
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
  /** One writer call (a retry is a second call, both inside the run deadline). A timeout fails the run (kind timeout). */
  write: 70_000,
  /** The last-resort analyseJob call in Gather. A timeout is treated as strategy source 'none'. */
  analyse: 60_000,
  /** The one Review call (a retry is a second call, both inside the run deadline). A timeout skips the review, never the run. */
  review: 60_000,
  run: (CV_GENERATION_ROUTE_MAX_DURATION_S - 20) * 1_000,
} as const

/**
 * Sampling temperature per call, named in one place (no magic numbers at the
 * call sites). Select is 0 and Brief low so two runs of the same job pick alike.
 * CAVEAT: the llm layer (`samplingOptions`, src/modules/llm/client.ts) sends a
 * temperature to every provider EXCEPT Anthropic's Claude 5 family (Sonnet,
 * Opus, Haiku 5.x reject non-default sampling with a 400), where it is dropped.
 * On those models these values change nothing, so run-to-run stability there
 * cannot rest on temperature: the selection rules in cv-gen-select.md and the
 * deterministic code caps carry it (docs/cv-generation.md, Phase 3b).
 */
export const TEMPERATURE = {
  brief: 0.2,
  select: 0,
  review: 0.1,
  writeExperience: 0.4,
  writeProfile: 0.4,
  writeSkills: 0.2,
} as const

/** Usage tags (also labelled in src/app/dashboard/settings/usage/_components/feature-labels.ts). */
export const CV_GENERATION_FEATURES = {
  brief: 'cv-gen-brief',
  select: 'cv-gen-select',
  /** One experience writer call per employer that shows bullets (wave 1). */
  writeExperience: 'cv-gen-write-experience',
  /** The skills and tools grouping call (wave 1). */
  writeSkills: 'cv-gen-write-skills',
  /** Professional profile, headline and competencies (wave 2). */
  writeProfile: 'cv-gen-write-profile',
  /** The one Review call after Assemble (role 'analysis'). */
  review: 'cv-gen-review',
  /** analyseJob, when neither a deep dive nor jobAnalysis exists; keeps its own tag. */
  analyse: 'cv-job-analysis',
} as const

/** Most writer calls in flight at once in wave 1 (kind to the provider's rate limits, and to the run's time budget). */
export const WRITE_CONCURRENCY = 3

/**
 * Output caps (tokens): small JSON, but generous enough that a cut-off is not
 * the usual failure. The retry (after a cut-off or a bad answer) always runs
 * at the larger cap, never the first-try one (call.ts).
 */
export const MAX_OUTPUT_TOKENS = {
  brief: 4_000,
  briefRetry: 8_000,
  select: 8_000,
  selectRetry: 16_000,
  // The experience writer's cap is scaled to its bullet allocation: experienceTokenCaps (write/limits.ts).
  /** Skills grouping: names only. */
  writeSkills: 1_500,
  writeSkillsRetry: 3_000,
  /**
   * Profile, headline and competencies. The answer itself is about 300 tokens
   * (110 words, a headline, 8 labels), but the default role may be a model that
   * thinks first and thinking counts against the cap: 1,500 was cut off in a
   * real run (2.5k out, retried).
   */
  writeProfile: 4_000,
  writeProfileRetry: 8_000,
  /** Review: at most 8 edits and 5 concerns, each short. */
  review: 3_000,
  reviewRetry: 6_000,
} as const

/**
 * A new run reuses the Brief and Select of the newest COMPLETE run of the same
 * job (same profile) when its inputsHash is unchanged and it is no older than
 * this (run/reuse.ts). `fresh: true` forces new calls.
 */
export const SELECTION_REUSE_WINDOW_DAYS = 30
export const SELECTION_REUSE_WINDOW_MS = SELECTION_REUSE_WINDOW_DAYS * 24 * 60 * 60_000

/**
 * Part of the reuse key (reuse.ts). BUMP IT whenever the meaning of the Brief or
 * Select stage changes in code (what they read, how Select's caps and fallbacks
 * choose, how the stored brief or selection is shaped or interpreted by the
 * writers): a stored selection from before the change must not be reused. A prompt
 * edit by the user needs no bump: the effective prompt texts are hashed too.
 */
export const SELECTION_PIPELINE_VERSION = 8

/** A failed run whose Brief and Select were paid for may still donate them: only these failures happened AFTER Select (at Land), so the stored pair is whole. */
export const REUSABLE_FAILURE_KINDS = ['draft_exists', 'document_limit'] as const

/** Time kept back at the end of the run for Land (ms): Review never starts without it. */
export const LAND_RESERVE_MS = 12_000
/** Review is skipped (logged, never a failure) with less than this left before the Land reserve (ms). */
export const REVIEW_MIN_START_MS = 20_000

/** Hard limits on the Review stage, enforced in code (the prompt states them too). */
export const REVIEW_LIMITS = {
  maxEdits: 8,
  maxConcerns: 5,
  titleChars: 80,
  whyChars: 200,
  questionChars: 200,
  reasonChars: 200,
  /** Replacement text longer than this is cut before the checks (the checks then enforce the word limits). */
  newTextChars: 800,
  /** Claimed names listed in the prompt. */
  maxClaimedNames: 40,
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

/** One section's own row under the Write stage: what writing that section cost and noted. */
export const SectionLogEntrySchema = z.object({
  /** Stable id, e.g. "experience:acme-cloud", "skills", "profile". */
  id: z.string(),
  /** What the page shows, e.g. "Experience: Snr. Program Manager — Acme Cloud". */
  label: z.string(),
  /** ok: written; skipped: nothing to write; failed: the run failed here. */
  status: z.enum(LOG_ENTRY_STATUSES).default('ok'),
  /** The model of the section's calls; null when code rendered it (no model call). */
  model: z.string().nullable().default(null),
  durationMs: z.number().nonnegative().nullable().default(null),
  tokens: z.object({
    input: z.number().nonnegative().default(0),
    output: z.number().nonnegative().default(0),
  }).default({ input: 0, output: 0 }),
  costUsd: z.number().nonnegative().nullable().default(null),
  /** Model calls beyond the first (a retry after a bad answer or a failed check). */
  retries: z.number().int().nonnegative().default(0),
  /** Why the retry happened, as short phrases ("figure 14k not in evidence", "first person"). Empty when there was none and on rows stored before it existed. */
  retryReasons: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
})
export type SectionLogEntry = z.infer<typeof SectionLogEntrySchema>

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
  /** Why the stage retried (short phrases); empty when it did not and on rows stored before it existed. */
  retryReasons: z.array(z.string()).default([]),
  /** Review: claims that were not plainly supported. */
  flaggedClaims: z.array(FlaggedClaimSchema).default([]),
  /** Write: one row per section (employer, skills, profile...). Empty for every other stage and for rows stored before Phase 3. */
  sections: z.array(SectionLogEntrySchema).default([]),
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
  /** sha256 of what a stored brief and selection depend on (reuse.ts reuseKeyOf); set once Gather has ended. Absent on older runs, which are therefore never reused. */
  reuseKey: z.string().optional(),
  /** The run whose Brief and Select this run holds (itself when it made them): the window of reuse is measured from here, so reuse cannot chain forever. */
  reuseOrigin: z.object({ runId: z.string(), at: z.string() }).optional(),
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

/**
 * A count clamped into [floor, ceiling] (caps.ts): the Brief may raise a
 * budget up to its ceiling but never go below the floor, so a stored Brief's
 * out-of-range number reads as the floor instead of failing.
 */
function budget(section: BudgetSection, description: string) {
  return z.number().describe(`${description} (an integer from ${BUDGET_FLOORS[section]} to ${BUDGET_CAPS[section]})`)
    .transform((v) => clampBudgetValue(section, v))
}

/** A lead-with or emphasise item: a short proper `name` or topic to match evidence by, and the `framing` sentence that tells the writers how to use it. */
export type BriefItem = { name: string; framing: string }

const NAME_MAX = 80
const FRAMING_MAX = 200

/**
 * The short name of an old-shape item (a plain sentence): the text before the
 * first ':' when there is one, else the first quoted phrase, else the first
 * run of capitalised words (not just a sentence's first word), else the first
 * few words. Pure.
 */
export function deriveItemName(text: string): string {
  const t = text.trim()
  const colon = t.indexOf(':')
  if (colon > 0 && colon <= NAME_MAX) return t.slice(0, colon).trim()
  const quoted = t.match(/(?:^|\s)["“‘']([^"”’']{2,80})["”’']/)
  if (quoted) return quoted[1].trim()
  const run = [...t.matchAll(/[A-Z0-9][\w&.+#'-]*(?:\s+(?:(?:of|&)\s+)?[A-Z0-9][\w&.+#'-]*)*/g)]
    .find((m) => m[0].includes(' ') || (m.index ?? 0) > 0)
  if (run) return run[0].trim().slice(0, NAME_MAX)
  return t.split(/\s+/).slice(0, 6).join(' ').slice(0, NAME_MAX)
}

/** Reads the new `{ name, framing }` shape, or an old plain string (the framing; the name is derived). */
function briefItemShape(v: unknown): unknown {
  if (typeof v === 'string') return { name: deriveItemName(v), framing: v }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    // Old emphasise shape: { item, why }.
    const framing = typeof o.framing === 'string' ? o.framing : typeof o.item === 'string' ? o.item : undefined
    const name = typeof o.name === 'string' && o.name.trim() ? o.name : framing !== undefined ? deriveItemName(framing) : undefined
    if (framing !== undefined) return { ...o, name, framing }
    // A name with no framing: the name stands as its own framing (never fail the whole Brief).
    if (typeof o.name === 'string' && o.name.trim()) return { ...o, framing: o.name }
  }
  return v
}

const itemFields = {
  name: cutText(NAME_MAX, 'The short proper name or topic evidence is matched by, e.g. "Acme Cloud" or "Customer Portal Redesign"'),
  framing: cutText(FRAMING_MAX, 'The sentence that frames it for the writers'),
}
const leadWithObject = z.object(itemFields)
const emphasiseObject = z.object({ ...itemFields, why: cutText(200, 'Why it matters for this role') })

/**
 * The brief object for one item flavour: `tolerant` reads the old shapes too
 * (what the stored-Brief reader and the model-answer parser use); the strict
 * one has only the new shape, because a preprocess step cannot be written as
 * the JSON Schema the model is shown.
 */
function briefSchema(tolerant: boolean) {
  const read = <T extends z.ZodType>(item: T) => (tolerant ? z.preprocess(briefItemShape, item) : item)
  return z.object({
    hiddenQuestion: cutText(400, 'The problem this role is hired to solve, in 1–2 sentences'),
    leadWith: capped(read(leadWithObject), 4, 'What the CV should open with'),
    emphasise: capped(read(emphasiseObject), 6, 'What to emphasise'),
    playDown: capped(cutText(160, 'Item'), 4, 'What to play down or leave out'),
    positioning: cutText(400, '1–2 sentences on the story the CV tells'),
    tone: cutText(160, 'Voice for the writing, e.g. "plain and specific, senior but not grand"'),
    budgets: z.object({
      experiences: budget('experiences', 'Employers to show with bullets'),
      skills: budget('skills', 'Skills to show'),
      tools: budget('tools', 'Tools to show'),
      competencies: budget('competencies', 'Competencies to show'),
      certifications: budget('certifications', 'Certifications to show'),
      education: budget('education', 'Education entries to show'),
      projects: budget('projects', 'Projects to show'),
    }),
  })
}

/**
 * Stage 1 output. Strategy fields mirror the deep dive's `cvStrategy`
 * (`leadWith`, `emphasise`, `playDown`, `positioning`) so either source feeds
 * the same shape. The budgets are the model's request; they are clamped to
 * [floor, ceiling] (caps.ts) by this schema and again in select.ts, so a stored
 * brief can never ask for more than a ceiling or less than a floor. Lead-with
 * and emphasise items are `{ name, framing }` (emphasise also `why`); the
 * reader also accepts the old shape (a plain string, or `{ item, why }`).
 */
export const CvBriefSchema = briefSchema(true)
/** The same shape without the old-shape reader: what the model is shown as its JSON Schema. */
export const CvBriefOutputSchema = briefSchema(false)
export type CvBrief = z.infer<typeof CvBriefSchema>

/** Employers that show bullets: the Brief's `budgets.experiences` (the key predates employers and is kept so stored briefs parse). Use this, not the raw key. */
export function employersWithBullets(brief: Pick<CvBrief, 'budgets'>): number {
  return brief.budgets.experiences
}

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

export const DROP_REASONS = ['not_selected', 'over_cap', 'unknown_id', 'duplicate', 'role_not_kept', 'role_header_only'] as const
export type DropReason = typeof DROP_REASONS[number]

export const DROP_REASON_LABEL: Record<DropReason, string> = {
  not_selected: 'not selected',
  over_cap: 'over the limit',
  unknown_id: 'not in the profile',
  duplicate: 'picked twice',
  role_not_kept: 'its employer was not kept',
  role_header_only: 'its employer is listed without bullets',
}

export const DroppedItemSchema = z.object({
  section: z.string(),
  id: z.string(),
  label: z.string().default(''),
  /** Activities: the employer key they belong to (rows stored before employers: the role's experience id). */
  parentId: z.string().optional(),
  why: z.enum(DROP_REASONS),
})
export type DroppedItem = z.infer<typeof DroppedItemSchema>

const SelectedList = z.array(SelectedItemSchema).default([])

/** An activity kept for an employer; `experienceId` is the role it came from (provenance for fact-checking). */
export const SelectedActivitySchema = SelectedItemSchema.extend({ experienceId: z.string() })
export type SelectedActivity = z.infer<typeof SelectedActivitySchema>

export const EmployerRoleSchema = z.object({
  experienceId: z.string(),
  /** The title exactly as in the profile. Never altered. */
  title: z.string(),
  /** ISO calendar date, YYYY-MM-DD. */
  start: z.string(),
  /** ISO calendar date; null = present. */
  end: z.string().nullable().default(null),
})

/** One continuous stretch at an employer (employers.ts). ISO calendar dates; `end` null = present. */
export const StintSchema = z.object({
  start: z.string(),
  end: z.string().nullable().default(null),
})

/**
 * One employer on the CV: the profile's roles at one company, grouped
 * (employers.ts). Heading = `company` + `latestTitle`; `progression` is the
 * sub-text; `bullets` are the kept activities (empty for a header-only entry).
 */
export const SelectedEmployerSchema = z.object({
  /** Stable key (normalised company name slug); the activities' `dropped.parentId`. */
  key: z.string(),
  company: z.string(),
  /** Title of the most recent role, as in the profile. The CV's heading for this employer. */
  latestTitle: z.string(),
  /** Bounds only (earliest start; `end` null = any role current). NOT for display: a returnee has gaps. Show `stints`. */
  start: z.string().nullable().default(null),
  end: z.string().nullable().default(null),
  /**
   * The employer's dates, oldest first: its roles' ranges merged where they
   * touch, overlap or sit within ~3 months. The writer renders these, never one
   * overall span. Absent on rows stored before stints (read `start`/`end` as one).
   */
  stints: z.array(StintSchema).optional(),
  /** The roles held here, oldest first. */
  roles: z.array(EmployerRoleSchema).default([]),
  /** Plain-text progression sub-line built in code (oldest title first); null with a single role. */
  progression: z.string().nullable().default(null),
  /**
   * 1-5, employers with bullets only (absent on a header-only entry: it is never
   * scored). The model's score; the lowest when it gave none; derived from term
   * matches in a rules run. A bad value reads as the middle score instead of
   * hiding the whole selection.
   */
  relevance: z.number().transform((v) => Math.min(MAX_RELEVANCE, Math.max(MIN_RELEVANCE, Math.round(v)))).catch(NEUTRAL_RELEVANCE).optional(),
  /** Why the model picked the employer; empty when code did. */
  reason: z.string().default(''),
  /** True: listed as company, title, dates and progression only, with no bullets. */
  headerOnly: z.boolean().default(false),
  /** Kept activities, best first (the model's rank order). Empty when `headerOnly`. */
  bullets: z.array(SelectedActivitySchema).default([]),
})
export type SelectedEmployer = z.infer<typeof SelectedEmployerSchema>

/**
 * Stage 2 output as stored: ids that exist in the profile, each with a
 * display label and the model's reason, and what code dropped and why. THE
 * CONTRACT Phase 3 reads (docs/cv-generation.md, "Stored selection").
 */
export const CvSelectionSchema = z.object({
  /** model: the fast model's picks, capped by code; fallback: chosen by rules after the call failed or returned junk. */
  mode: z.enum(['model', 'fallback']),
  /**
   * The CV's work history: one entry per employer, newest first (a single
   * timeline). Entries with `headerOnly: false` show bullets (at most
   * MAX_EMPLOYERS, the current employer always one of them); entries with
   * `headerOnly: true` follow the same order (at most MAX_HEADER_ONLY_EMPLOYERS).
   * Absent (empty) on rows stored before employers existed: those use
   * `experiences`, `headerOnlyRoles` and `activities` below.
   */
  employers: z.array(SelectedEmployerSchema).default([]),
  /** Legacy (rows stored before employers): roles that show bullets, newest first. New rows leave it empty. */
  experiences: SelectedList,
  /** Legacy: header-only roles of rows stored before employers. New rows leave it empty. */
  headerOnlyRoles: SelectedList,
  /** Legacy: kept activities keyed by role (experience) id. New rows leave it empty; bullets live on `employers`. */
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
  /**
   * Of `droppedTotal`, the candidates the model simply left out
   * ('not_selected'). Absent on rows stored before it existed.
   */
  notSelectedTotal: z.number().int().nonnegative().optional(),
  /**
   * Brief "emphasise" items that no kept activity or project supports (a gap the
   * CV cannot fill from the evidence). Absent on rows stored before it existed.
   */
  uncovered: z.array(z.string()).default([]),
})
export type CvSelection = z.infer<typeof CvSelectionSchema>
export type FlatSelectionKey = typeof FLAT_SECTIONS[number]

/** A stored selection, or null when absent or unreadable (never throws). */
export function parseSelection(value: unknown): CvSelection | null {
  const parsed = CvSelectionSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}


// ── Assembled CV (stage 4) ──────────────────────────────────────────────────

/** The kinds of section the writers and code produce. */
export const ASSEMBLED_SECTION_KINDS = [
  'header', 'profile', 'competencies', 'experience', 'projects', 'tools', 'skills', 'certification', 'education', 'languages',
] as const
export type AssembledSectionKind = typeof ASSEMBLED_SECTION_KINDS[number]

/** Where a bullet came from: a real evidence id and a short snippet of its text (at most 140 characters, contact details scrubbed). */
export const BulletSourceSchema = z.object({
  id: z.string(),
  kind: z.enum(['activity', 'project']).catch('activity'),
  snippet: z.string().default(''),
})
export type BulletSource = z.infer<typeof BulletSourceSchema>

/** One written bullet and the evidence it was written from. `sources` is empty when the writer did not cite one. */
export const BulletProvenanceSchema = z.object({
  text: z.string(),
  /** Phase 4a review fix: the Review stage reworded this bullet after it was written. Absent otherwise (and on older runs). */
  editedByReview: z.boolean().optional().catch(undefined),
  sources: z.array(z.unknown()).default([]).transform((items) =>
    items.flatMap((i) => { const p = BulletSourceSchema.safeParse(i); return p.success ? [p.data] : [] })).catch([]),
})
export type BulletProvenance = z.infer<typeof BulletProvenanceSchema>

/**
 * One section of the assembled CV. `model` is the model that wrote it (absent
 * when code rendered it); `tokens` its total tokens. An experience section is
 * one employer (`employerKey`). An independent Projects entry has its own
 * heading/context source (`projectSource`). `bullets` carries the provenance
 * of either kind of entry in display order; absent on runs stored before it.
 */
export const AssembledSectionSchema = z.object({
  id: z.string(),
  kind: z.string(),
  employerKey: z.string().optional(),
  markdown: z.string(),
  projectSource: BulletSourceSchema.optional().catch(undefined),
  model: z.string().optional(),
  tokens: z.object({ input: z.number().nonnegative().default(0), output: z.number().nonnegative().default(0) }).optional(),
  bullets: z.array(z.unknown()).optional().transform((items) =>
    items?.flatMap((i) => { const p = BulletProvenanceSchema.safeParse(i); return p.success ? [p.data] : [] })).catch(undefined),
})
// The transform makes the key required in the inferred type; it is optional in what is stored.
export type AssembledSection = Omit<z.infer<typeof AssembledSectionSchema>, 'bullets'> & { bullets?: BulletProvenance[] }

/**
 * `CvGeneration.assembled`: the CV as one Markdown document (with the literal
 * `{{contact}}` placeholder, never contact details), its sections, the
 * fact-check warnings and the few "worth a quick check" notes. Read tolerantly:
 * a malformed row reads as null (parseAssembled), and a bad entry inside a list
 * is dropped, never the whole CV.
 */
export const CvAssembledSchema = z.object({
  markdown: z.string(),
  sections: z.array(z.unknown()).default([]).transform((items) =>
    items.flatMap((i) => { const p = AssembledSectionSchema.safeParse(i); return p.success ? [p.data] : [] })).catch([]),
  warnings: z.array(z.unknown()).default([]).transform((items) => items.filter((i): i is string => typeof i === 'string')).catch([]),
  checkNotes: z.array(z.unknown()).default([]).transform((items) => items.filter((i): i is string => typeof i === 'string')).catch([]),
})
export type CvAssembled = Omit<z.infer<typeof CvAssembledSchema>, 'sections'> & { sections: AssembledSection[] }

/** A stored assembled CV, or null when absent or unreadable (never throws). */
export function parseAssembled(value: unknown): CvAssembled | null {
  const parsed = CvAssembledSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Most "worth a quick check" notes the log shows: coach/verification flags stay rare. */
export const MAX_CHECK_NOTES = 3

/** Starts every "worth a quick check" line in the Assemble log entry's notes. */
export const CHECK_NOTE_PREFIX = 'Worth a quick check: '

// ── Review (stage 5) ────────────────────────────────────────────────────────

export const REVIEW_ACTIONS = ['replace', 'remove'] as const
export const CONCERN_KINDS = ['evidence_gap', 'metric_conflict', 'claimed_in_bullet', 'weak_proof', 'other'] as const
export type ConcernKind = typeof CONCERN_KINDS[number]

export const CONCERN_KIND_LABEL: Record<ConcernKind, string> = {
  evidence_gap: 'Evidence gap',
  metric_conflict: 'Conflicting figures',
  claimed_in_bullet: 'Unevidenced tool in a bullet',
  weak_proof: 'Thin proof',
  other: 'Other',
}

/** One edit the Review model proposes. `bulletId` may be null or missing (the profile paragraph has none); both read as undefined. */
export const ReviewEditSchema = z.object({
  target: z.object({
    sectionId: z.string().describe('The section id exactly as listed, e.g. "experience:acme-cloud" or "profile"'),
    bulletId: z.string().nullish().describe('A bullet id of that section ("b1", "b2"...) or "summary"; leave out (or null) to edit the profile paragraph').transform((v) => v ?? undefined),
  }),
  action: z.enum(REVIEW_ACTIONS),
  newText: z.string().nullish().describe('The replacement as plain text (replace only)').transform((v) => v?.trim().slice(0, REVIEW_LIMITS.newTextChars) || undefined),
  reason: cutText(REVIEW_LIMITS.reasonChars, 'Why the edit is needed'),
})

/** One concern for the coach. */
export const ReviewConcernSchema = z.object({
  kind: z.enum(CONCERN_KINDS),
  title: cutText(REVIEW_LIMITS.titleChars, 'A short name for the concern'),
  why: cutText(REVIEW_LIMITS.whyChars, 'Why it is a concern'),
  question: cutText(REVIEW_LIMITS.questionChars, 'A question to put to the candidate'),
  refs: z.array(z.string()).default([]).describe('Evidence labels (S1, S2...) the concern is about; empty when none'),
})

/** The JSON Schema the model is shown (strict items: this is the contract, not the parser). */
export const ReviewOutputContract = z.object({
  edits: z.array(ReviewEditSchema).describe(`Edits to make (at most ${REVIEW_LIMITS.maxEdits})`),
  concerns: z.array(ReviewConcernSchema).describe(`Concerns for the coach (at most ${REVIEW_LIMITS.maxConcerns})`),
})

/** The items of a list the model answered that parse, in order, plus how many did not. Not a list at all reads as empty. */
function lenientItems<T extends z.ZodType>(item: T, max: number) {
  return z.unknown().optional().transform((raw): { items: z.output<T>[]; dropped: number } => {
    if (!Array.isArray(raw)) return { items: [], dropped: 0 }
    const items: z.output<T>[] = []
    let dropped = 0
    for (const r of raw) {
      const p = item.safeParse(r)
      if (p.success) items.push(p.data)
      else dropped++
    }
    return { items: items.slice(0, max), dropped }
  })
}

/**
 * What the Review model answers, parsed item by item: ONE malformed edit or
 * concern is dropped (and counted, for the log) instead of throwing away the
 * whole answer and paying for a second call. Lists are cut to their limits and
 * text to its length rather than failing; only an answer that is not an object
 * fails (and is retried). `newText` is required for 'replace'; code discards a
 * replace without it. Code applies the edits only after re-checking them
 * (write/review.ts), so nothing here is trusted.
 */
export const ReviewOutputSchema = z.object({
  edits: lenientItems(ReviewEditSchema, REVIEW_LIMITS.maxEdits),
  concerns: lenientItems(ReviewConcernSchema, REVIEW_LIMITS.maxConcerns),
}).transform((o) => ({
  edits: o.edits.items,
  concerns: o.concerns.items,
  /** Items of each list the model sent that could not be read. */
  unreadable: { edits: o.edits.dropped, concerns: o.concerns.dropped },
}))
export type ReviewOutput = z.output<typeof ReviewOutputSchema>

/** A lenient list: bad entries are dropped, a bad list reads as empty (never fails the whole record). */
function lenientList<T extends z.ZodType>(item: T) {
  return z.array(z.unknown()).default([]).transform((items) =>
    items.flatMap((i) => { const p = item.safeParse(i); return p.success ? [p.data as z.infer<T>] : [] })).catch([] as z.infer<T>[])
}

const ReviewTargetFields = {
  sectionId: z.string(),
  /** A bullet id ("b1"), "summary", or null for a section-level edit (the profile paragraph). */
  bulletId: z.string().nullable().default(null),
  action: z.enum(REVIEW_ACTIONS).catch('replace'),
}

/** An edit that was applied: the text before and after (cut short), and the model's reason. */
export const AppliedEditSchema = z.object({
  ...ReviewTargetFields,
  before: z.string().default(''),
  after: z.string().nullable().default(null),
  reason: z.string().default(''),
  /** What code noticed about the edit (a figure not in the bullet's cited sources, provenance cleared); empty when nothing. */
  note: z.string().default(''),
})
export type AppliedEdit = z.infer<typeof AppliedEditSchema>

/** An edit that was refused: what was proposed, and why code discarded it. */
export const DiscardedEditSchema = z.object({
  ...ReviewTargetFields,
  proposed: z.string().nullable().default(null),
  /** Why code discarded it (names the check that failed). */
  why: z.string().default(''),
  /** The model's reason for proposing it. */
  reason: z.string().default(''),
})
export type DiscardedEdit = z.infer<typeof DiscardedEditSchema>

export const ConcernRecordSchema = z.object({
  kind: z.enum(CONCERN_KINDS).catch('other'),
  title: z.string().default(''),
  why: z.string().default(''),
  question: z.string().default(''),
  /** The evidence the concern is about, with a short snippet of each (labels are only meaningful within the review prompt). */
  refs: lenientList(z.object({ label: z.string(), snippet: z.string().default('') })),
})
export type ConcernRecord = z.infer<typeof ConcernRecordSchema>

/**
 * `CvGeneration.review`: what the Review stage did. `skipped` is true when no
 * review ran (turned off for the run, or it could not finish: `skipReason`
 * says which). Concerns are stored even when some edits were discarded. Read
 * tolerantly: null for a run that never reached Review, a bad entry in a
 * list is dropped.
 */
export const CvReviewSchema = z.object({
  skipped: z.boolean().default(false),
  skipReason: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  tokens: z.object({ input: z.number().nonnegative().default(0), output: z.number().nonnegative().default(0) }).default({ input: 0, output: 0 }),
  costUsd: z.number().nonnegative().nullable().default(null),
  applied: lenientList(AppliedEditSchema),
  discarded: lenientList(DiscardedEditSchema),
  concerns: lenientList(ConcernRecordSchema),
})
export type CvReview = z.infer<typeof CvReviewSchema>

/** A stored review, or null when absent or unreadable (never throws). */
export function parseReview(value: unknown): CvReview | null {
  const parsed = CvReviewSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

// ── Start request ───────────────────────────────────────────────────────────

/**
 * The optional JSON body of POST /api/jobs/[id]/cv-generation. `fresh` forces
 * a new Brief and Select instead of reusing the stored ones; `review: false`
 * skips the Review call (the CV lands unreviewed). Unknown keys are ignored.
 */
export const StartCvGenerationBodySchema = z.object({
  fresh: z.boolean().optional(),
  review: z.boolean().optional(),
})
export type StartCvGenerationBody = z.infer<typeof StartCvGenerationBodySchema>
