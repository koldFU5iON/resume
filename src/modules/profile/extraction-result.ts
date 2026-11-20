import type { Result } from './result'

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Missing draft details do not erase a compatible accepted or locally parsed result. */
export function mergeExtractionResult(existing: Result | null, proposed: Result | null): Result | null {
  if (!proposed) return existing
  if (!existing || !same(existing.measure, proposed.measure) || !same(existing.value, proposed.value)) return proposed
  return { ...proposed, baseline: proposed.baseline ?? existing.baseline, period: proposed.period ?? existing.period }
}

export function extractionResultsConflict(existing: Result | null, proposed: Result | null): boolean {
  return Boolean(existing && proposed && (
    !same(existing.measure, proposed.measure) || !same(existing.value, proposed.value) ||
    (existing.baseline && proposed.baseline && !same(existing.baseline, proposed.baseline)) ||
    (existing.period && proposed.period && !same(existing.period, proposed.period))
  ))
}
