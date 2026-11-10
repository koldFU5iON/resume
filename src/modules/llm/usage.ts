import { prisma } from '@/lib/db'
import { JEV_FAILED_FEATURE_SUFFIX, JEV_PROVIDER } from '@/modules/jev/client'

/**
 * The user's own-key usage (BYOK) plus a count of app-billed calls. Jev
 * (provider 'typesafe') is paid by the app, so it is left out of every
 * token total, chart and log row here and only counted in `appBilled`.
 */
export type UserUsageSummary = {
  today: number
  thisMonth: number
  allTime: number
  totalCalls: number
  byMonth: { month: string; tokens: number }[]
  byFeature: { feature: string; tokens: number; calls: number }[]
  recentLogs: {
    id: string
    provider: string
    model: string
    feature: string | null
    promptTokens: number
    completionTokens: number
    totalTokens: number
    latencyMs: number
    createdAt: Date
  }[]
  /** Successful app-billed calls (early job assessment via Jev); not charged to the user's key. */
  appBilled: {
    thisMonthCalls: number
    allTimeCalls: number
  }
}

export type AdminUsageSummary = {
  thisMonthTokens: number
  thisMonthCalls: number
  byFeature: { feature: string | null; totalTokens: number; calls: number }[]
  byProvider: { provider: string; totalTokens: number; calls: number }[]
}

function startOfToday(): Date {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function startOfMonth(): Date {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export async function getUserUsageSummary(profileId: string): Promise<UserUsageSummary> {
  // Own-key rows only: app-billed providers are counted separately below.
  const ownKey = { profileId, provider: { not: JEV_PROVIDER } }
  // Successful app-billed calls only: failed Jev calls keep a zero-token row
  // (feature '<feature>:failed') that counts towards the daily cap but isn't
  // an assessment the user received.
  const appBilled = { profileId, provider: JEV_PROVIDER, NOT: { feature: { endsWith: JEV_FAILED_FEATURE_SUFFIX } } }

  const [today, thisMonth, allTime, byMonthRaw, byFeatureRaw, recentLogs, appBilledMonth, appBilledAll] = await Promise.all([
    prisma.llmUsageLog.aggregate({
      where: { ...ownKey, createdAt: { gte: startOfToday() } },
      _sum: { totalTokens: true },
    }),
    prisma.llmUsageLog.aggregate({
      where: { ...ownKey, createdAt: { gte: startOfMonth() } },
      _sum: { totalTokens: true },
    }),
    prisma.llmUsageLog.aggregate({
      where: ownKey,
      _sum: { totalTokens: true },
      _count: { id: true },
    }),
    prisma.$queryRaw<{ month: string; tokens: bigint }[]>`
      SELECT
        TO_CHAR(DATE_TRUNC('month', "createdAt"), 'YYYY-MM') AS month,
        SUM("totalTokens") AS tokens
      FROM "LlmUsageLog"
      WHERE "profileId" = ${profileId}
        AND "provider" <> ${JEV_PROVIDER}
        AND "createdAt" >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
      GROUP BY DATE_TRUNC('month', "createdAt")
      ORDER BY month ASC
    `,
    prisma.llmUsageLog.groupBy({
      by: ['feature'],
      where: ownKey,
      _sum: { totalTokens: true },
      _count: { id: true },
      orderBy: { _sum: { totalTokens: 'desc' } },
      take: 10,
    }),
    prisma.llmUsageLog.findMany({
      where: ownKey,
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true, provider: true, model: true, feature: true,
        promptTokens: true, completionTokens: true, totalTokens: true,
        latencyMs: true, createdAt: true,
      },
    }),
    prisma.llmUsageLog.count({ where: { ...appBilled, createdAt: { gte: startOfMonth() } } }),
    prisma.llmUsageLog.count({ where: appBilled }),
  ])

  return {
    today: today._sum.totalTokens ?? 0,
    thisMonth: thisMonth._sum.totalTokens ?? 0,
    allTime: allTime._sum.totalTokens ?? 0,
    totalCalls: allTime._count.id,
    byMonth: byMonthRaw.map(r => ({ month: r.month, tokens: Number(r.tokens) })),
    byFeature: byFeatureRaw.map(r => ({
      feature: r.feature ?? 'unknown',
      tokens: r._sum.totalTokens ?? 0,
      calls: r._count.id,
    })),
    recentLogs,
    appBilled: { thisMonthCalls: appBilledMonth, allTimeCalls: appBilledAll },
  }
}

export async function getAdminUsageSummary(): Promise<AdminUsageSummary> {
  const [monthly, byFeature, byProvider] = await Promise.all([
    prisma.llmUsageLog.aggregate({
      where: { createdAt: { gte: startOfMonth() } },
      _sum: { totalTokens: true },
      _count: { id: true },
    }),
    prisma.llmUsageLog.groupBy({
      by: ['feature'],
      _sum: { totalTokens: true },
      _count: { id: true },
      orderBy: { _sum: { totalTokens: 'desc' } },
    }),
    prisma.llmUsageLog.groupBy({
      by: ['provider'],
      _sum: { totalTokens: true },
      _count: { id: true },
      orderBy: { _sum: { totalTokens: 'desc' } },
    }),
  ])

  return {
    thisMonthTokens: monthly._sum.totalTokens ?? 0,
    thisMonthCalls: monthly._count.id,
    byFeature: byFeature.map(r => ({
      feature: r.feature,
      totalTokens: r._sum.totalTokens ?? 0,
      calls: r._count.id,
    })),
    byProvider: byProvider.map(r => ({
      provider: r.provider,
      totalTokens: r._sum.totalTokens ?? 0,
      calls: r._count.id,
    })),
  }
}
