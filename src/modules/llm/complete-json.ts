// Plain-text LLM call that must yield a single JSON document, with a retry for
// responses cut off by the token cap. Long documents (master CVs in particular)
// frequently hit maxOutputTokens mid-JSON — no closing fence, unbalanced braces
// — which fails extraction entirely. Retrying once with a larger budget and a
// "don't truncate" hint recovers most of those without the caller needing to
// care about budgets.

import type { z } from 'zod'
import { complete, type CompleteOptions } from '@/modules/llm/client'
import { extractJSON, type ExtractJSONResult } from '@/modules/llm/extract-json'

export type CompleteJSONResult<T> = {
  extracted: ExtractJSONResult<T>
  /** finishReason of the last attempt — 'length' means the token cap truncated it. */
  finishReason: string
  /** Raw text of the last attempt, for diagnostics on failure. */
  rawText: string
  /** Model that answered the last attempt. */
  model: string
  /** Provider of the last attempt (with `model`, prices the call). */
  provider?: string
  /** Token usage of ALL attempts of this call, summed (a cut-off retry is a second call). */
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number | null; cacheWriteTokens: number | null }
}

export async function completeJSON<T>(
  profileId: string,
  prompt: string,
  schema: z.ZodType<T>,
  opts: CompleteOptions & {
    retryMaxOutputTokens?: number
    /**
     * Epoch ms both attempts must finish by. Each call's timeout is capped at
     * the time left, and the retry is skipped with less than
     * `minRetryMs` (default 30s) left.
     */
    deadline?: number
    minRetryMs?: number
  },
): Promise<CompleteJSONResult<T>> {
  const { retryMaxOutputTokens, deadline, minRetryMs = 30_000, ...callOpts } = opts
  const budget = callOpts.maxOutputTokens ?? 8000
  const retryBudget = retryMaxOutputTokens ?? 16000
  const timeLeft = () => (deadline === undefined ? Infinity : deadline - Date.now())
  const timeoutFor = () => {
    const left = timeLeft()
    if (left === Infinity) return callOpts.timeoutMs
    return Math.max(1_000, Math.min(callOpts.timeoutMs ?? left, left))
  }

  const call = (maxOutputTokens: number, retryHint: boolean) =>
    complete(profileId, retryHint ? `${prompt}\n\n== NOTE ==\nYour previous response was cut off before the JSON document was complete. Output the COMPLETE JSON document this time, in one \`\`\`json code block, with nothing truncated.` : prompt, {
      ...callOpts,
      maxOutputTokens,
      timeoutMs: timeoutFor(),
    })

  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: null as number | null, cacheWriteTokens: null as number | null }
  const add = (r: Awaited<ReturnType<typeof call>>) => {
    usage.inputTokens += r.usage?.inputTokens ?? 0
    usage.outputTokens += r.usage?.outputTokens ?? 0
    const cr = r.usage?.inputTokenDetails?.cacheReadTokens
    const cw = r.usage?.inputTokenDetails?.cacheWriteTokens
    if (cr !== undefined) usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + cr
    if (cw !== undefined) usage.cacheWriteTokens = (usage.cacheWriteTokens ?? 0) + cw
  }

  let result = await call(budget, false)
  add(result)
  let extracted = extractJSON(result.text, schema)

  if (!extracted.ok && result.finishReason === 'length' && timeLeft() >= minRetryMs) {
    result = await call(retryBudget, true)
    add(result)
    extracted = extractJSON(result.text, schema)
  }

  return { extracted, finishReason: result.finishReason, rawText: result.text, model: result.model, provider: result.provider, usage }
}
