import Link from "next/link"
import { notFound } from "next/navigation"
import { Check, CircleAlert, Loader2 } from "lucide-react"
import { requireProfile } from "@/lib/session"
import { getJobAssets } from "@/modules/jobs/queries"
import { getLatestCoverLetterRun, getPickerDefaults, type CoverLetterRunView } from "@/modules/cover-letter-generation/queries"
import { writingDeskDocumentHref } from "@/modules/jobs/workspace-nav"
import { AssessmentPoller } from "@/app/dashboard/job-applications/_components/assessment-poller"
import { STATUS_LABEL, isWorking, pollSignature, stepRows } from "@/app/dashboard/job-applications/_components/cover-letter-view"
import { WritingDeskPreview } from "@/app/components/writing-desk-preview"
import { GenerateCoverLetterForJob } from "@/components/job-workspace/generate-cover-letter-for-job"
import { Elapsed } from "../deep-dive/_components/run-controls"
import { AnglePicker } from "./_components/angle-picker"
import { LetterConcerns } from "./_components/letter-concerns"

/**
 * Cover letter generation for one job (#471): suggests angles first, waits
 * for the owner's choice in the angle picker, then shows the letter being
 * written, reviewed and saved as a writing desk draft. The poller refreshes
 * the page while a phase works.
 */
export default async function CoverLetterGenerationPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, { profile }] = await Promise.all([params, requireProfile()])
  const [assets, run, defaults] = await Promise.all([
    getJobAssets(id, profile.id),
    getLatestCoverLetterRun(profile.id, id),
    getPickerDefaults(profile.id),
  ])
  if (!assets) notFound()
  const job = { title: assets.title, company: assets.company ?? null }

  return (
    <div>
      <AssessmentPoller signature={pollSignature(run)} />
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
        <p className="mb-6 text-sm text-muted-foreground">
          Cover letter · <span className="text-foreground">{assets.title}</span>
          {assets.company && <> at <span className="text-foreground">{assets.company}</span></>}
        </p>
        {!run ? (
          <EmptyState jobId={id} />
        ) : run.status === "awaiting_choice" && run.angles ? (
          <AnglePicker jobId={id} runId={run.id} angles={run.angles} defaults={defaults} />
        ) : isWorking(run.status) ? (
          <Working run={run} />
        ) : run.status === "complete" ? (
          <Complete jobId={id} run={run} job={job} />
        ) : (
          <Failed jobId={id} run={run} />
        )}
      </div>
    </div>
  )
}

function EmptyState({ jobId }: { jobId: string }) {
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold">Write a cover letter that sounds like you</h2>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li><span className="text-foreground">Pick an angle.</span> The writing desk reads the job, any deep dive research and your profile, and suggests a few ways to pitch yourself. Or write your own.</li>
        <li><span className="text-foreground">Make it yours.</span> A couple of short, optional questions: what draws you to them, why now. Your answers are the only personal things the letter says.</li>
        <li><span className="text-foreground">Review the draft.</span> It writes the letter, checks it as a recruiter would, and saves it in this job&apos;s cover letter as a draft you accept or discard.</li>
      </ol>
      <p className="text-xs text-muted-foreground">Uses your own LLM key: one call for the angles, then usually two for the letter and its review. A deep dive first gives it better company detail.</p>
      <GenerateCoverLetterForJob jobId={jobId} onPage label="Suggest angles" />
    </div>
  )
}

function Working({ run }: { run: CoverLetterRunView }) {
  return (
    <div className="space-y-5" aria-live="polite">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        {STATUS_LABEL[run.status]}…
      </h2>
      <ol className="space-y-2">
        {stepRows(run.status).map(step => (
          <li key={step.status} className="flex items-center gap-2 text-sm">
            {step.state === "done" ? <Check className="size-4 text-emerald-600" aria-hidden="true" />
              : step.state === "current" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              : <span className="inline-block size-4 rounded-full border" aria-hidden="true" />}
            <span className={step.state === "todo" ? "text-muted-foreground" : undefined}>{step.label}</span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">
        {run.startedAt && <>Running for <Elapsed since={run.updatedAt.toISOString()} /> on this step. </>}
        You can leave this page; it carries on.
      </p>
    </div>
  )
}

function Complete({ jobId, run, job }: { jobId: string; run: CoverLetterRunView; job: { title: string; company: string | null } }) {
  const concerns = run.review?.concerns ?? []
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Check className="size-5 text-emerald-600" aria-hidden="true" />Your cover letter is drafted</h2>
        <p className="text-sm text-muted-foreground">It&apos;s saved as a draft in this job&apos;s cover letter. Read it there, edit it if you like, and accept or discard it. Accepting fills in your contact details.</p>
        <div className="flex flex-wrap items-center gap-3">
          {run.writingDeskDocumentId && (
            <Link href={writingDeskDocumentHref(jobId, run.writingDeskDocumentId)} className="inline-flex h-9 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background hover:opacity-90">
              Review the draft
            </Link>
          )}
          <GenerateCoverLetterForJob jobId={jobId} onPage fresh label="Write another version" />
        </div>
      </div>
      <LetterConcerns concerns={concerns} job={job} />
      {run.letter && (
        <section aria-labelledby="letter-preview" className="space-y-2">
          <h3 id="letter-preview" className="font-medium">The letter</h3>
          <div className="rounded-lg border bg-background p-5">
            <WritingDeskPreview markdown={run.letter.markdown} documentType="cover-letter" blockRemoteContent />
          </div>
        </section>
      )}
      <RunLog run={run} />
    </div>
  )
}

function Failed({ jobId, run }: { jobId: string; run: CoverLetterRunView }) {
  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><CircleAlert className="size-5 text-destructive" aria-hidden="true" />The cover letter stopped</h2>
      <p role="alert" className="text-sm">{run.failureMessage}</p>
      {run.failureKind === "draft_exists" && run.writingDeskDocumentId && (
        <Link href={writingDeskDocumentHref(jobId, run.writingDeskDocumentId)} className="text-sm underline underline-offset-2">Open the waiting draft</Link>
      )}
      {run.failureKind === "no_llm_key" && (
        <Link href="/dashboard/settings/llm" className="text-sm underline underline-offset-2">Add an LLM API key</Link>
      )}
      <GenerateCoverLetterForJob jobId={jobId} onPage fresh label="Start again" />
      <RunLog run={run} />
    </div>
  )
}

function RunLog({ run }: { run: CoverLetterRunView }) {
  if (run.log.length === 0) return null
  const cost = run.log.reduce<number | null>((sum, e) => (sum === null || e.costUsd === null ? null : sum + e.costUsd), 0)
  return (
    <details className="rounded-lg border p-4 text-sm">
      <summary className="cursor-pointer font-medium">How it was made{cost !== null ? ` · about $${cost.toFixed(3)}` : ""}</summary>
      <ol className="mt-3 space-y-3">
        {run.log.map((e, i) => (
          <li key={i}>
            <p className="font-medium capitalize">
              {e.stage} <span className="font-normal text-muted-foreground">· {e.status}{e.model ? ` · ${e.model}` : ""}{e.durationMs !== null ? ` · ${(e.durationMs / 1000).toFixed(1)} s` : ""}{e.retries > 0 ? ` · ${e.retries} retr${e.retries === 1 ? "y" : "ies"}` : ""}</span>
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
              {e.notes.map((n, j) => <li key={j}>{n}</li>)}
            </ul>
          </li>
        ))}
      </ol>
    </details>
  )
}
