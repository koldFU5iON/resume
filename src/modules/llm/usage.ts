import { prisma } from '@/lib/db'
import { JEV_FAILED_FEATURE_SUFFIX, JEV_PROVIDER } from '@/modules/jev/client'
import { estimateJevCostUsd, orderStages } from '@/modules/job-assessment/usage-stats'

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

// ── App-billed (Jev) admin summary ──────────────────────────────────────────

export type JevAdminSummary = {
  calls: number
  failedCalls: number
  inputTokens: number
  outputTokens: number
  /** Estimated cost in USD (input tokens only; see JEV_USD_PER_MILLION_INPUT_TOKENS). */
  estimatedCostUsd: number
  /** Assessment runs per profile this month, busiest first (top 10). */
  topUsers: { profileId: string; name: string; total: number; avgPerActiveDay: number; p95PerDay: number }[]
  /** processTimeMs percentiles for finished runs, by outcome. */
  processTime: { status: 'complete' | 'failed'; runs: number; p50Ms: number; p95Ms: number }[]
  /** Average ms per stage (stageTimings, `requeues` excluded), pipeline order. */
  stageTimes: { stage: string; avgMs: number; runs: number }[]
  byStatus: { status: string; count: number }[]
  /** Complete runs by level. */
  byLevel: { level: string; count: number }[]
}

/**
 * This month's app-billed Jev usage and early-assessment run stats, all as SQL
 * aggregates. Calls are the `typesafe` usage rows; runs are JobAssessment rows.
 */
export async function getJevAdminSummary(): Promise<JevAdminSummary> {
  const since = startOfMonth()
  const failedLike = `%${JEV_FAILED_FEATURE_SUFFIX}`

  const [calls, topUsers, processTime, stageTimes, byStatus, byLevel] = await Promise.all([
    prisma.$queryRaw<{ calls: number; failed: number; input: bigint; output: bigint }[]>`
      SELECT COUNT(*)::int AS calls,
             (COUNT(*) FILTER (WHERE "feature" LIKE ${failedLike}))::int AS failed,
             COALESCE(SUM("promptTokens"), 0) AS input,
             COALESCE(SUM("completionTokens"), 0) AS output
      FROM "LlmUsageLog"
      WHERE "provider" = ${JEV_PROVIDER} AND "createdAt" >= ${since}
    `,
    prisma.$queryRaw<{ profileId: string; name: string | null; total: number; avg: number; p95: number }[]>`
      WITH daily AS (
        SELECT "profileId", DATE_TRUNC('day', "createdAt") AS day, COUNT(*)::int AS n
        FROM "JobAssessment"
        WHERE "createdAt" >= ${since}
        GROUP BY 1, 2
      )
      SELECT d."profileId" AS "profileId", p."name" AS name,
             SUM(d.n)::int AS total,
             AVG(d.n)::float8 AS avg,
             (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY d.n))::float8 AS p95
      FROM daily d
      JOIN "Profile" p ON p."id" = d."profileId"
      GROUP BY d."profileId", p."name"
      ORDER BY total DESC
      LIMIT 10
    `,
    prisma.$queryRaw<{ status: string; runs: number; p50: number; p95: number }[]>`
      SELECT "status", COUNT(*)::int AS runs,
             (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "processTimeMs"))::float8 AS p50,
             (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "processTimeMs"))::float8 AS p95
      FROM "JobAssessment"
      WHERE "createdAt" >= ${since} AND "status" IN ('complete', 'failed') AND "processTimeMs" IS NOT NULL
      GROUP BY "status"
    `,
    // Skips `requeues` (a count) and any non-numeric value; non-object JSON reads as empty.
    prisma.$queryRaw<{ stage: string; avg: number; runs: number }[]>`
      SELECT kv.key AS stage, AVG((kv.value)::float8)::float8 AS avg, COUNT(*)::int AS runs
      FROM "JobAssessment" a, JSONB_EACH(
        CASE WHEN JSONB_TYPEOF(a."stageTimings") = 'object' THEN a."stageTimings" ELSE '{}'::jsonb END
      ) AS kv
      WHERE a."createdAt" >= ${since}
        AND kv.key <> 'requeues'
        AND JSONB_TYPEOF(kv.value) = 'number'
      GROUP BY kv.key
    `,
    prisma.$queryRaw<{ status: string; count: number }[]>`
      SELECT "status", COUNT(*)::int AS count FROM "JobAssessment"
      WHERE "createdAt" >= ${since} GROUP BY "status" ORDER BY count DESC
    `,
    prisma.$queryRaw<{ level: string; count: number }[]>`
      SELECT "level", COUNT(*)::int AS count FROM "JobAssessment"
      WHERE "createdAt" >= ${since} AND "status" = 'complete' AND "level" IS NOT NULL
      GROUP BY "level" ORDER BY count DESC
    `,
  ])

  const c = calls[0]
  const inputTokens = Number(c?.input ?? 0)
  return {
    calls: c?.calls ?? 0,
    failedCalls: c?.failed ?? 0,
    inputTokens,
    outputTokens: Number(c?.output ?? 0),
    estimatedCostUsd: estimateJevCostUsd(inputTokens),
    topUsers: topUsers.map(r => ({
      profileId: r.profileId,
      name: r.name?.trim() || r.profileId.slice(0, 8),
      total: r.total,
      avgPerActiveDay: r.avg,
      p95PerDay: r.p95,
    })),
    processTime: processTime
      .filter((r): r is typeof r & { status: 'complete' | 'failed' } => r.status === 'complete' || r.status === 'failed')
      .map(r => ({ status: r.status, runs: r.runs, p50Ms: r.p50, p95Ms: r.p95 }))
      .sort((a, b) => a.status.localeCompare(b.status)),
    stageTimes: orderStages(stageTimes.map(r => ({ stage: r.stage, avgMs: r.avg, runs: r.runs }))),
    byStatus,
    byLevel,
  }
}
