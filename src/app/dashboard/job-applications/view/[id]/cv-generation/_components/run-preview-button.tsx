"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Play } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { notifyAssessmentStarted } from "@/app/dashboard/job-applications/_components/assessment-poller"
import { startResponseMessage } from "@/app/dashboard/job-applications/_components/cv-generation-view"

/**
 * Starts a preview run (brief and selection only: the writing stages are not
 * built yet) through POST /api/jobs/[id]/cv-generation, then refreshes so the
 * page's poller picks up progress. Disabled while a run is active.
 */
export function RunPreviewButton({ jobId, active, label = "Run preview" }: { jobId: string; active: boolean; label?: string }) {
  const router = useRouter()
  const [starting, setStarting] = useState(false)

  async function start() {
    if (starting || active) return
    setStarting(true)
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cv-generation`, { method: "POST" })
      const outcome = startResponseMessage(res.status)
      if (!outcome.ok) {
        toast.error(outcome.message ?? "Couldn't start the preview.")
        return
      }
      notifyAssessmentStarted()
      router.refresh()
    } catch {
      toast.error(startResponseMessage(0).message ?? "Couldn't start the preview.")
    } finally {
      setStarting(false)
    }
  }

  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={start} disabled={starting || active}>
      {starting || active ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
      {starting ? "Starting…" : label}
    </Button>
  )
}
