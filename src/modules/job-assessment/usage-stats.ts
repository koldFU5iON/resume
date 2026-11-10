/**
 * Pure helpers for the admin "App-billed (Jev)" card: cost estimate and stage
 * timing presentation. No DB, no network. The aggregates themselves are SQL
 * (getJevAdminSummary in src/modules/llm/usage.ts).
 */

import { JEV_FAILED_FEATURE_SUFFIX } from '@/modules/jev/constants'

/**
 * TypeSafe list price for Jev: USD per million input tokens. Output tokens are
 * free. Used only for the admin cost estimate; update it when pricing changes.
 */
export const JEV_USD_PER_MILLION_INPUT_TOKENS = 0.042

/** Estimated app-billed cost in USD for a number of input tokens. Output tokens are free. */
export function estimateJevCostUsd(inputTokens: number): number {
  if (!Number.isFinite(inputTokens) || inputTokens <= 0) return 0
  return (inputTokens / 1_000_000) * JEV_USD_PER_MILLION_INPUT_TOKENS
}

/** "$0.0042", "$1.23"; four decimals under a dollar so tiny costs don't read as $0.00. */
export function formatUsd(usd: number): string {
  return usd < 1 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

/** Pipeline order of the stage keys in JobAssessment.stageTimings. */
export const STAGE_ORDER = ['verify', 'enrich', 'verifyRetry', 'facts', 'judge', 'combine'] as const

/** Sorts stage rows into pipeline order; unknown stages go last, alphabetically. */
export function orderStages<T extends { stage: string }>(rows: readonly T[]): T[] {
  const rank = (s: string) => {
    const i = (STAGE_ORDER as readonly string[]).indexOf(s)
    return i === -1 ? STAGE_ORDER.length : i
  }
  return [...rows].sort((a, b) => rank(a.stage) - rank(b.stage) || a.stage.localeCompare(b.stage))
}

/** "850 ms", "4.2 s", "1m 05s". */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${String(s).padStart(2, '0')}s`
}

/** Splits a usage feature tag into its base and whether it is a failed-call row. */
export function splitFailedFeature(feature: string, suffix: string = JEV_FAILED_FEATURE_SUFFIX): { base: string; failed: boolean } {
  return feature.endsWith(suffix)
    ? { base: feature.slice(0, -suffix.length), failed: true }
    : { base: feature, failed: false }
}
