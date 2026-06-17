'use client'

import type { UserUsageSummary } from '@/modules/llm/usage'
import { formatDate } from '@/lib/utils'
import { formatTokens } from '@/modules/llm/format'
import { Bar, BarChart, XAxis, YAxis, CartesianGrid, Cell } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

const FEATURE_LABELS: Record<string, string> = {
  'job-fit': 'Job fit',
  'job-extract': 'Job extract',
  'cv-import': 'CV import',
  'profile-summary': 'Profile summary',
  'profile-extract': 'Profile extract',
  'cv-job-analysis': 'Job analysis',
  'cv-evidence-score': 'Evidence scoring',
  'cv-recruiter-scan': 'Recruiter scan',
  'cv-generate': 'CV generation',
  'cover-letter-analyse':      'Cover letter — analyse role',
  'cover-letter-architect':    'Cover letter — build message',
  'cover-letter-draft':        'Cover letter — write draft',
  'cover-letter-review-pass':  'Cover letter — review draft',
  'cover-letter-finalise':     'Cover letter — finalise',
  'cover-letter-build': 'Cover letter — build with me',
  'cover-letter-review': 'Cover letter — review',
  'interview-prep-doc-analysis':         'Interview prep — analyse document',
  'interview-prep-interviewer-analysis': 'Interview prep — analyse interviewer',
  'interview-prep-bulk-analysis':        'Interview prep — analyse all documents',
  'interview-prep-qa-generation':        'Interview prep — generate Q&A',
  'ats-keyword-expand':                   'ATS — keyword expansion',
  'ats-interpret':                        'ATS — interpretation',
  'ats-context':                          'ATS — keyword context',
  'job-hunt-ats-discovery':              'Job hunt — ATS discovery',
  'job-hunt-fit':                        'Job hunt — fit score',
  'chat-turn':      'Chat — career coach',
  'chat-summarize': 'Chat — session summary',
}

function shortMonth(yyyyMm: string): string {
  const [year, month] = yyyyMm.split('-')
  const d = new Date(Number(year), Number(month) - 1, 1)
  return d.toLocaleString('default', { month: 'short', year: '2-digit' })
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
    feature: FEATURE_LABELS[r.feature] ?? r.feature,
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
                      {log.feature ? (FEATURE_LABELS[log.feature] ?? log.feature) : '—'}
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
