import { describe, expect, it } from 'vitest'
import {
  averageStageTimings, estimateJevCostUsd, formatMs, formatUsd, orderStages, splitFailedFeature,
} from './usage-stats'

describe('estimateJevCostUsd', () => {
  it('prices input tokens at $0.042 per million', () => {
    expect(estimateJevCostUsd(1_000_000)).toBeCloseTo(0.042)
    expect(estimateJevCostUsd(500_000)).toBeCloseTo(0.021)
  })
  it('is zero for empty or invalid input', () => {
    expect(estimateJevCostUsd(0)).toBe(0)
    expect(estimateJevCostUsd(-5)).toBe(0)
    expect(estimateJevCostUsd(Number.NaN)).toBe(0)
  })
})

describe('averageStageTimings', () => {
  it('averages per stage in pipeline order and skips requeues', () => {
    const out = averageStageTimings([
      { judge: 4000, verify: 1000, requeues: 2 },
      { judge: 2000, verify: 3000 },
    ])
    expect(out).toEqual([
      { stage: 'verify', avgMs: 2000, runs: 2 },
      { stage: 'judge', avgMs: 3000, runs: 2 },
    ])
  })
  it('ignores non-numeric values, non-objects and empty input', () => {
    expect(averageStageTimings([])).toEqual([])
    expect(averageStageTimings([null, 'x', 5, [1, 2], { facts: 'slow', judge: null, verify: Number.NaN }])).toEqual([])
    expect(averageStageTimings([{ facts: 100 }, { facts: '9' }])).toEqual([{ stage: 'facts', avgMs: 100, runs: 1 }])
  })
})

describe('orderStages', () => {
  it('puts unknown stages last', () => {
    expect(orderStages([{ stage: 'zzz' }, { stage: 'judge' }, { stage: 'verify' }]).map((r) => r.stage))
      .toEqual(['verify', 'judge', 'zzz'])
  })
})

describe('formatting', () => {
  it('formats ms', () => {
    expect(formatMs(850)).toBe('850 ms')
    expect(formatMs(4200)).toBe('4.2 s')
    expect(formatMs(65_000)).toBe('1m 05s')
  })
  it('formats USD', () => {
    expect(formatUsd(0.0042)).toBe('$0.0042')
    expect(formatUsd(1.234)).toBe('$1.23')
  })
  it('splits failed feature tags', () => {
    expect(splitFailedFeature('job-assessment-judge:failed')).toEqual({ base: 'job-assessment-judge', failed: true })
    expect(splitFailedFeature('job-assessment-judge')).toEqual({ base: 'job-assessment-judge', failed: false })
  })
})
