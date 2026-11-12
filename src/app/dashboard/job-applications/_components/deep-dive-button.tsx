'use client'

import { createContext, useContext, useTransition, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowRight, Loader2, Telescope } from "lucide-react"
import { toast } from "sonner"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { startDeepDiveAction } from "@/modules/deep-dive/actions"
import type { DeepDiveAccess } from "@/modules/deep-dive/access"
import type { DeepDiveSummary } from "@/modules/deep-dive/queries"
import type { Verdict } from "@/modules/deep-dive/schema"
import {
  DEEP_DIVE_STATUS_LABEL,
  VERDICT_CHIP,
  VERDICT_LABEL,
  deepDiveHref,
  isDeepDiveActive,
  researchNote,
} from "./deep-dive-view"

const DeepDiveAccessContext = createContext<DeepDiveAccess | null>(null)

/** Provides the user's deep dive access (computed on the server) to every Deep dive action below it. */
export function DeepDiveAccessProvider({ access, children }: { access: DeepDiveAccess; children: ReactNode }) {
  return <DeepDiveAccessContext.Provider value={access}>{children}</DeepDiveAccessContext.Provider>
}

/** Access from the nearest provider; null outside one (the action is then hidden). */
export function useDeepDiveAccess(): DeepDiveAccess | null {
  return useContext(DeepDiveAccessContext)
}

/** Starts a deep dive and opens its page. Shared by the button, the sidebar and the retired JobFit's Assess. */
export function useStartDeepDive(jobId: string) {
  const router = useRouter()
  const [isStarting, startTransition] = useTransition()

  function start() {
    if (isStarting) return
    startTransition(async () => {
      const result = await startDeepDiveAction(jobId)
      switch (result.kind) {
        case 'started':
        case 'existing':
          router.push(deepDiveHref(jobId))
          return
        case 'limit':
          toast.error('Two deep dives are already running. Try again when one finishes.')
          return
        case 'no_llm_key':
          toast.error('Add an LLM API key to run a deep dive.', {
            action: { label: 'Settings', onClick: () => router.push('/dashboard/settings/llm') },
          })
          return
        case 'no_description':
          toast.error('Add a job description first: the deep dive needs it.')
          return
        case 'not_found':
          toast.error('Job not found.')
          return
      }
    })
  }
  return { start, isStarting }
}

export function VerdictChip({ verdict, className }: { verdict: Verdict; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 w-fit items-center rounded-md px-1.5 text-xs font-medium whitespace-nowrap", VERDICT_CHIP[verdict], className)}>
      {VERDICT_LABEL[verdict]}
    </span>
  )
}

type DeepDiveButtonProps = {
  jobId: string
  deepDive: DeepDiveSummary | null | undefined
  access: DeepDiveAccess
  className?: string
}

/**
 * The early assessment's Deep dive action (spec §7). With no run yet it
 * starts one and opens the page; with one it opens the page. Shown for every
 * complete assessment, blocked ones included.
 */
export function DeepDiveButton({ jobId, deepDive, access, className }: DeepDiveButtonProps) {
  const { start, isStarting } = useStartDeepDive(jobId)
  const note = researchNote(access)

  if (deepDive) {
    const active = isDeepDiveActive(deepDive.status)
    return (
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        <Link href={deepDiveHref(jobId)} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5 text-xs")}>
          {active ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : <Telescope className="size-3" aria-hidden="true" />}
          {active ? DEEP_DIVE_STATUS_LABEL[deepDive.status] : 'Open deep dive'}
          <ArrowRight className="size-3" aria-hidden="true" />
        </Link>
        {deepDive.verdict && <VerdictChip verdict={deepDive.verdict} />}
      </div>
    )
  }

  if (!access.configured) {
    return (
      <div className={cn("space-y-1", className)}>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" disabled>
          <Telescope className="size-3" aria-hidden="true" />
          Deep dive
        </Button>
        <p className="text-xs text-muted-foreground">
          Runs on your own LLM key.{' '}
          <Link href="/dashboard/settings/llm" className="underline underline-offset-2 hover:text-foreground">
            Add a key in Settings
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className={cn("space-y-1", className)}>
      <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={start} disabled={isStarting}>
        {isStarting
          ? <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          : <Telescope className="size-3" aria-hidden="true" />}
        {isStarting ? 'Starting…' : 'Deep dive'}
      </Button>
      <p className="text-xs leading-relaxed text-muted-foreground">
        About 2 minutes, on your own API key.
        {access.research === 'none' && <span className="block">No web research with your provider.</span>}
        {access.research === 'untested' && note && <span className="block">{note}</span>}
      </p>
    </div>
  )
}
