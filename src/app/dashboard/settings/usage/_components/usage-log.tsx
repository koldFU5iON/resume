'use client'

import type { UserUsageSummary } from '@/modules/llm/usage'
import { formatDate } from '@/lib/utils'
import { formatTokens } from '@/modules/llm/format'
import { featureLabel } from './feature-labels'
import { isModelRole, ROLE_INFO } from '@/modules/llm/roles'
import { Bar, BarChart, XAxis, YAxis, CartesianGrid, Cell } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

function shortMonth(yyyyMm: string): string {
  const [year, month] = yyyyMm.split('-')
  const d = new Date(Number(year), Number(month) - 1, 1)
  return d.toLocaleString('default', { month: 'short', year: '2-digit' })
}

function roleLabel(role: string | null): string {
  if (role === null) return 'Not recorded (older calls)'
  return isModelRole(role) ? ROLE_INFO[role].label : role
}

function formatUsd(n: number): string {
  return n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`
}

const monthChartConfig = {
  tokens: { label: 'Tokens', color: 'hsl(var(--chart-1))' },
} satisfies ChartConfig

const featureChartConfig = {
  tokens: { label: 'Tokens', color: 'hsl(var(--chart-2))' },
} satisfies ChartConfig

export function UsageLog({ stats }: { stats: UserUsageSummary }) {
  const hasActivity = stats.recentLogs.length > 0

  const monthData = stats.byMonth.map(r => ({
    month: shortMonth(r.month),
    tokens: r.tokens,
  }))

  const featureData = stats.byFeature.map(r => ({
    feature: featureLabel(r.feature),
    tokens: r.tokens,
    calls: r.calls,
  }))

  return (
    <div className="space-y-6">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Today', value: formatTokens(stats.today) },
          { label: 'This month', value: formatTokens(stats.thisMonth) },
          { label: 'All time', value: formatTokens(stats.allTime) },
          { label: 'Total calls', value: stats.totalCalls.toLocaleString() },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border bg-card p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      {stats.appBilled.allTimeCalls > 0 && (
        <p className="text-xs text-muted-foreground">
          Included early assessments (not billed to your key):{' '}
          <span className="tabular-nums font-medium text-foreground">
            {stats.appBilled.thisMonthCalls.toLocaleString()}
          </span>{' '}
          {stats.appBilled.thisMonthCalls === 1 ? 'call' : 'calls'} this month
        </p>
      )}

      {!hasActivity ? (
        <p className="text-sm text-muted-foreground">No calls yet — use an AI feature to see usage here.</p>
      ) : (
        <>
          {/* Charts row */}
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Monthly tokens */}
            {monthData.length > 0 && (
              <div className="rounded-lg border bg-card p-4">
                <p className="mb-3 text-sm font-medium">Monthly tokens</p>
                <ChartContainer config={monthChartConfig} className="h-40 w-full">
                  <BarChart data={monthData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="month"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11 }}
                      className="fill-muted-foreground"
                    />
                    <YAxis hide />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value) => [formatTokens(Number(value)), 'tokens']}
                        />
                      }
                    />
                    <Bar dataKey="tokens" fill="var(--color-tokens)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </div>
            )}

            {/* Top features */}
            {featureData.length > 0 && (
              <div className="rounded-lg border bg-card p-4">
                <p className="mb-3 text-sm font-medium">Top features by tokens</p>
                <ChartContainer config={featureChartConfig} className="h-40 w-full">
                  <BarChart
                    data={featureData}
                    layout="vertical"
                    margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="feature"
                      tickLine={false}
                      axisLine={false}
                      width={130}
                      tick={{ fontSize: 10 }}
                      className="fill-muted-foreground"
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value, _name, item) => {
                            const d = item.payload as { feature: string; calls: number }
                            return [`${formatTokens(Number(value))} tokens · ${d.calls} calls`, d.feature]
                          }}
                        />
                      }
                    />
                    <Bar dataKey="tokens" fill="var(--color-tokens)" radius={[0, 3, 3, 0]}>
                      {featureData.map((_, i) => (
                        <Cell key={i} opacity={1 - i * 0.07} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
              </div>
            )}
          </div>

          {/* By task (model role) */}
          {stats.byRole.length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <p className="mb-1 text-sm font-medium">By task</p>
              <p className="mb-3 text-xs text-muted-foreground">
                Which kind of work your tokens went on. Costs are estimates from list prices, not your provider&apos;s bill.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="py-1.5 text-left font-medium">Task</th>
                    <th className="py-1.5 text-right font-medium">Calls</th>
                    <th className="py-1.5 text-right font-medium">Tokens</th>
                    <th className="py-1.5 text-right font-medium">Est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byRole.map(r => (
                    <tr key={r.role ?? 'none'} className="border-b last:border-0">
                      <td className="py-1.5 text-xs">{roleLabel(r.role)}</td>
                      <td className="py-1.5 text-right tabular-nums text-xs text-muted-foreground">
                        {r.calls.toLocaleString()}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-xs">{formatTokens(r.tokens)}</td>
                      <td
                        className="py-1.5 text-right tabular-nums text-xs text-muted-foreground"
                        title={r.estimateComplete ? undefined : 'Partial: some models have no known price, or web searches were billed per call'}
                      >
                        {r.estimateComplete
                          ? formatUsd(r.estimatedCostUsd)
                          : r.estimatedCostUsd === 0 && r.unpricedModels.length > 0
                            ? 'Not priced'
                            : `${formatUsd(r.estimatedCostUsd)}+`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <UnpricedNote models={stats.byRole.flatMap(r => r.unpricedModels)} />
            </div>
          )}

          {/* Log table */}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Feature</th>
                  <th className="px-3 py-2 text-left font-medium">Model</th>
                  <th className="px-3 py-2 text-right font-medium">In</th>
                  <th className="px-3 py-2 text-right font-medium">Out</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 text-right font-medium">ms</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentLogs.map(log => (
                  <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {formatDate(log.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {log.feature ? featureLabel(log.feature) : '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {log.provider}/{log.model}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                      {log.promptTokens.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                      {log.completionTokens.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs font-medium">
                      {log.totalTokens.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">
                      {log.latencyMs.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

/** Names the models the estimate leaves out, so "Not priced" and "+" are explained. */
function UnpricedNote({ models }: { models: string[] }) {
  const unpriced = [...new Set(models)].sort()
  if (unpriced.length === 0) return null
  return (
    <p className="mt-3 text-xs text-muted-foreground">
      No list price yet for{' '}
      {unpriced.map((m, i) => (
        <span key={m}>{i > 0 && ', '}<code className="font-mono">{m}</code></span>
      ))}
      , so those calls aren&apos;t in the estimate. A &ldquo;+&rdquo; means the real cost is higher.
    </p>
  )
}
