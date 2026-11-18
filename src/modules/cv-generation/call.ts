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

/** Not enough time left for a second attempt (ms). */
const MIN_RETRY_MS = 15_000

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

export function addUsage(a: CallUsage, b: CallUsage): CallUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    costUsd: a.costUsd === null || b.costUsd === null ? null : a.costUsd + b.costUsd,
    calls: a.calls + b.calls,
  }
}

export type ValidatedCall<T> = { value: T; model: string; retries: number; usage: CallUsage }

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
  let usage = NO_USAGE
  for (let attempt = 0; attempt < 2; attempt++) {
    const maxOutputTokens = attempt === 0 ? opts.maxOutputTokens : opts.retryMaxOutputTokens
    const result = await completeJSON(profileId, prompt + note, schema, {
      ...callOpts,
      maxOutputTokens,
      retryMaxOutputTokens: maxOutputTokens,
      // Never let completeJSON make a second call of its own: this loop owns the retry.
      minRetryMs: Number.POSITIVE_INFINITY,
    })
    usage = addUsage(usage, usageOf(result))
    if (result.extracted.ok) return { value: result.extracted.value, model: result.model, retries: attempt, usage }
    reason = describeFailure(result.extracted)
    // No raw text in the log: it can echo the profile and the job description.
    console.error(`[cv-generation] ${label} output unusable`, {
      runId: opts.attribution.runId,
      reason: result.extracted.reason,
      finishReason: result.finishReason,
    })
    if (opts.deadline - Date.now() < MIN_RETRY_MS) break
    note = result.finishReason === 'length'
      ? `\n\n== NOTE ==\nYour previous answer was cut off before the JSON object was complete. Return the COMPLETE JSON object this time, in one \`\`\`json code block, with nothing truncated. Keep every text field short.`
      : `\n\n== NOTE ==\nYour previous answer was rejected: ${reason}. Return the complete JSON object again, in one \`\`\`json code block, matching the schema exactly.`
  }
  throw new LLMError(`The ${label} did not match the expected shape (${reason}).`, 'invalid_output')
}

/** What a writer's code check found. `hard` = the output cannot be used (invalid blocks); `soft` = usable but breaks a rule (limits, figures, claimed tools). */
export type CheckResult = { hard: string[]; soft: string[] }

export type CheckedCall<T> = ValidatedCall<T> & {
  /** Soft problems still present in the accepted answer (after the one retry). */
  softIssues: string[]
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
 *   the caller can log them).
 * - A retry that throws (timeout, provider error) after a usable first answer
 *   returns the first answer; with no usable answer it rethrows.
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
  const accept = (value: T, soft: string[], retries: number): CheckedCall<T> => ({ value, model, retries, usage, softIssues: soft })

  for (let attempt = 0; attempt < 2; attempt++) {
    const maxOutputTokens = attempt === 0 ? opts.maxOutputTokens : opts.retryMaxOutputTokens
    let result: Awaited<ReturnType<typeof completeJSON<T>>>
    try {
      result = await completeJSON(profileId, prompt + note, schema, {
        ...callOpts,
        maxOutputTokens,
        retryMaxOutputTokens: maxOutputTokens,
        minRetryMs: Number.POSITIVE_INFINITY,
      })
    } catch (err) {
      if (held) return accept(held.value, [...held.soft, 'The retry did not finish, so the first answer was kept.'], attempt)
      throw err
    }
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
    }

    const last = attempt === 1 || opts.deadline - Date.now() < MIN_RETRY_MS
    if (last) {
      if (result.extracted.ok && problems.hard.length === 0) return accept(result.extracted.value, problems.soft, attempt)
      if (held) return accept(held.value, held.soft, attempt)
      const detail = problems.hard.join('; ')
      throw new LLMError(`The ${label} could not be used (${detail}).`, 'invalid_output')
    }
    const feedback = [...problems.hard, ...problems.soft]
    note = result.extracted.ok || result.finishReason !== 'length'
      ? `\n\n== NOTE ==\nYour previous answer had problems. Fix every one of them and return the complete JSON object again, in one \`\`\`json code block, matching the schema exactly:\n${feedback.map((f) => `- ${f}`).join('\n')}`
      : `\n\n== NOTE ==\nYour previous answer was cut off before the JSON object was complete. Return the COMPLETE JSON object this time, in one \`\`\`json code block, with nothing truncated. Keep every text field short.`
  }
  throw new LLMError(`The ${label} could not be used (${reason}).`, 'invalid_output')
}
