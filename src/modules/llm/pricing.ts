// Estimated-cost rate card for usage reporting. These are ESTIMATES from list
// prices, never actual charges: BYOK calls are billed by the provider to the
// user's own account, and the app has no access to those invoices.
//
// Update RATES_AS_OF and the rows together when prices change. A model that
// isn't listed is reported as unpriced (the estimate is then incomplete),
// never guessed.

import { JEV_USD_PER_MILLION_INPUT_TOKENS } from '@/modules/job-assessment/usage-stats'

export const PRICING_CURRENCY = 'USD' as const
export const PRICING_RATES_AS_OF = '2026-11-03'
export const PRICING_SOURCE =
  'Anthropic first-party API list prices (standard tier, 5-minute cache writes at 1.25x input); TypeSafe list price for Jev'

/** USD per million tokens. cacheRead/cacheWrite null = not applicable or unknown. */
export type ModelRate = {
  input: number
  output: number
  cacheRead: number | null
  cacheWrite: number | null
  /** Caveat shown alongside the estimate. */
  note?: string
}

const RATES: Record<string, ModelRate> = {
  'anthropic/claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'anthropic/claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'anthropic/claude-haiku-5-5': {
    input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125,
    note: 'Rates for prompts up to 100K tokens; longer prompts cost 5x.',
  },
  // App-billed: output tokens are free.
  'typesafe/*': { input: JEV_USD_PER_MILLION_INPUT_TOKENS, output: 0, cacheRead: null, cacheWrite: null },
}

/**
 * The listed id a model is priced as: dated snapshots ("claude-sonnet-5-5-20261015")
 * and "-latest" aliases cost the same as their base model.
 */
export function pricedModelId(model: string): string {
  return model.trim().replace(/^models\//, '').replace(/-(?:\d{8}|latest)$/, '')
}

export function rateFor(provider: string, model: string): ModelRate | null {
  return RATES[`${provider}/${model}`] ?? RATES[`${provider}/${pricedModelId(model)}`] ?? RATES[`${provider}/*`] ?? null
}

export type CostInput = {
  provider: string
  model: string
  promptTokens: number
  completionTokens: number
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
}

/**
 * Estimated USD for one usage row, or null when the model is unpriced.
 * promptTokens is the provider's total input (AI SDK `inputTokens`, which
 * includes cache reads and writes), so those are split out and priced at
 * their own rates; unknown cache columns are priced as plain input.
 */
export function estimateRowCostUsd(row: CostInput): number | null {
  const rate = rateFor(row.provider, row.model)
  if (!rate) return null
  const cacheRead = rate.cacheRead !== null ? row.cacheReadTokens ?? 0 : 0
  const cacheWrite = rate.cacheWrite !== null ? row.cacheWriteTokens ?? 0 : 0
  const plainInput = Math.max(0, row.promptTokens - cacheRead - cacheWrite)
  return (
    plainInput * rate.input +
    row.completionTokens * rate.output +
    cacheRead * (rate.cacheRead ?? 0) +
    cacheWrite * (rate.cacheWrite ?? 0)
  ) / 1_000_000
}
