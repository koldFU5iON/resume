"use client"

import { useId, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, Wand2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { discardDraftAction } from "@/modules/writing-desk/draft-actions"
import { jobCvGenerationHref, jobWritingDeskHref, writingDeskDocumentHref } from "@/modules/jobs/workspace-nav"
import {
  discardDraftThenStart,
  requestCvGeneration,
  type StartOutcome,
} from "@/app/dashboard/job-applications/_components/cv-generation-start"
import { guardedNavigate } from "./navigation-guard"

/**
 * "Generate CV for this job": the writing desk's way to start a CV generation
 * (POST /api/jobs/[id]/cv-generation), then on to the progress page. The CV
 * lands as a draft in the job's CV document; nothing live is overwritten.
 * By default the stored brief and selection are reused when nothing changed;
 * "Fresh" re-selects the evidence. A waiting draft (409) is the user's call:
 * open it, or discard it and generate.
 */
export function GenerateCvForJob({ jobId, hasCvGeneration, onStarted, readinessFixCount = 0 }: { jobId: string; hasCvGeneration: boolean; /** Called before leaving for the progress page or a draft (a host dialog closes itself). */ onStarted?: () => void; /** Profile readiness findings that limit the CV ("fix" severity); a hint shows when above 0. Never blocks generating. */ readinessFixCount?: number }) {
  const router = useRouter()
  const ids = useId()
  const [fresh, setFresh] = useState(false)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false) // set synchronously, so a fast double click cannot start twice
  const [waitingDraft, setWaitingDraft] = useState<string | null | undefined>(undefined)

  async function settle(outcome: StartOutcome) {
    if (outcome.kind === "started") {
      onStarted?.()
      await guardedNavigate(() => router.push(jobCvGenerationHref(jobId)))
    } else if (outcome.kind === "draft_exists") {
      setWaitingDraft(outcome.documentId)
    } else {
      toast.error(outcome.message)
    }
  }

  async function generate() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setWaitingDraft(undefined)
    try { await settle(await requestCvGeneration(jobId, { fresh })) } finally { inFlight.current = false; setBusy(false) }
  }

  async function discardAndGenerate(documentId: string) {
    if (inFlight.current) return
    if (!window.confirm("Discard the waiting draft? It is removed for good, including any edits you made to it. Your live document is not affected.")) return
    inFlight.current = true
    setBusy(true)
    try {
      const outcome = await discardDraftThenStart(jobId, documentId, { fresh }, { discard: discardDraftAction })
      if (outcome.kind === "draft_exists") setWaitingDraft(outcome.documentId)
      else { setWaitingDraft(undefined); await settle(outcome) }
    } finally { inFlight.current = false; setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="button" className="gap-1.5" onClick={generate} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Wand2 className="size-4" aria-hidden="true" />}
          {busy ? "Starting…" : "Generate CV for this job"}
        </Button>
        {hasCvGeneration && (
          <Link href={jobCvGenerationHref(jobId)} className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground">
            View last generation
          </Link>
        )}
      </div>
      {readinessFixCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {readinessFixCount === 1 ? "1 thing in your profile limits the CV." : `${readinessFixCount} things in your profile limit the CV.`}{" "}
          {/* "profile-readiness" is READINESS_PANEL_ID (cv-generation/_components/readiness-panel.tsx); not imported because that is a client file of another route. */}
          <Link href={`${jobCvGenerationHref(jobId)}#profile-readiness`} onClick={onStarted} className="underline underline-offset-2 hover:text-foreground">Review profile readiness</Link>
        </p>
      )}
      <div className="flex items-start gap-2">
        <input id={`${ids}-fresh`} type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} disabled={busy} className="mt-1" />
        <label htmlFor={`${ids}-fresh`} className="text-sm text-muted-foreground">
          Fresh (re-select evidence)
          <span className="block text-xs">Off, an unchanged job and profile reuse the evidence chosen last time.</span>
        </label>
      </div>
      {waitingDraft !== undefined && (
        <div role="alert" className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          <p>A draft is already waiting in this job&apos;s CV document. Open it, or discard it and generate a new one. Nothing was spent.</p>
          {!waitingDraft && (
            <Link href={jobWritingDeskHref(jobId)} onClick={onStarted} className="underline underline-offset-2">Open this job&apos;s writing desk</Link>
          )}
          <div className="flex flex-wrap gap-2">
            {waitingDraft && (
              <Button type="button" variant="outline" size="sm" onClick={() => { onStarted?.(); void guardedNavigate(() => router.push(writingDeskDocumentHref(jobId, waitingDraft))) }}>
                Open draft
              </Button>
            )}
            {waitingDraft && (
              <Button type="button" variant="outline" size="sm" onClick={() => void discardAndGenerate(waitingDraft)} disabled={busy}>
                Discard draft and generate
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
