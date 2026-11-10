import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }))

vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: queryRaw } }))

import { getJevAdminSummary } from './usage'

/** Results in the order getJevAdminSummary issues its queries. */
function mockResults(r: {
  calls?: unknown[]; topUsers?: unknown[]; processTime?: unknown[]; stageTimes?: unknown[]; byStatus?: unknown[]; byLevel?: unknown[]
}) {
  queryRaw
    .mockResolvedValueOnce(r.calls ?? [{ calls: 0, failed: 0, input: BigInt(0), output: BigInt(0) }])
    .mockResolvedValueOnce(r.topUsers ?? [])
    .mockResolvedValueOnce(r.processTime ?? [])
    .mockResolvedValueOnce(r.stageTimes ?? [])
    .mockResolvedValueOnce(r.byStatus ?? [])
    .mockResolvedValueOnce(r.byLevel ?? [])
}

describe('getJevAdminSummary', () => {
  beforeEach(() => queryRaw.mockReset())

  it('returns zeros and empty lists for an empty month', async () => {
    mockResults({ calls: [] })
    const s = await getJevAdminSummary()
    expect(s).toEqual({
      calls: 0, failedCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0,
      topUsers: [], processTime: [], stageTimes: [], byStatus: [], byLevel: [],
    })
  })

  it('maps BigInt token sums to numbers and estimates cost from input tokens only', async () => {
    mockResults({ calls: [{ calls: 12, failed: 2, input: BigInt(2_000_000), output: BigInt(500_000) }] })
    const s = await getJevAdminSummary()
    expect(s.calls).toBe(12)
    expect(s.failedCalls).toBe(2)
    expect(s.inputTokens).toBe(2_000_000)
    expect(s.outputTokens).toBe(500_000)
    expect(s.estimatedCostUsd).toBeCloseTo(0.084)
  })

  it('keeps complete and failed process times, in a stable order, and drops other statuses', async () => {
    mockResults({
      processTime: [
        { status: 'failed', runs: 3, p50: 1000, p95: 4000 },
        { status: 'complete', runs: 9, p50: 5000, p95: 9000 },
        { status: 'assessing', runs: 1, p50: 1, p95: 1 },
      ],
    })
    const s = await getJevAdminSummary()
    expect(s.processTime).toEqual([
      { status: 'complete', runs: 9, p50Ms: 5000, p95Ms: 9000 },
      { status: 'failed', runs: 3, p50Ms: 1000, p95Ms: 4000 },
    ])
  })

  it('orders stages by pipeline order and renames the columns', async () => {
    mockResults({
      stageTimes: [
        { stage: 'judge', avg: 3000, runs: 4 },
        { stage: 'verify', avg: 1000, runs: 5 },
        { stage: 'facts', avg: 2000, runs: 4 },
      ],
    })
    const s = await getJevAdminSummary()
    expect(s.stageTimes.map((r) => r.stage)).toEqual(['verify', 'facts', 'judge'])
    expect(s.stageTimes[0]).toEqual({ stage: 'verify', avgMs: 1000, runs: 5 })
  })

  it('maps top users, falling back to a short id for a blank name', async () => {
    mockResults({
      topUsers: [
        { profileId: 'abcdefghijkl', name: ' Sam ', total: 20, avg: 5, p95: 9 },
        { profileId: 'zyxwvutsrqpo', name: '  ', total: 3, avg: 1.5, p95: 2 },
      ],
    })
    const s = await getJevAdminSummary()
    expect(s.topUsers).toEqual([
      { profileId: 'abcdefghijkl', name: 'Sam', total: 20, avgPerActiveDay: 5, p95PerDay: 9 },
      { profileId: 'zyxwvutsrqpo', name: 'zyxwvuts', total: 3, avgPerActiveDay: 1.5, p95PerDay: 2 },
    ])
  })

  it('passes outcome and level counts through', async () => {
    mockResults({
      byStatus: [{ status: 'complete', count: 7 }, { status: 'never_started', count: 2 }],
      byLevel: [{ level: 'pursue', count: 4 }],
    })
    const s = await getJevAdminSummary()
    expect(s.byStatus).toEqual([{ status: 'complete', count: 7 }, { status: 'never_started', count: 2 }])
    expect(s.byLevel).toEqual([{ level: 'pursue', count: 4 }])
  })
})
