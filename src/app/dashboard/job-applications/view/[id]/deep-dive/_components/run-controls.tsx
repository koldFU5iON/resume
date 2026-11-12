'use client'

import { useSyncExternalStore } from "react"
import { Loader2, RotateCw, Telescope } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useStartDeepDive } from "@/app/dashboard/job-applications/_components/deep-dive-button"

/** Starts a new run of the job (the page then shows its progress). */
export function RunAgainButton({ jobId, label = 'Run again', variant = 'outline', disabled }: {
  jobId: string
  label?: string
  variant?: 'outline' | 'default'
  disabled?: boolean
}) {
  const { start, isStarting } = useStartDeepDive(jobId)
  const Icon = label === 'Run again' ? RotateCw : Telescope
  return (
    <Button variant={variant} size="sm" className="gap-1.5" onClick={start} disabled={disabled || isStarting}>
      {isStarting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Icon className="size-3.5" aria-hidden="true" />}
      {isStarting ? 'Starting…' : label}
    </Button>
  )
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

function subscribeToSeconds(onTick: () => void): () => void {
  const t = window.setInterval(onTick, 1000)
  return () => window.clearInterval(t)
}
const noSubscribe = () => () => {}

/** Time since `since`, ticking every second. Renders nothing on the server. */
export function Elapsed({ since }: { since: string }) {
  const now = useSyncExternalStore(subscribeToSeconds, () => Math.floor(Date.now() / 1000) * 1000, () => null)
  if (now === null) return null
  return <span className="tabular-nums">{formatElapsed(now - new Date(since).getTime())}</span>
}

/** A date in the viewer's own time zone ("12 Nov 2026, 14:03"); a blank on the server. */
export function LocalDateTime({ iso, dateOnly }: { iso: string; dateOnly?: boolean }) {
  const text = useSyncExternalStore(
    noSubscribe,
    () => new Intl.DateTimeFormat('en-GB', dateOnly
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
    ).format(new Date(iso)),
    () => null,
  )
  return <time dateTime={iso}>{text ?? '\u00a0'}</time>
}
