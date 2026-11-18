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

/** Not enough time left for a second attempt (ms). */
const MIN_RETRY_MS = 15_000

export type ValidatedCall<T> = { value: T; model: string; retries: number }

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
  for (let attempt = 0; attempt < 2; attempt++) {
    const maxOutputTokens = attempt === 0 ? opts.maxOutputTokens : opts.retryMaxOutputTokens
    const result = await completeJSON(profileId, prompt + note, schema, {
      ...callOpts,
      maxOutputTokens,
      retryMaxOutputTokens: maxOutputTokens,
      // Never let completeJSON make a second call of its own: this loop owns the retry.
      minRetryMs: Number.POSITIVE_INFINITY,
    })
    if (result.extracted.ok) return { value: result.extracted.value, model: result.model, retries: attempt }
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
