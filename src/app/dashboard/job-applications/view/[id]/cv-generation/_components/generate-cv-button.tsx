"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Play } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { notifyAssessmentStarted } from "@/app/dashboard/job-applications/_components/assessment-poller"
import { draftHref, startResponseMessage } from "@/app/dashboard/job-applications/_components/cv-generation-view"

/**
 * Starts a CV generation through POST /api/jobs/[id]/cv-generation (the CV
 * lands as a writing desk draft), then refreshes so the page's poller picks up
 * progress. `fresh` asks for a new brief and selection instead of reusing the
 * stored ones. A 409 (the job's CV document already has a draft) offers to open
 * it. Disabled from the click until the refreshed page has rendered (the
 * transition), at which point the page itself no longer offers the button
 * while a run is active.
 */
export function GenerateCvButton({ jobId, label = "Generate CV", fresh = false }: { jobId: string; label?: string; fresh?: boolean }) {
  const router = useRouter()
  const [starting, setStarting] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const busy = starting || refreshing

  async function start() {
    if (busy) return
    setStarting(true)
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cv-generation`, {
        method: "POST",
        ...(fresh ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fresh: true }) } : {}),
      })
      const outcome = startResponseMessage(res.status)
      if (!outcome.ok) {
        const documentId = res.status === 409 ? ((await res.json().catch(() => null)) as { documentId?: string } | null)?.documentId : undefined
        toast.error(outcome.message ?? "Couldn't start the CV generation.", documentId
          ? { action: { label: "Open draft", onClick: () => router.push(draftHref(jobId, documentId)) } }
          : undefined)
        return
      }
      notifyAssessmentStarted()
      startTransition(() => router.refresh())
    } catch {
      toast.error(startResponseMessage(0).message ?? "Couldn't start the CV generation.")
    } finally {
      setStarting(false)
    }
  }

  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={start} disabled={busy}>
      {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
      {busy ? "Starting…" : label}
    </Button>
  )
}
