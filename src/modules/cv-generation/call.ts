/**
 * One validated JSON model call with a single retry, shared by Brief and
 * Select. The schema is too big a risk for native structured output on some
 * providers (docs/deep-dive.md, "compiled grammar is too large"), so it goes
 * in the system prompt as JSON Schema and the answer is checked with Zod
 * (completeJSON), like the deep dive's synthesis.
 *
 * At most TWO calls per stage. completeJSON's own cut-off retry is switched
 * off (it would restart at the small cap and double the calls); this loop does
 * the one retry instead, for an answer that was cut off or parsed but did not
 * match. The retry always runs at the larger token cap, with a note that says
 * what was wrong (field names only, never the model's text).
 */

import * as z from 'zod'
import { completeJSON } from '@/modules/llm/complete-json'
import { LLMError } from '@/modules/llm/errors'
import type { LlmAttribution } from '@/modules/llm/attribution'
import type { CompleteOptions } from '@/modules/llm/client'
import type { ExtractJSONResult } from '@/modules/llm/extract-json'
import { estimateRowCostUsd } from '@/modules/llm/pricing'

/**
 * The answer was cut off by the output token limit and a retry would send the
 * same budget again, so none was made. Kind `invalid_output` like any unusable
 * answer; a caller that has a code fallback (the experience writer) can catch
 * it by class instead of failing the run.
 */
export class CutOffError extends LLMError {
  constructor(label: string, readonly tokens: number) {
    super(`The ${label} was cut off at ${tokens} output tokens, the largest budget it gets.`, 'invalid_output')
    this.name = 'CutOffError'
  }
}

/** Not enough time left for a second attempt (ms). */
const MIN_RETRY_MS = 15_000
/**
 * A retry for a SOFT problem (a limit, a figure, a name) is skipped when the
 * time left is under this many times the first call's duration: the answer is
 * usable, and a late retry could cost the run its later stages. A hard failure
 * (no usable answer) still retries.
 */
export const SOFT_RETRY_TIME_FACTOR = 2

/**
 * Tokens and estimated cost of the model calls of one stage or section, taken
 * from the call results themselves. The usage rows in the database are written
 * in an after() callback of the call, so reading them straight back races the
 * write (the Select row showed no tokens or cost); this is race-free.
 * `costUsd` is null when any call's model has no listed price.
 */
export type CallUsage = { input: number; output: number; costUsd: number | null; calls: number }

export const NO_USAGE: CallUsage = { input: 0, output: 0, costUsd: 0, calls: 0 }

type UsageSource = {
  model: string
  provider?: string
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number | null; cacheWriteTokens: number | null }
}

/** The usage of one completeJSON result. */
export function usageOf(r: UsageSource): CallUsage {
  const u = r.usage
  const cost = r.provider && u
    ? estimateRowCostUsd({
        provider: r.provider, model: r.model, promptTokens: u.inputTokens, completionTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens,
      })
    : null
  return { input: u?.inputTokens ?? 0, output: u?.outputTokens ?? 0, costUsd: u ? cost : null, calls: 1 }
}

/** Attaches what the calls made so far used to an error, so a caller can still record it (the call itself returned nothing). */
export function withUsage<E>(err: E, usage: CallUsage): E {
  if (err && typeof err === 'object') (err as { usage?: CallUsage }).usage = usage
  return err
}

/** The usage attached to an error by withUsage, or none. */
export function usageOfError(err: unknown): CallUsage {
  const u = err && typeof err === 'object' ? (err as { usage?: CallUsage }).usage : undefined
  return u && typeof u.calls === 'number' ? u : NO_USAGE
}

export function addUsage(a: CallUsage, b: CallUsage): CallUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    costUsd: a.costUsd === null || b.costUsd === null ? null : a.costUsd + b.costUsd,
    calls: a.calls + b.calls,
  }
}

/** Longest a recorded retry reason may be: the log shows them as short phrases. */
const REASON_MAX_CHARS = 140

/** A retry reason for the log: one line, never longer than REASON_MAX_CHARS. */
export function shortReason(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > REASON_MAX_CHARS ? `${t.slice(0, REASON_MAX_CHARS - 1)}…` : t
}

export type ValidatedCall<T> = {
  value: T
  model: string
  retries: number
  usage: CallUsage
  /** Why the retry happened (short phrases); empty with no retry. Always set by completeValidated; optional so test doubles may omit it. */
  retryReasons?: string[]
}

/** Why an answer failed, in words that name fields but never quote the model's text. */
export function describeFailure(ex: Extract<ExtractJSONResult<unknown>, { ok: false }>): string {
  if (ex.reason === 'no_json') return 'it contained no JSON object'
  if (ex.reason === 'parse') return 'it was not valid JSON'
  const issues = ex.error instanceof z.ZodError ? ex.error.issues : []
  const paths = [...new Set(issues.slice(0, 8).map((i) => i.path.join('.') || '(root)'))]
  return paths.length > 0 ? `these fields were missing or the wrong type: ${paths.join(', ')}` : 'it did not match the schema'
}

export async function completeValidated<T>(
  profileId: string,
  prompt: string,
  schema: z.ZodType<T>,
  opts: Pick<CompleteOptions, 'role' | 'system' | 'temperature' | 'timeoutMs' | 'maxOutputTokens'> & {
    feature: string
    attribution: LlmAttribution
    retryMaxOutputTokens: number
    /** Epoch ms both attempts must finish by. */
    deadline: number
    /** Names the stage in the log line when the output is unusable. */
    label: string
  },
): Promise<ValidatedCall<T>> {
  const { label, ...callOpts } = opts
  let note = ''
  let reason = ''
  let retryWhy = ''
  let usage = NO_USAGE
  for (let attempt = 0; attempt < 2; attempt++) {
    const maxOutputTokens = attempt === 0 ? opts.maxOutputTokens : opts.retryMaxOutputTokens
    let result: Awaited<ReturnType<typeof completeJSON<T>>>
    try {
      result = await completeJSON(profileId, prompt + note, schema, {
        ...callOpts,
        maxOutputTokens,
        retryMaxOutputTokens: maxOutputTokens,
        // Never let completeJSON make a second call of its own: this loop owns the retry.
        minRetryMs: Number.POSITIVE_INFINITY,
      })
    } catch (err) {
      throw withUsage(err, usage)
    }
    usage = addUsage(usage, usageOf(result))
    if (result.extracted.ok) return { value: result.extracted.value, model: result.model, retries: attempt, usage, retryReasons: attempt > 0 ? [shortReason(retryWhy)] : [] }
    reason = describeFailure(result.extracted)
    retryWhy = result.finishReason === 'length' ? 'the answer was cut off' : `the answer was rejected: ${reason}`
    // No raw text in the log: it can echo the profile and the job description.
    console.error(`[cv-generation] ${label} output unusable`, {
      runId: opts.attribution.runId,
      reason: result.extracted.reason,
      finishReason: result.finishReason,
    })
    if (opts.deadline - Date.now() < MIN_RETRY_MS) break
    if (attempt === 0 && result.finishReason === 'length' && opts.retryMaxOutputTokens <= (maxOutputTokens ?? 0)) throw withUsage(new CutOffError(label, maxOutputTokens ?? 0), usage)
    note = result.finishReason === 'length'
      ? `\n\n== NOTE ==\nYour previous answer was cut off before the JSON object was complete. Return the COMPLETE JSON object this time, in one \`\`\`json code block, with nothing truncated. Keep every text field short.`
      : `\n\n== NOTE ==\nYour previous answer was rejected: ${reason}. Return the complete JSON object again, in one \`\`\`json code block, matching the schema exactly.`
  }
  throw withUsage(new LLMError(`The ${label} did not match the expected shape (${reason}).`, 'invalid_output'), usage)
}

/**
 * What a writer's code check found. `hard` = the output cannot be used (invalid
 * blocks); `soft` = usable but breaks a rule (limits, figures, claimed tools).
 * `why` = the same problems as short phrases for the log ("figure 14k not in
 * evidence", "first person"); when absent the problem sentences are logged.
 */
export type CheckResult = { hard: string[]; soft: string[]; why?: string[] }

export type CheckedCall<T> = ValidatedCall<T> & {
  /** Soft problems still present in the accepted answer (after the one retry, or with none when there was no time for it). */
  softIssues: string[]
  /** A retry for soft problems was skipped because too little time was left. */
  retrySkipped: boolean
  /** Why the retry happened, as short phrases; empty with no retry. */
  retryReasons: string[]
}

/** Log notes for the soft problems of an accepted answer. */
export function softIssueNotes(call: Pick<CheckedCall<unknown>, 'softIssues' | 'retrySkipped'>): string[] {
  return call.softIssues.map((s) => `Accepted with a problem ${call.retrySkipped ? '(not enough time for a retry)' : 'after the retry'}: ${s}.`)
}

/**
 * A writer call: completeJSON + Zod + code checks, with ONE retry shared by
 * every kind of problem, so a writer makes at most TWO calls whatever went
 * wrong. The retry runs at the larger token cap and names exactly what to fix.
 *
 * - An answer that does not parse or match the schema, or whose `hard` check
 *   fails, is retried once; if the retry also fails the call throws
 *   LLMError invalid_output (unless the first answer had only soft problems:
 *   then that one is accepted).
 * - An answer with only `soft` problems is retried once with feedback, then
 *   accepted whatever the second answer's soft problems (they are returned so
 *   the caller can log them). The retry is skipped when the time left is under
 *   SOFT_RETRY_TIME_FACTOR times the first call's duration.
 * - A retry that throws (timeout, provider error) after a usable first answer
 *   returns the first answer; with no usable answer it rethrows.
 * - A first answer that was CUT OFF by the output limit is retried only when the
 *   retry cap is larger than the first one; otherwise the same budget would be
 *   sent again and the call throws CutOffError without spending the retry.
 */
export async function completeChecked<T>(
  profileId: string,
  prompt: string,
  schema: z.ZodType<T>,
  opts: Pick<CompleteOptions, 'role' | 'system' | 'temperature' | 'timeoutMs' | 'maxOutputTokens'> & {
    feature: string
    attribution: LlmAttribution
    retryMaxOutputTokens: number
    deadline: number
    label: string
    check: (value: T) => CheckResult
  },
): Promise<CheckedCall<T>> {
  const { label, check, ...callOpts } = opts
  let note = ''
  let reason = ''
  let usage = NO_USAGE
  let model = ''
  let held: { value: T; soft: string[] } | null = null // an earlier answer with soft problems only
  let firstMs = 0
  let retrySkipped = false
  let retryReasons: string[] = []
  const accept = (value: T, soft: string[], retries: number): CheckedCall<T> => ({ value, model, retries, usage, softIssues: soft, retrySkipped, retryReasons: retries > 0 ? retryReasons : [] })

  for (let attempt = 0; attempt < 2; attempt++) {
    const maxOutputTokens = attempt === 0 ? opts.maxOutputTokens : opts.retryMaxOutputTokens
    let result: Awaited<ReturnType<typeof completeJSON<T>>>
    const startedAt = Date.now()
    try {
      result = await completeJSON(profileId, prompt + note, schema, {
        ...callOpts,
        maxOutputTokens,
        retryMaxOutputTokens: maxOutputTokens,
        minRetryMs: Number.POSITIVE_INFINITY,
      })
    } catch (err) {
      if (held) return accept(held.value, [...held.soft, 'The retry did not finish, so the first answer was kept.'], attempt)
      throw withUsage(err, usage)
    }
    if (attempt === 0) firstMs = Date.now() - startedAt
    usage = addUsage(usage, usageOf(result))
    model = result.model

    let problems: CheckResult
    if (result.extracted.ok) {
      problems = check(result.extracted.value)
      if (problems.hard.length === 0 && problems.soft.length === 0) return accept(result.extracted.value, [], attempt)
      if (problems.hard.length === 0) held = { value: result.extracted.value, soft: problems.soft }
    } else {
      reason = describeFailure(result.extracted)
      console.error(`[cv-generation] ${label} output unusable`, { runId: opts.attribution.runId, reason: result.extracted.reason, finishReason: result.finishReason })
      problems = { hard: [`your previous answer was rejected: ${reason}`], soft: [] }
      // A cut-off that the retry could not fix (same budget): not worth a second call.
      if (attempt === 0 && result.finishReason === 'length' && opts.retryMaxOutputTokens <= (maxOutputTokens ?? 0)) throw withUsage(new CutOffError(label, maxOutputTokens ?? 0), usage)
    }

    const left = opts.deadline - Date.now()
    // A soft problem is not worth a late retry; a hard one still is (the answer is unusable without it).
    retrySkipped = attempt === 0 && problems.hard.length === 0 && result.extracted.ok && (left < MIN_RETRY_MS || left < SOFT_RETRY_TIME_FACTOR * firstMs)
    const last = attempt === 1 || left < MIN_RETRY_MS || retrySkipped
    if (last) {
      if (result.extracted.ok && problems.hard.length === 0) return accept(result.extracted.value, problems.soft, attempt)
      if (held) return accept(held.value, held.soft, attempt)
      const detail = problems.hard.join('; ')
      throw withUsage(new LLMError(`The ${label} could not be used (${detail}).`, 'invalid_output'), usage)
    }
    const feedback = [...problems.hard, ...problems.soft]
    retryReasons = (problems.why && problems.why.length > 0 ? problems.why : result.extracted.ok || result.finishReason !== 'length' ? feedback : ['the answer was cut off']).map(shortReason)
    note = result.extracted.ok || result.finishReason !== 'length'
      ? `\n\n== NOTE ==\nYour previous answer had problems. Fix every one of them and return the complete JSON object again, in one \`\`\`json code block, matching the schema exactly:\n${feedback.map((f) => `- ${f}`).join('\n')}`
      : `\n\n== NOTE ==\nYour previous answer was cut off before the JSON object was complete. Return the COMPLETE JSON object this time, in one \`\`\`json code block, with nothing truncated. Keep every text field short.`
  }
  throw withUsage(new LLMError(`The ${label} could not be used (${reason}).`, 'invalid_output'), usage)
}
