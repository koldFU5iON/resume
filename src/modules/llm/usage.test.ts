import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    llmUsageLog: { aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))

import { prisma } from '@/lib/db'
import { getUserUsageSummary, summarizeByRole, type RoleModelGroup } from './usage'

const log = vi.mocked(prisma.llmUsageLog)

beforeEach(() => {
  vi.clearAllMocks()
  log.aggregate.mockResolvedValue({ _sum: { totalTokens: 1000 }, _count: { id: 4 } } as never)
  log.groupBy.mockResolvedValue([] as never)
  log.findMany.mockResolvedValue([])
  log.count.mockResolvedValueOnce(7).mockResolvedValueOnce(20)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([])
})

describe('getUserUsageSummary', () => {
  it('excludes app-billed Jev rows and failed calls from own-key totals, charts and the log', async () => {
    await getUserUsageSummary('p1')
    const ownKey = { profileId: 'p1', provider: { not: 'typesafe' }, status: 'ok' }
    for (const call of log.aggregate.mock.calls) {
      expect(call[0]!.where).toMatchObject(ownKey)
    }
    expect(log.groupBy.mock.calls[0][0]).toMatchObject({ where: ownKey })
    expect(log.findMany.mock.calls[0][0]).toMatchObject({ where: ownKey })
    const [sql, ...values] = vi.mocked(prisma.$queryRaw).mock.calls[0] as [TemplateStringsArray, ...unknown[]]
    expect(sql.join('?')).toContain('"provider" <> ?')
    expect(sql.join('?')).toContain(`"status" = 'ok'`)
    expect(values).toContain('typesafe')
  })

  it('counts app-billed calls separately', async () => {
    const res = await getUserUsageSummary('p1')
    expect(res.appBilled).toEqual({ thisMonthCalls: 7, allTimeCalls: 20 })
    const notFailed = { NOT: { feature: { endsWith: ':failed' } } }
    expect(log.count.mock.calls[0][0]).toMatchObject({ where: { profileId: 'p1', provider: 'typesafe', ...notFailed, createdAt: { gte: expect.any(Date) } } })
    expect(log.count.mock.calls[1][0]).toEqual({ where: { profileId: 'p1', provider: 'typesafe', ...notFailed } })
  })
})

describe('summarizeByRole', () => {
  const group = (role: string | null, provider: string, model: string, tokens: number, over: Partial<RoleModelGroup['_sum']> = {}): RoleModelGroup => ({
    role, provider, model, _count: { id: 2 },
    _sum: { promptTokens: tokens / 2, completionTokens: tokens / 2, totalTokens: tokens, cacheReadTokens: null, cacheWriteTokens: null, serverToolCalls: null, ...over },
  })

  it('folds models into one row per role, priced, most tokens first', () => {
    const rows = summarizeByRole([
      group('fast', 'anthropic', 'claude-haiku-5-5', 2_000_000),
      group('default', 'anthropic', 'claude-sonnet-5-5', 6_000_000),
      group('fast', 'anthropic', 'claude-sonnet-5-5', 2_000_000),
    ])
    expect(rows.map(r => r.role)).toEqual(['default', 'fast'])
    expect(rows[1]).toMatchObject({ tokens: 4_000_000, calls: 4, estimateComplete: true })
    // haiku: 1M in × 0.1 + 1M out × 0.5 = 0.6; sonnet: 1M × 2 + 1M × 10 = 12
    expect(rows[1].estimatedCostUsd).toBeCloseTo(12.6)
  })

  it('marks the estimate incomplete for unpriced models and server tool calls', () => {
    const [openai] = summarizeByRole([group('research', 'openai', 'gpt-5', 100)])
    expect(openai).toMatchObject({ estimateComplete: false, estimatedCostUsd: 0 })
    const [search] = summarizeByRole([group('research', 'anthropic', 'claude-sonnet-5-5', 100, { serverToolCalls: 3 })])
    expect(search.estimateComplete).toBe(false)
  })

  it('keeps pre-role rows under null', () => {
    expect(summarizeByRole([group(null, 'anthropic', 'claude-sonnet-5-5', 10)])[0].role).toBeNull()
  })
})
