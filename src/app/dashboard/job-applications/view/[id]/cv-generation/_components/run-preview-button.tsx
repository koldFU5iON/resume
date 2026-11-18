"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Play } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { notifyAssessmentStarted } from "@/app/dashboard/job-applications/_components/assessment-poller"
import { startResponseMessage } from "@/app/dashboard/job-applications/_components/cv-generation-view"

/**
 * Starts a preview run (everything up to the assembled CV: review and draft
 * creation are not built yet) through POST /api/jobs/[id]/cv-generation, then refreshes so the
 * page's poller picks up progress. Disabled from the click until the
 * refreshed page has rendered (the transition), at which point the page
 * itself no longer offers the button while a run is active.
 */
export function RunPreviewButton({ jobId, label = "Run preview" }: { jobId: string; label?: string }) {
  const router = useRouter()
  const [starting, setStarting] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const busy = starting || refreshing

  async function start() {
    if (busy) return
    setStarting(true)
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cv-generation`, { method: "POST" })
      const outcome = startResponseMessage(res.status)
      if (!outcome.ok) {
        toast.error(outcome.message ?? "Couldn't start the preview.")
        return
      }
      notifyAssessmentStarted()
      startTransition(() => router.refresh())
    } catch {
      toast.error(startResponseMessage(0).message ?? "Couldn't start the preview.")
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
