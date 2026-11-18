import Link from "next/link"
import { notFound } from "next/navigation"
import { Check, CircleAlert, Loader2, TriangleAlert } from "lucide-react"
import { requireProfile } from "@/lib/session"
import { getJobAssets } from "@/modules/jobs/queries"
import { getLatestCvGeneration, type CvGenerationView } from "@/modules/cv-generation/queries"
import { AssessmentPoller } from "@/app/dashboard/job-applications/_components/assessment-poller"
import {
  COMPLETE_HEADING,
  CV_GENERATION_STAGE_INFO,
  CV_GENERATION_STATUS_LABEL,
  buildStageRows,
  concernRows,
  draftHref,
  cvGenerationSignature,
  isCvGenerationActive,
  logSectionIds,
  previewCopy,
} from "@/app/dashboard/job-applications/_components/cv-generation-view"
import { CV_GENERATION_STAGES } from "@/modules/cv-generation/schema"
import { Elapsed } from "../deep-dive/_components/run-controls"
import { AssembledCvPanel } from "./_components/assembled-cv"
import { BriefPanel, SelectionPanel } from "./_components/brief-and-selection"
import { ExpandAllButton, LogSectionsProvider } from "./_components/log-sections"
import { GenerationLog, StageStepper } from "./_components/generation-log"
import { ConcernsPanel } from "./_components/concerns-panel"
import { GenerateCvButton } from "./_components/generate-cv-button"
import { RunPanel } from "./_components/run-panel"

export default async function CvGenerationPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, { profile }] = await Promise.all([params, requireProfile()])
  const [assets, view] = await Promise.all([
    getJobAssets(id, profile.id),
    getLatestCvGeneration(profile.id, id),
  ])
  if (!assets) notFound()

  const page = (
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-14 lg:py-10">
        <main className="min-w-0">
          <p className="mb-6 text-sm text-muted-foreground">
            CV generation · <span className="text-foreground">{assets.title}</span>
            {assets.company && <> at <span className="text-foreground">{assets.company}</span></>}
          </p>
          {view ? <RunBody jobId={id} view={view} jobTitle={assets.title} company={assets.company ?? null} /> : <EmptyState jobId={id} />}
        </main>

        {view && (
          // Before the long sections on a narrow screen, so the controls stay near the top.
          <aside className="order-first lg:sticky lg:top-10 lg:order-none lg:self-start">
            <RunPanel view={view} jobId={id} jobTitle={assets.title} company={assets.company ?? null} />
          </aside>
        )}
      </div>
  )

  return (
    <div>
      <AssessmentPoller signature={cvGenerationSignature(view)} />
      {view ? (
        <LogSectionsProvider status={view.status} ids={sectionIdsFor(view)}>{page}</LogSectionsProvider>
      ) : page}
    </div>
  )
}

function sectionIdsFor(view: CvGenerationView): string[] {
  return logSectionIds({
    rows: buildStageRows(view),
    hasConcerns: concernRows(view.review).length > 0,
    hasAssembled: !!view.assembled,
    hasBrief: !!view.brief,
    hasSelection: !!view.selection,
    assembleWarnings: view.assembled?.warnings ?? [],
  })
}

function EmptyState({ jobId }: { jobId: string }) {
  return (
    <div className="max-w-[68ch]">
      <h1 className="text-3xl font-semibold tracking-[-0.02em]">No CV generation has run for this job yet</h1>
      <p className="mt-3 leading-relaxed text-muted-foreground">
        When a CV is generated for this job, each stage shows up here as it runs: the model it used, how long it took,
        what it cost, which evidence was kept or dropped, and any claim the review could not support.
      </p>
      <div className="mt-5 space-y-2">
        <GenerateCvButton jobId={jobId} />
        <p className="text-sm text-muted-foreground">Generating runs every stage on your own LLM key and saves the CV as a draft in the writing desk. You accept or discard it there; nothing live is overwritten.</p>
      </div>
      <ol className="mt-8 space-y-4 border-t pt-6">
        {CV_GENERATION_STAGES.map((s, i) => (
          <li key={s} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
            <span className="font-mono text-sm tabular-nums text-muted-foreground">{i + 1}</span>
            <div>
              <p className="font-medium">{CV_GENERATION_STAGE_INFO[s].label}</p>
              <p className="text-sm text-muted-foreground">{CV_GENERATION_STAGE_INFO[s].detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function RunBody({ jobId, view, jobTitle, company }: { jobId: string; view: CvGenerationView; jobTitle: string; company: string | null }) {
  const rows = buildStageRows(view) // view carries status, log, stageTimings and partial
  const active = isCvGenerationActive(view.status)

  return (
    <div className="max-w-[68ch] space-y-8">
      {active ? (
        <div>
          <h1 aria-live="polite" className="flex items-center gap-2 text-2xl font-semibold tracking-[-0.02em]">
            <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
            {CV_GENERATION_STATUS_LABEL[view.status]}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You can leave this page; the generation keeps going.
            {" "}<span className="text-foreground"><Elapsed since={(view.startedAt ?? view.createdAt).toISOString()} /></span>
          </p>
        </div>
      ) : view.status === "failed" ? (
        <div className="space-y-3">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-[-0.02em]">
            <TriangleAlert className="size-5 text-amber-700 dark:text-amber-400" aria-hidden="true" />
            This CV generation didn&apos;t finish
          </h1>
          <p className="leading-relaxed">{view.failureMessage ?? "The CV generation failed. Try again."}</p>
          {view.failureKind === "draft_exists" && view.writingDeskDocumentId && (
            <p className="text-sm text-muted-foreground">
              <Link href={draftHref(jobId, view.writingDeskDocumentId)} className="underline underline-offset-2 hover:text-foreground">
                Open the draft that is waiting
              </Link>
              {view.assembled ? ". The CV this run generated is kept below." : "."}
            </p>
          )}
          {view.failureKind === "no_llm_key" && (
            <Link href="/dashboard/settings/llm" className="inline-block text-sm underline underline-offset-2 hover:text-foreground">
              Add an LLM API key
            </Link>
          )}
        </div>
      ) : view.partial ? (
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-[-0.02em]">
            <Check className="size-5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            {previewCopy(!!view.assembled).notice}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">{previewCopy(!!view.assembled).detail}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-[-0.02em]">
            <Check className="size-5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            {COMPLETE_HEADING}
          </h1>
          {view.writingDeskDocumentId ? (
            <p className="text-sm text-muted-foreground">
              The draft is waiting in the writing desk.{" "}
              <Link
                href={draftHref(jobId, view.writingDeskDocumentId)}
                className="underline underline-offset-2 hover:text-foreground"
              >
                Review the draft
              </Link>
            </p>
          ) : (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              The draft&apos;s document is no longer available.
            </p>
          )}
        </div>
      )}

      <StageStepper rows={rows} />
      <div className="flex justify-end"><ExpandAllButton /></div>
      {concernRows(view.review).length > 0 && <ConcernsPanel concerns={concernRows(view.review)} job={{ title: jobTitle, company }} />}
      {view.assembled && <AssembledCvPanel assembled={view.assembled} />}
      {view.brief && <BriefPanel brief={view.brief} />}
      {view.selection && <SelectionPanel selection={view.selection} />}
      <GenerationLog rows={rows} assembled={view.assembled} />
    </div>
  )
}
