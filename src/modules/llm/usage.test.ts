import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    llmUsageLog: { aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))

import { prisma } from '@/lib/db'
import { getUserUsageSummary } from './usage'

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
  it('excludes app-billed Jev rows from own-key totals, charts and the log', async () => {
    await getUserUsageSummary('p1')
    const ownKey = { profileId: 'p1', provider: { not: 'typesafe' } }
    for (const call of log.aggregate.mock.calls) {
      expect(call[0]!.where).toMatchObject(ownKey)
    }
    expect(log.groupBy.mock.calls[0][0]).toMatchObject({ where: ownKey })
    expect(log.findMany.mock.calls[0][0]).toMatchObject({ where: ownKey })
    const [sql, ...values] = vi.mocked(prisma.$queryRaw).mock.calls[0] as [TemplateStringsArray, ...unknown[]]
    expect(sql.join('?')).toContain('"provider" <> ?')
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
