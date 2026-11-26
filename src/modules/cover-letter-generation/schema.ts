/**
 * Cover letter generation (issue #471): statuses, limits, and the Zod shapes
 * of what is stored on a run and what the model returns.
 *
 * The run goes queued → gathering → suggesting → awaiting_choice, pauses
 * there until the owner picks an angle (or writes their own), then writing →
 * reviewing → landing → complete. Any step may end it `failed`.
 * Implementation record: docs/cover-letter-generation.md.
 */

import * as z from 'zod'

export const COVER_LETTER_STATUSES = [
  'queued', 'gathering', 'suggesting', 'awaiting_choice', 'writing', 'reviewing', 'landing', 'complete', 'failed',
] as const
export type CoverLetterStatus = typeof COVER_LETTER_STATUSES[number]

/** Statuses in which the pipeline is working (a stale one reads as failed / timeout). */
export const PROCESSING_STATUSES = ['queued', 'gathering', 'suggesting', 'writing', 'reviewing', 'landing'] as const satisfies readonly CoverLetterStatus[]

/** Every non-final status, in pipeline order: what setStatus moves forward through. */
export const OPEN_STATUSES = ['queued', 'gathering', 'suggesting', 'awaiting_choice', 'writing', 'reviewing', 'landing'] as const satisfies readonly CoverLetterStatus[]

export function parseStatus(value: unknown): CoverLetterStatus {
  return (COVER_LETTER_STATUSES as readonly unknown[]).includes(value) ? (value as CoverLetterStatus) : 'failed'
}

export const FAILURE_KINDS = [
  'no_llm_key', 'no_description', 'timeout', 'rate_limited', 'overloaded', 'refusal', 'invalid_output',
  'draft_exists', 'document_limit', 'expired', 'superseded', 'error',
] as const
export type CoverLetterFailureKind = typeof FAILURE_KINDS[number]

/** A processing run with no progress for this long reads as failed / timeout. */
export const PROCESSING_STALE_MS = 10 * 60_000
/** Suggested angles wait this long for a choice, then the run reads as failed / expired. */
export const ANGLES_VALID_MS = 7 * 24 * 60 * 60_000
/** Processing runs per profile at once (admitted under an advisory lock). */
export const CONCURRENCY_PER_PROFILE = 2
/** maxDuration (s) of the routes that run a phase in after(); the route literals must match. */
export const ROUTE_MAX_DURATION_S = 300

/** Per-phase time budgets (ms): each phase runs in its own after() under ROUTE_MAX_DURATION_S. */
export const TIME_BUDGET_MS = {
  angles: 90_000,
  suggestPhase: 150_000,
  write: 100_000,
  review: 70_000,
  writePhase: 270_000,
} as const

export const MAX_OUTPUT_TOKENS = {
  angles: 4_000, anglesRetry: 8_000,
  write: 4_000, writeRetry: 8_000,
  review: 3_000, reviewRetry: 6_000,
} as const

/** Usage feature tags, one per call kind (labels in settings/usage feature-labels.ts). */
export const COVER_LETTER_FEATURES = {
  angles: 'cover-letter-gen-angles',
  write: 'cover-letter-gen-write',
  review: 'cover-letter-gen-review',
} as const

// ── Owner choices ──────────────────────────────────────────────────────────

export const TONES = ['warm', 'direct', 'formal'] as const
export type Tone = typeof TONES[number]
export const TONE_LABELS: Record<Tone, { label: string; description: string }> = {
  warm: { label: 'Warm', description: 'Personable and conversational, still professional.' },
  direct: { label: 'Direct', description: 'Plain, confident and to the point.' },
  formal: { label: 'Formal', description: 'Traditional and polished, for conservative employers.' },
}

export const LENGTHS = ['short', 'standard'] as const
export type LetterLength = typeof LENGTHS[number]
/** Body word ranges (salutation, header and sign-off not counted). */
export const LENGTH_WORDS: Record<LetterLength, { min: number; max: number; target: number }> = {
  short: { min: 170, max: 290, target: 240 },
  standard: { min: 270, max: 420, target: 340 },
}

/** What a personal question is about. Only REUSABLE_TOPICS are remembered across jobs. */
export const QUESTION_TOPICS = ['why_company', 'personal_connection', 'why_now', 'motivation', 'other'] as const
export type QuestionTopic = typeof QUESTION_TOPICS[number]
export const REUSABLE_TOPICS: readonly QuestionTopic[] = ['why_now', 'motivation']

const text = (max: number) => z.string().trim().max(max)

// ── Angles (model output, stored on the run) ──────────────────────────────

export const AngleSchema = z.object({
  name: text(80).min(1).describe('A short name for the angle'),
  pitch: text(260).min(1).describe('One sentence: the argument this letter makes'),
  hook: text(300).min(1).describe('The opening idea: about their problem or a real connection, never "I am writing to apply"'),
  proofPoints: z.array(z.object({
    evidence: text(240).min(1).describe('The profile evidence this leans on, in the profile\'s own words'),
    why: text(200).min(1).describe('Why it answers this job'),
  })).min(1).max(2),
  whyThem: z.object({
    fact: text(260).min(1).describe('One true, specific detail about the company or role'),
    source: z.enum(['deep-dive', 'job-description']).describe('Where the fact comes from'),
  }),
  playsDown: text(200).describe('What this angle keeps quiet about; empty when nothing'),
  fit: text(200).min(1).describe('When this angle works best, one line'),
})
export type Angle = z.infer<typeof AngleSchema>

export const QuestionSchema = z.object({
  topic: z.enum(QUESTION_TOPICS),
  question: text(200).min(1).describe('A short, specific question to the candidate'),
  why: text(160).describe('What the answer adds to the letter'),
})
export type Question = z.infer<typeof QuestionSchema>

export const AnglesOutputSchema = z.object({
  angles: z.array(AngleSchema).min(2).max(3),
  questions: z.array(QuestionSchema).min(2).max(3),
  suggestedTone: z.enum(TONES),
  toneReason: text(200),
})
export type AnglesOutput = z.infer<typeof AnglesOutputSchema>

/** As stored: each angle's company fact is marked verified when code found it in the deep dive or job description text. */
export const StoredAnglesSchema = AnglesOutputSchema.extend({
  angles: z.array(AngleSchema.extend({ whyThemVerified: z.boolean() })).min(1).max(3),
})
export type StoredAngles = z.infer<typeof StoredAnglesSchema>

// ── The owner's choice (request body and stored) ──────────────────────────

export const ChoiceSchema = z.object({
  angle: z.union([
    z.object({ index: z.number().int().min(0).max(2) }),
    z.object({ custom: text(600).min(10, 'Describe your angle in a sentence or two') }),
  ]),
  answers: z.array(z.object({
    topic: z.enum(QUESTION_TOPICS),
    question: text(200).min(1),
    answer: text(800),
  })).max(5).default([]),
  tone: z.enum(TONES),
  length: z.enum(LENGTHS),
  /** Remember tone, length and reusable answers for next time (default true). */
  remember: z.boolean().default(true),
})
export type CoverLetterChoice = z.infer<typeof ChoiceSchema>
export type CoverLetterChoiceInput = z.input<typeof ChoiceSchema>

export const StartBodySchema = z.object({
  /** Suggest new angles even when a run is waiting for a choice (that run is ended as superseded). */
  fresh: z.boolean().optional(),
})

// ── Writing (model output and stored letter) ──────────────────────────────

export const WriteOutputSchema = z.object({
  salutation: text(120).min(1).describe('e.g. "Dear Hiring Team," or "Dear Ms Rivera,"'),
  paragraphs: z.array(text(1400).min(1)).min(3).max(5),
  closing: text(60).min(1).describe('e.g. "Kind regards,"'),
})
export type WriteOutput = z.infer<typeof WriteOutputSchema>

export const WrittenSchema = WriteOutputSchema.extend({
  markdown: z.string(),
  wordCount: z.number(),
  /** Problems the checks still saw on the accepted letter (soft: never block it). */
  checkNotes: z.array(z.string()),
})
export type CoverLetterWritten = z.infer<typeof WrittenSchema>

// ── Review ────────────────────────────────────────────────────────────────

export const CONCERN_KINDS = ['missing_requirement', 'weak_evidence', 'generic', 'tone', 'personal', 'unsupported_claim', 'length', 'other'] as const

export const ReviewOutputSchema = z.object({
  edits: z.array(z.object({
    paragraph: z.number().int().min(0).max(4),
    before: text(600).min(1).describe('Exact text from that paragraph'),
    after: text(700).describe('The replacement; empty removes it'),
    reason: text(200),
  })).max(6),
  concerns: z.array(z.object({
    kind: z.enum(CONCERN_KINDS),
    why: text(300).min(1),
    suggestion: text(300).min(1).describe('What the candidate could do, or a question to answer'),
  })).max(4),
})
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>

export const StoredReviewSchema = z.object({
  skipped: z.boolean(),
  skipReason: z.string().nullable(),
  model: z.string().nullable(),
  applied: z.array(z.object({ paragraph: z.number(), before: z.string(), after: z.string(), reason: z.string() })),
  discarded: z.array(z.object({ paragraph: z.number(), before: z.string(), why: z.string() })),
  concerns: ReviewOutputSchema.shape.concerns,
})
export type CoverLetterReview = z.infer<typeof StoredReviewSchema>

// ── Log ───────────────────────────────────────────────────────────────────

export const STAGES = ['gather', 'angles', 'write', 'review', 'land'] as const
export type CoverLetterStage = typeof STAGES[number]

export const LogEntrySchema = z.object({
  stage: z.enum(STAGES),
  status: z.enum(['ok', 'skipped', 'failed']),
  model: z.string().nullable(),
  startedAt: z.string(),
  durationMs: z.number().nullable(),
  tokens: z.object({ input: z.number(), output: z.number() }),
  costUsd: z.number().nullable(),
  retries: z.number(),
  notes: z.array(z.string()),
})
export type LogEntry = z.infer<typeof LogEntrySchema>

/** Reads a stored JSON column tolerantly: null (never a throw) when missing or malformed. */
export function parseStored<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Stored log entries; a malformed entry is dropped, never thrown. */
export function parseLog(value: unknown): LogEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((e) => {
    const parsed = LogEntrySchema.safeParse(e)
    return parsed.success ? [parsed.data] : []
  })
}
