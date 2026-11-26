"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, MailPlus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { discardDraftAction } from "@/modules/writing-desk/draft-actions"
import { jobCoverLetterGenerationHref, writingDeskDocumentHref } from "@/modules/jobs/workspace-nav"
import { requestCoverLetterAngles, type StartOutcome } from "@/app/dashboard/job-applications/_components/cover-letter-view"
import { guardedNavigate } from "./navigation-guard"

/**
 * "Write a cover letter for this job" (#471): asks for angle suggestions
 * (POST /api/jobs/[id]/cover-letter-generation), then goes to the
 * cover letter page, where the owner picks an angle. A waiting draft (409,
 * nothing spent) is the owner's call: open it, or discard it and start.
 */
export function GenerateCoverLetterForJob({
  jobId,
  onStarted,
  onPage = false,
  fresh = false,
  label = "Write a cover letter for this job",
}: {
  jobId: string
  /** Called before leaving (a host dialog closes itself). */
  onStarted?: () => void
  /** Used on the cover letter page itself: refresh it instead of navigating, and hide "How it works". */
  onPage?: boolean
  /** Ask for new angles even when some are waiting for a choice. */
  fresh?: boolean
  label?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [waitingDraft, setWaitingDraft] = useState<string | null | undefined>(undefined)

  async function settle(outcome: StartOutcome) {
    if (outcome.kind === "started") {
      onStarted?.()
      if (onPage) router.refresh()
      else await guardedNavigate(() => router.push(jobCoverLetterGenerationHref(jobId)))
    } else if (outcome.kind === "draft_exists") {
      setWaitingDraft(outcome.documentId)
    } else {
      toast.error(outcome.message)
    }
  }

  async function run(task: () => Promise<StartOutcome | null>) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      const outcome = await task()
      if (outcome) await settle(outcome)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const start = () => run(async () => { setWaitingDraft(undefined); return requestCoverLetterAngles(jobId, { fresh }) })

  const discardAndStart = (documentId: string) => run(async () => {
    if (!window.confirm("Discard the waiting draft? It is removed for good, including any edits you made to it. Your live letter is not affected.")) return null
    const discarded = await discardDraftAction(documentId).catch(() => null)
    if (!discarded || (!discarded.ok && discarded.reason !== "no_draft")) return { kind: "error" as const, message: "Couldn't discard the draft. Try again." }
    setWaitingDraft(undefined)
    return requestCoverLetterAngles(jobId, { fresh })
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="button" className="gap-1.5" onClick={() => void start()} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <MailPlus className="size-4" aria-hidden="true" />}
          {busy ? "Starting…" : label}
        </Button>
        {!onPage && (
          <Link href={jobCoverLetterGenerationHref(jobId)} onClick={onStarted} className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground">
            How it works
          </Link>
        )}
      </div>
      {waitingDraft !== undefined && (
        <div role="alert" className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          <p>A cover letter draft is already waiting for this job. Open it, or discard it and start again. Nothing was spent.</p>
          {waitingDraft && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => { onStarted?.(); void guardedNavigate(() => router.push(writingDeskDocumentHref(jobId, waitingDraft))) }}>
                Open draft
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void discardAndStart(waitingDraft)} disabled={busy}>
                Discard draft and start again
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
