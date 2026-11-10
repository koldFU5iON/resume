import type { JevAdminSummary } from '@/modules/llm/usage'
import { formatTokens } from '@/modules/llm/format'
import { formatMs, formatUsd, JEV_USD_PER_MILLION_INPUT_TOKENS } from '@/modules/job-assessment/usage-stats'

const STAGE_LABELS: Record<string, string> = {
  verify: 'Verify',
  enrich: 'Fetch details',
  verifyRetry: 'Verify (retry)',
  facts: 'Extract facts',
  judge: 'Judge',
  combine: 'Combine',
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Panel({ title, empty, children }: { title: string; empty?: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border">
      <p className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">{title}</p>
      {empty ? <p className="px-3 py-3 text-xs text-muted-foreground">No data this month.</p> : children}
    </div>
  )
}

const td = 'px-3 py-1.5 text-xs'
const tdNum = 'px-3 py-1.5 text-right tabular-nums text-xs text-muted-foreground'

export function JevAdmin({ stats }: { stats: JevAdminSummary }) {
  return (
    <div className="mt-8 space-y-4 border-t pt-6">
      <h2 className="text-sm font-semibold">App-billed (Jev) — this month</h2>
      <p className="text-xs text-muted-foreground">
        Early job assessment calls paid by the app. Cost is an estimate at ${JEV_USD_PER_MILLION_INPUT_TOKENS} per
        million input tokens; output is free.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile label="Calls (incl. failed)" value={stats.calls.toLocaleString()} />
        <Tile label="Failed calls" value={stats.failedCalls.toLocaleString()} />
        <Tile label="Input tokens" value={formatTokens(stats.inputTokens)} />
        <Tile label="Output tokens" value={formatTokens(stats.outputTokens)} />
        <Tile label="Estimated cost" value={formatUsd(stats.estimatedCostUsd)} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Panel title="Top users — assessment runs" empty={stats.topUsers.length === 0}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-[11px] text-muted-foreground">
                <th className="px-3 py-1 text-left font-normal">User</th>
                <th className="px-3 py-1 text-right font-normal">Total</th>
                <th className="px-3 py-1 text-right font-normal">Avg/active day</th>
                <th className="px-3 py-1 text-right font-normal">p95/day</th>
              </tr>
            </thead>
            <tbody>
              {stats.topUsers.map(u => (
                <tr key={u.profileId} className="border-b last:border-0">
                  <td className={td}>{u.name}</td>
                  <td className={tdNum}>{u.total.toLocaleString()}</td>
                  <td className={tdNum}>{u.avgPerActiveDay.toFixed(1)}</td>
                  <td className={tdNum}>{Math.round(u.p95PerDay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Process time" empty={stats.processTime.length === 0}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-[11px] text-muted-foreground">
                <th className="px-3 py-1 text-left font-normal">Outcome</th>
                <th className="px-3 py-1 text-right font-normal">Runs</th>
                <th className="px-3 py-1 text-right font-normal">p50</th>
                <th className="px-3 py-1 text-right font-normal">p95</th>
              </tr>
            </thead>
            <tbody>
              {stats.processTime.map(r => (
                <tr key={r.status} className="border-b last:border-0">
                  <td className={`${td} capitalize`}>{r.status}</td>
                  <td className={tdNum}>{r.runs.toLocaleString()}</td>
                  <td className={tdNum}>{formatMs(r.p50Ms)}</td>
                  <td className={tdNum}>{formatMs(r.p95Ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Average time per stage" empty={stats.stageTimes.length === 0}>
          <table className="w-full text-sm">
            <tbody>
              {stats.stageTimes.map(r => (
                <tr key={r.stage} className="border-b last:border-0">
                  <td className={td}>{STAGE_LABELS[r.stage] ?? r.stage}</td>
                  <td className={tdNum}>{formatMs(r.avgMs)}</td>
                  <td className={tdNum}>{r.runs.toLocaleString()} runs</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Runs by outcome" empty={stats.byStatus.length === 0}>
          <table className="w-full text-sm">
            <tbody>
              {stats.byStatus.map(r => (
                <tr key={r.status} className="border-b last:border-0">
                  <td className={td}>{r.status === 'never_started' ? 'Never started (superseded or expired)' : <span className="capitalize">{r.status}</span>}</td>
                  <td className={tdNum}>{r.count.toLocaleString()}</td>
                </tr>
              ))}
              {stats.byLevel.length > 0 && (
                <tr className="border-b bg-muted/40">
                  <td colSpan={2} className="px-3 py-1 text-[11px] text-muted-foreground">Complete runs by level</td>
                </tr>
              )}
              {stats.byLevel.map(r => (
                <tr key={r.level} className="border-b last:border-0">
                  <td className={`${td} capitalize`}>{r.level}</td>
                  <td className={tdNum}>{r.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  )
}
