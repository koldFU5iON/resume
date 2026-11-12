import Link from "next/link"
import { notFound } from "next/navigation"
import { Check, Circle, CircleAlert, Info, Loader2, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { requireProfile } from "@/lib/session"
import { JobContextNav } from "@/components/job-context-nav"
import { getJobAssets } from "@/modules/jobs/queries"
import { getDeepDiveAccess, type DeepDiveAccess } from "@/modules/deep-dive/access"
import { getDeepDive, listDeepDiveRuns, type DeepDiveRunItem, type DeepDiveView } from "@/modules/deep-dive/queries"
import { RESEARCHERS } from "@/modules/deep-dive/schema"
import { AssessmentPoller } from "@/app/dashboard/job-applications/_components/assessment-poller"
import { VerdictChip } from "@/app/dashboard/job-applications/_components/deep-dive-button"
import {
  DEEP_DIVE_STAGES,
  DEEP_DIVE_STATUS_LABEL,
  deepDiveHref,
  deepDiveSignature,
  formatRunCost,
  isDeepDiveActive,
  researchNote,
  stageIndex,
} from "@/app/dashboard/job-applications/_components/deep-dive-view"
import { DeepDiveReportView, REPORT_SECTIONS, presentSections } from "./_components/report"
import { Elapsed, LocalDateTime, RunAgainButton } from "./_components/run-controls"

// Run again starts a deep dive, which runs in after() within this limit; keep
// in sync with DEEP_DIVE_ROUTE_MAX_DURATION_S in src/modules/deep-dive/schema.ts.
export const maxDuration = 300

export default async function DeepDivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ run?: string | string[] }>
}) {
  const [{ id }, { run }, { profile }] = await Promise.all([params, searchParams, requireProfile()])
  const [assets, runs, access] = await Promise.all([
    getJobAssets(id, profile.id),
    listDeepDiveRuns(profile.id, id),
    getDeepDiveAccess(profile.id),
  ])
  if (!assets) notFound()

  const requested = typeof run === 'string' && runs.some((r) => r.id === run) ? run : null
  const view = runs.length > 0 ? await getDeepDive(profile.id, id, requested) : null
  const latest = runs[0] ?? null
  const latestActive = !!latest && isDeepDiveActive(latest.status)

  return (
    <div>
      <JobContextNav
        jobId={assets.jobId}
        company={assets.company}
        title={assets.title}
        cvDocumentId={assets.cvDocumentId}
        coverLetterDocumentId={assets.coverLetterDocumentId}
        interviewPrepSessionId={assets.interviewPrepSessionId}
        current="deep-dive"
      />
      <AssessmentPoller signature={deepDiveSignature(latest)} />

      <div>
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-14 lg:py-10">
          <main className="min-w-0">
            <p className="mb-6 text-sm text-muted-foreground">
              Deep dive · <span className="text-foreground">{assets.title}</span>
              {assets.company && <> at <span className="text-foreground">{assets.company}</span></>}
            </p>
            {!view ? (
              <EmptyState jobId={id} access={access} />
            ) : (
              <RunBody jobId={id} view={view} latest={latest} runs={runs} access={access} />
            )}
          </main>

          {view && (
            <aside className="lg:sticky lg:top-10 lg:self-start">
              <RunPanel jobId={id} view={view} runs={runs} latestActive={latestActive} access={access} />
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Body ────────────────────────────────────────────────────────────────────

function RunBody({ jobId, view, latest, runs, access }: {
  jobId: string
  view: DeepDiveView
  latest: DeepDiveRunItem | null
  runs: DeepDiveRunItem[]
  access: DeepDiveAccess
}) {
  const isLatest = latest?.id === view.id

  if (isDeepDiveActive(view.status)) return <Progress view={view} />

  if (view.status === 'failed') {
    const lastReport = runs.find((r) => r.status === 'complete')
    return (
      <div className="max-w-[68ch] space-y-4">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-[-0.02em]">
          <TriangleAlert className="size-5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
          This deep dive didn&apos;t finish
        </h1>
        <p className="leading-relaxed">{view.failureMessage ?? 'The deep dive failed. Try again.'}</p>
        {view.failureKind === 'no_llm_key' && (
          <Link href="/dashboard/settings/llm" className="inline-block text-sm underline underline-offset-2 hover:text-foreground">
            Add an LLM API key
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          {isLatest && <RunAgainButton jobId={jobId} disabled={!access.configured} />}
          {lastReport && (
            <Link href={deepDiveHref(jobId, lastReport.id)} className="text-sm underline underline-offset-2 hover:text-foreground">
              Read the last complete report
            </Link>
          )}
        </div>
      </div>
    )
  }

  if (!view.report) {
    return <p className="text-muted-foreground">This report can&apos;t be read. Run the deep dive again.</p>
  }

  const missing = view.research
    ? RESEARCHERS.filter((r) => !['ok', 'cached'].includes(view.research!.researchers[r].status))
    : []
  const allSkipped = missing.length === RESEARCHERS.length

  return (
    <>
      <div className="mb-8 space-y-3 empty:hidden">
        {!isLatest && latest && (
          <Notice icon={<Info className="size-4" aria-hidden="true" />}>
            You&apos;re reading an earlier run.{' '}
            <Link href={deepDiveHref(jobId)} className="underline underline-offset-2 hover:text-foreground">
              Go to the latest
            </Link>
          </Notice>
        )}
        {isLatest && view.outOfDate && (
          <Notice
            tone="warning"
            icon={<CircleAlert className="size-4" aria-hidden="true" />}
            action={<RunAgainButton jobId={jobId} disabled={!access.configured} />}
          >
            <span className="font-medium text-foreground">Out of date.</span> Your profile, search profile, the job or its early
            assessment changed since this report was written.
          </Notice>
        )}
        {allSkipped ? (
          <Notice icon={<Info className="size-4" aria-hidden="true" />}>
            No web research in this run: the report is built from the job ad, your profile, the early assessment and the sponsor register.
          </Notice>
        ) : missing.length > 0 ? (
          <Notice icon={<Info className="size-4" aria-hidden="true" />}>
            {missing.map((m) => m[0].toUpperCase() + m.slice(1)).join(' and ')} research didn&apos;t complete, so the report lists what it couldn&apos;t settle under Unknowns.
          </Notice>
        ) : null}
        {access.research === 'untested' && !allSkipped && (
          <Notice icon={<Info className="size-4" aria-hidden="true" />}>{researchNote(access)}</Notice>
        )}
      </div>
      <DeepDiveReportView report={view.report} research={view.research} />
    </>
  )
}

function Notice({ children, icon, action, tone = 'neutral' }: {
  children: React.ReactNode
  icon: React.ReactNode
  action?: React.ReactNode
  tone?: 'neutral' | 'warning'
}) {
  return (
    <div className={cn(
      "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 text-sm",
      tone === 'warning' ? "border-amber-500/30 bg-amber-500/10" : "bg-muted/40",
    )}>
      <p className={cn("flex min-w-0 flex-1 items-start gap-2 leading-relaxed text-muted-foreground", tone === 'warning' && "[&>svg]:text-amber-700 dark:[&>svg]:text-amber-400")}>
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span className="basis-[60ch]">{children}</span>
      </p>
      {action}
    </div>
  )
}

function EmptyState({ jobId, access }: { jobId: string; access: DeepDiveAccess }) {
  const note = researchNote(access)
  return (
    <div className="max-w-[68ch]">
      <h1 className="text-3xl font-semibold tracking-[-0.02em]">Should you go for this one?</h1>
      <p className="mt-3 leading-relaxed text-muted-foreground">
        A deep dive researches the company, the pay and the practicalities, then weighs all of it against your profile:
        a verdict, the blockers and gaps, a pay ask, sponsorship, and how to pitch your CV. Every claim cites its source.
      </p>
      <ol className="mt-8 space-y-4 border-t pt-6">
        {DEEP_DIVE_STAGES.map((s, i) => (
          <li key={s.status} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
            <span className="font-mono text-sm tabular-nums text-muted-foreground">{i + 1}</span>
            <div>
              <p className="font-medium">{s.label}</p>
              <p className="text-sm text-muted-foreground">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-8 space-y-2">
        {access.configured ? (
          <RunAgainButton jobId={jobId} label="Start the deep dive" variant="default" />
        ) : (
          <p className="text-sm">
            Deep dives run on your own LLM key.{' '}
            <Link href="/dashboard/settings/llm" className="underline underline-offset-2">Add a key in Settings</Link>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          About 2 minutes, billed to your own API key
          {access.research === 'tested'
            ? ': roughly $0.70–0.85 with the recommended Anthropic models, plus web searches.'
            : '. Each run shows its cost when it finishes.'}
        </p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
    </div>
  )
}

function Progress({ view }: { view: DeepDiveView }) {
  const current = stageIndex(view.status)
  return (
    <div className="max-w-[68ch]" aria-live="polite">
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">{DEEP_DIVE_STATUS_LABEL[view.status]}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Usually 1½ to 3 minutes. You can leave this page; the deep dive keeps going.
        {' '}<span className="text-foreground"><Elapsed since={(view.startedAt ?? view.createdAt).toISOString()} /></span>
      </p>
      <ol className="mt-8 space-y-5">
        {DEEP_DIVE_STAGES.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'active' : 'waiting'
          return (
            <li key={s.status} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3">
              <span className="mt-0.5">
                {state === 'done' && <Check className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />}
                {state === 'active' && <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />}
                {state === 'waiting' && <Circle className="size-4 text-muted-foreground/50" aria-hidden="true" />}
              </span>
              <div>
                <p className={cn("font-medium", state === 'waiting' && "text-muted-foreground")}>
                  {s.label}
                  <span className="sr-only">{state === 'done' ? ' (done)' : state === 'active' ? ' (in progress)' : ''}</span>
                </p>
                <p className="text-sm text-muted-foreground">{s.detail}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ── Side panel ──────────────────────────────────────────────────────────────

function RunPanel({ jobId, view, runs, latestActive, access }: {
  jobId: string
  view: DeepDiveView
  runs: DeepDiveRunItem[]
  latestActive: boolean
  access: DeepDiveAccess
}) {
  const sections = view.report ? presentSections(view.report, view.research) : []
  const usage = view.usage
  const models = [...new Set([view.researchModel, view.synthesisModel].filter((m): m is string => !!m))]

  return (
    <div className="space-y-8 text-sm">
      <div className="space-y-3">
        <dl className="space-y-2.5">
          <PanelFact label="Run">
            <LocalDateTime iso={view.createdAt.toISOString()} />
          </PanelFact>
          <PanelFact label="Cost (estimate)">
            {usage.requests === 0
              ? '—'
              : <span className="tabular-nums">{formatRunCost(usage.estimatedCostUsd, usage.estimateComplete)}</span>}
            {usage.serverToolCalls ? (
              <span className="block text-xs text-muted-foreground tabular-nums">{usage.serverToolCalls} web searches and fetches</span>
            ) : null}
          </PanelFact>
          {models.length > 0 && (
            <PanelFact label="Models">
              {models.map((m) => <span key={m} className="block truncate font-mono text-xs" title={m}>{m}</span>)}
            </PanelFact>
          )}
        </dl>
        {/* A failed run offers Run again in the body already. */}
        {view.status !== 'failed' && <RunAgainButton jobId={jobId} disabled={latestActive || !access.configured} />}
        {latestActive && <p className="text-xs text-muted-foreground">A run is in progress.</p>}
        {!access.configured && (
          <p className="text-xs text-muted-foreground">
            <Link href="/dashboard/settings/llm" className="underline underline-offset-2">Add an LLM key</Link> to run again.
          </p>
        )}
      </div>

      {sections.length > 0 && (
        <nav aria-label="Report sections" className="hidden lg:block">
          <p className="mb-2 text-xs text-muted-foreground">Contents</p>
          <ul className="space-y-1">
            {REPORT_SECTIONS.filter((s) => sections.includes(s.id)).map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-muted-foreground hover:text-foreground">{s.label}</a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {runs.length > 1 && (
        <nav aria-label="Runs">
          <p className="mb-2 text-xs text-muted-foreground">Runs</p>
          <ul className="-mx-2 max-h-72 space-y-0.5 overflow-y-auto">
            {runs.map((r, i) => {
              const current = r.id === view.id
              return (
                <li key={r.id}>
                  <Link
                    href={i === 0 ? deepDiveHref(jobId) : deepDiveHref(jobId, r.id)}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted",
                      current && "bg-muted",
                    )}
                  >
                    <span className={cn("text-xs", current ? "text-foreground" : "text-muted-foreground")}>
                      <LocalDateTime iso={r.createdAt.toISOString()} />
                    </span>
                    {r.verdict && r.status === 'complete'
                      ? <VerdictChip verdict={r.verdict} />
                      : <span className="text-xs text-muted-foreground">{DEEP_DIVE_STATUS_LABEL[r.status]}</span>}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      )}
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
