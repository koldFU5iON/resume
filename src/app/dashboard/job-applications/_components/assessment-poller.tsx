'use client'

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

/** How often the page re-renders from the server while a run is in progress. */
export const POLL_INTERVAL_MS = 3_000

/** Polling gives up after this long (a stuck run reads as timed out after 5 min anyway). */
export const POLL_MAX_MS = 2 * 60_000

const STARTED_EVENT = "early-assessment-started"

/** Restarts the poller's 2-minute window, e.g. after a Re-run. */
export function notifyAssessmentStarted(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(STARTED_EVENT))
}

/**
 * Calls router.refresh() every 3 s while `active` (any visible job has an
 * early assessment in progress), for at most 2 minutes from when it became
 * active or from the last Re-run. Skips ticks while the tab is hidden.
 * Mount once per list and once on the detail page.
 */
export function AssessmentPoller({ active }: { active: boolean }) {
  const router = useRouter()
  const [restarts, setRestarts] = useState(0)

  useEffect(() => {
    const onStarted = () => setRestarts((n) => n + 1)
    window.addEventListener(STARTED_EVENT, onStarted)
    return () => window.removeEventListener(STARTED_EVENT, onStarted)
  }, [])

  useEffect(() => {
    if (!active) return
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt >= POLL_MAX_MS) {
        window.clearInterval(timer)
        return
      }
      if (document.visibilityState === "hidden") return
      router.refresh()
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [active, restarts, router])

  return null
}
