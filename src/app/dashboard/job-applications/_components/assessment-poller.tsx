'use client'

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { nextPollDelay } from "./early-assessment-view"

const STARTED_EVENT = "early-assessment-started"

/** Restarts the poller's window, e.g. after a Re-run. */
export function notifyAssessmentStarted(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(STARTED_EVENT))
}

/**
 * Re-renders the page from the server while any visible run is pending.
 * `signature` is pendingSignature() of the visible runs ('' when none).
 *
 * Polls every 3 s, then every 15 s, and stops after POLL_MAX_MS without
 * progress (see nextPollDelay). The window restarts when the signature
 * changes (a run moved on), after a Re-run, and when the tab becomes visible
 * again (which also refreshes at once). Ticks are skipped while the tab is
 * hidden. The next tick is only scheduled once the previous refresh has
 * rendered, so a slow render never stacks refreshes.
 * Mount once per list and once on the detail page.
 */
export function AssessmentPoller({ signature }: { signature: string }) {
  const router = useRouter()
  const [isRefreshing, startRefresh] = useTransition()
  const [restarts, setRestarts] = useState(0)
  const windowStart = useRef(0)
  const active = signature !== ""

  useEffect(() => {
    const onStarted = () => setRestarts((n) => n + 1)
    window.addEventListener(STARTED_EVENT, onStarted)
    return () => window.removeEventListener(STARTED_EVENT, onStarted)
  }, [])

  // Declared before the tick effect so it runs first in the same commit.
  useEffect(() => {
    windowStart.current = Date.now()
  }, [signature, restarts])

  useEffect(() => {
    if (!active) return
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return
      windowStart.current = Date.now()
      startRefresh(() => router.refresh())
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [active, router])

  useEffect(() => {
    if (!active || isRefreshing) return
    const delay = nextPollDelay(Date.now() - windowStart.current)
    if (delay === null) return
    const timer = window.setTimeout(() => {
      // Hidden: stop here; the visibilitychange handler resumes polling.
      if (document.visibilityState === "hidden") return
      startRefresh(() => router.refresh())
    }, delay)
    return () => window.clearTimeout(timer)
  }, [active, isRefreshing, signature, restarts, router])

  return null
}
