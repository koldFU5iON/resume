import { LocalDateTime } from "../../deep-dive/_components/run-controls"
import {
  CV_GENERATION_STATUS_LABEL,
  formatRunCost,
  formatTokens,
  isCvGenerationActive,
  runLogMarkdown,
} from "@/app/dashboard/job-applications/_components/cv-generation-view"
import type { CvGenerationView } from "@/modules/cv-generation/queries"
import { CopyLogButton } from "./copy-log-button"
import { GenerateCvButton } from "./generate-cv-button"

/** The right-hand column: the run's facts, then the controls (generate again, copy log) so they are reachable without scrolling. */
export function RunPanel({ view, jobId, jobTitle, company }: { view: CvGenerationView; jobId: string; jobTitle: string; company: string | null }) {
  const total = view.usage.total
  // The whole run as Markdown for the Copy log button (the CV in it keeps the {{contact}} placeholder; no contact details are read).
  const logText = runLogMarkdown({ jobTitle, company, run: view })
  return (
    <div className="space-y-5">
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-4 lg:grid-cols-1">
      <PanelFact label="Run">
        <LocalDateTime iso={view.createdAt.toISOString()} />
      </PanelFact>
      <PanelFact label="Status">{CV_GENERATION_STATUS_LABEL[view.status]}</PanelFact>
      <PanelFact label="Cost (estimate)">
        {total.requests === 0
          ? "—"
          : <span className="tabular-nums">{formatRunCost(total.estimatedCostUsd, total.estimateComplete)}</span>}
      </PanelFact>
      {total.requests > 0 && (
        <PanelFact label="Calls">
          <span className="tabular-nums">{total.requests}</span>
          <span className="block text-xs tabular-nums text-muted-foreground">
            {formatTokens(total.inputTokens)} in · {formatTokens(total.outputTokens)} out
          </span>
          {total.failedRequests > 0 && (
            <span className="block text-xs text-muted-foreground">{total.failedRequests} failed</span>
          )}
        </PanelFact>
      )}
    </dl>
    <div className="flex flex-col items-start gap-2" aria-label="Generate and copy">
      {!isCvGenerationActive(view.status) && (
        <>
          <GenerateCvButton jobId={jobId} label="Generate again" />
          <GenerateCvButton jobId={jobId} label="Generate again with a fresh brief and selection" fresh className="h-auto whitespace-normal py-1.5 text-left" />
        </>
      )}
      <CopyLogButton text={logText} />
    </div>
    </div>
  )
}

function PanelFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}
