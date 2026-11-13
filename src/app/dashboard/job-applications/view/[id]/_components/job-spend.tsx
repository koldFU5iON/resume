import Link from "next/link"
import { Coins } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { JobSpend } from "@/modules/llm/job-cost"
import { featureLabel } from "@/app/dashboard/settings/usage/_components/feature-labels"
import { formatRunCost } from "@/app/dashboard/job-applications/_components/deep-dive-view"

/**
 * Estimated AI spend on this job: every call attributed to it (deep dives,
 * assessments, CVs, letters, prep), totalled and broken down by feature.
 */
export function JobSpendCard({ spend }: { spend: JobSpend }) {
  const { yourKey, appBilled, byFeature } = spend
  if (yourKey.requests === 0 && appBilled.requests === 0) return null

  return (
    <Card>
      <CardContent className="flex flex-col gap-1.5 pt-3 pb-3">
        <div className="flex items-center gap-1.5">
          <Coins size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs font-medium">AI spend on this job</p>
        </div>
        <p className="text-sm font-medium tabular-nums">
          {yourKey.requests === 0
            ? '$0.00'
            : yourKey.estimatedCostUsd === 0 && yourKey.unpricedModels.length > 0
              ? 'Not priced'
              : formatRunCost(yourKey.estimatedCostUsd, yourKey.estimateComplete)}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          On your API key · {yourKey.requests} call{yourKey.requests === 1 ? '' : 's'}
          {appBilled.requests > 0 && <> · plus {appBilled.requests} app-paid assessment call{appBilled.requests === 1 ? '' : 's'}</>}
        </p>
        <details className="group text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">By feature</summary>
          <ul className="mt-1.5 space-y-1">
            {byFeature.map((f) => (
              <li key={`${f.appBilled}:${f.feature}`} className="flex justify-between gap-2">
                <span className="min-w-0 text-muted-foreground">
                  {featureLabel(f.feature)}
                  {f.appBilled && <span className="sr-only"> (paid by the app)</span>}
                  <span className="tabular-nums"> ×{f.requests}</span>
                </span>
                <span className="shrink-0 tabular-nums">
                  {f.estimatedCostUsd === 0 && !f.estimateComplete
                    ? '—'
                    : <>{f.estimatedCostUsd > 0 && f.estimatedCostUsd < 0.01 ? '<$0.01' : `$${f.estimatedCostUsd.toFixed(2)}`}{!f.estimateComplete && '+'}</>}
                </span>
              </li>
            ))}
          </ul>
          {yourKey.unpricedModels.length > 0 && (
            <p className="mt-2 text-muted-foreground">
              No list price yet for <span className="font-mono">{yourKey.unpricedModels.join(', ')}</span>.
            </p>
          )}
          <p className="mt-2 text-muted-foreground">
            Estimated from list prices; &ldquo;+&rdquo; means web searches or unknown usage aren&apos;t priced.{' '}
            <Link href="/dashboard/settings/usage" className="underline underline-offset-2 hover:text-foreground">All usage</Link>
          </p>
        </details>
      </CardContent>
    </Card>
  )
}
