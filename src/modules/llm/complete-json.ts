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
}

export async function completeJSON<T>(
  profileId: string,
  prompt: string,
  schema: z.ZodType<T>,
  opts: CompleteOptions & { retryMaxOutputTokens?: number },
): Promise<CompleteJSONResult<T>> {
  const budget = opts.maxOutputTokens ?? 8000
  const retryBudget = opts.retryMaxOutputTokens ?? 16000

  const call = (maxOutputTokens: number, retryHint: boolean) =>
    complete(profileId, retryHint ? `${prompt}\n\n== NOTE ==\nYour previous response was cut off before the JSON document was complete. Output the COMPLETE JSON document this time, in one \`\`\`json code block, with nothing truncated.` : prompt, {
      ...opts,
      maxOutputTokens,
    })

  let result = await call(budget, false)
  let extracted = extractJSON(result.text, schema)

  if (!extracted.ok && result.finishReason === 'length') {
    result = await call(retryBudget, true)
    extracted = extractJSON(result.text, schema)
  }

  return { extracted, finishReason: result.finishReason, rawText: result.text }
}
