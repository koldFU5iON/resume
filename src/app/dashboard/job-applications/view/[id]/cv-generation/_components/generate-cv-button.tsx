"use client"

import { useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, Play } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { discardDraftAction } from "@/modules/writing-desk/draft-actions"
import { notifyAssessmentStarted } from "@/app/dashboard/job-applications/_components/assessment-poller"
import { jobWritingDeskHref } from "@/modules/jobs/workspace-nav"
import { draftHref } from "@/app/dashboard/job-applications/_components/cv-generation-view"
import {
  discardDraftThenStart,
  requestCvGeneration,
  type StartOutcome,
} from "@/app/dashboard/job-applications/_components/cv-generation-start"

/**
 * Starts a CV generation through POST /api/jobs/[id]/cv-generation (the CV
 * lands as a writing desk draft), then refreshes so the page's poller picks up
 * progress. `fresh` asks for a new brief and selection instead of reusing the
 * stored ones. When the job's CV document already has a draft (409, nothing
 * spent) the user chooses: open it, or discard it and generate. Disabled from
 * the click until the refreshed page has rendered (the transition), at which
 * point the page itself no longer offers the button while a run is active.
 */
export function GenerateCvButton({ jobId, label = "Generate CV", fresh = false }: { jobId: string; label?: string; fresh?: boolean }) {
  const router = useRouter()
  const [starting, setStarting] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [waitingDraft, setWaitingDraft] = useState<string | null | undefined>(undefined)
  const inFlight = useRef(false) // synchronous guard against a fast double click
  const busy = starting || refreshing

  function settle(outcome: StartOutcome) {
    if (outcome.kind === "started") {
      setWaitingDraft(undefined)
      notifyAssessmentStarted()
      startTransition(() => router.refresh())
    } else if (outcome.kind === "draft_exists") {
      setWaitingDraft(outcome.documentId)
    } else {
      toast.error(outcome.message)
    }
  }

  async function run(start: () => Promise<StartOutcome>) {
    if (inFlight.current || busy) return
    inFlight.current = true
    setStarting(true)
    try { settle(await start()) } finally { inFlight.current = false; setStarting(false) }
  }

  const start = () => run(() => requestCvGeneration(jobId, { fresh }))
  const discardAndStart = (documentId: string) => {
    if (!window.confirm("Discard the waiting draft? It is removed for good, including any edits you made to it. Your live document is not affected.")) return
    void run(() => discardDraftThenStart(jobId, documentId, { fresh }, { discard: discardDraftAction }))
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" className="gap-1.5" onClick={start} disabled={busy}>
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
        {busy ? "Starting…" : label}
      </Button>
      {waitingDraft !== undefined && (
        <div role="alert" className="max-w-[68ch] space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          <p>A draft is already waiting in this job&apos;s CV document. Open it, or discard it and generate a new one. Nothing was spent.</p>
          {!waitingDraft && (
            <Link href={jobWritingDeskHref(jobId)} className="underline underline-offset-2">Open this job&apos;s writing desk</Link>
          )}
          {waitingDraft && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => router.push(draftHref(jobId, waitingDraft))}>Open draft</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => discardAndStart(waitingDraft)} disabled={busy}>Discard draft and generate</Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
