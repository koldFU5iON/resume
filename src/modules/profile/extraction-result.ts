import type { Result } from './result'

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const sameFigure = (a: string, b: string) => a.trim().replace(/\s+/g, ' ') === b.trim().replace(/\s+/g, ' ')

/** Missing draft details do not erase a compatible accepted or locally parsed result. */
export function mergeExtractionResult(existing: Result | null, proposed: Result | null): Result | null {
  if (!proposed) return existing
  if (!existing || !sameFigure(existing.measure, proposed.measure) || !sameFigure(existing.value, proposed.value)) return proposed
  return { ...proposed, baseline: proposed.baseline ?? existing.baseline, period: proposed.period ?? existing.period }
}

export function extractionResultsConflict(existing: Result | null, proposed: Result | null): boolean {
  return Boolean(existing && proposed && (
    !sameFigure(existing.measure, proposed.measure) || !sameFigure(existing.value, proposed.value) ||
    (existing.baseline && proposed.baseline && !sameFigure(existing.baseline, proposed.baseline)) ||
    (existing.period && proposed.period && !same(existing.period, proposed.period))
  ))
}
