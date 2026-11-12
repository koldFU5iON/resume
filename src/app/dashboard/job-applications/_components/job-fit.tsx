'use client'

import { useState } from "react"
import { Flame, Info, Loader2, Sparkles, StickyNote, Telescope } from "lucide-react"
import Link from "next/link"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { MarkdownProse } from "@/components/ui/markdown-prose"
import type { JobFit as JobFitType } from "@/app/types/job-application"
import { cn } from "@/lib/utils"
import { usePageContext } from "@/lib/context/page-context"
import { ScoreHeader, ScorePill } from "./score-display"
import type { DeepDiveSummary } from "@/modules/deep-dive/queries"
import { VerdictChip, useStartDeepDive } from "./deep-dive-button"
import { deepDiveHref } from "./deep-dive-view"

type JobFitProps = {
  jobId?: string
  jobFit: JobFitType | null
  canAssess?: boolean
  hasLLMKey?: boolean
  /** The job's deep dive. Once it has a complete one, its verdict replaces the pill. */
  deepDive?: DeepDiveSummary | null
  company?: string
  jdSnippet?: string
}

const FLAME_STYLES: Record<JobFitType['label'], string> = {
  reach:    'fill-blue-400 text-blue-400',
  possible: 'fill-amber-200 text-amber-300',
  stretch:  'fill-amber-400 text-amber-500',
  solid:    'fill-orange-500 text-orange-600',
  standout: 'fill-red-500 text-red-600',
}

const PILL_TEXT_STYLES: Record<JobFitType['label'], string> = {
  reach:    'text-blue-400',
  possible: 'text-amber-300',
  stretch:  'text-amber-500',
  solid:    'text-orange-600',
  standout: 'text-red-600',
}

/**
 * @deprecated JobFit (Claude, user's LLM key) is superseded by the early
 * assessment (`EarlyAssessment`). Shown only where that is off for the user,
 * and in the job page's "Legacy fit score" section for reference. Remove once
 * nothing needs to look back at it. Hidden once the job has a deep dive.
 */
export function JobFit({ jobId, jobFit, canAssess = true, hasLLMKey = true, deepDive, company, jdSnippet }: JobFitProps) {
  const hasDeepDive = !!deepDive?.hasReport
  const { start, isStarting } = useStartDeepDive(jobId ?? '')
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Display-only context (e.g. no jobId passed)
  if (!jobId) {
    if (!jobFit || hasDeepDive) return <div className="h-6 w-16" />
    return <FitPill fit={jobFit} />
  }

  if (hasDeepDive) {
    return deepDive?.verdict ? (
      <Link
        href={deepDiveHref(jobId)}
        title="Open the deep dive"
        className="inline-flex h-6 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="sr-only">Deep dive verdict: </span>
        <VerdictChip verdict={deepDive.verdict} />
      </Link>
    ) : null
  }

  // Nothing writes jobFit any more (spec §10): Assess and Re-assess start a deep dive.
  function handleAssess() {
    setPopoverOpen(false)
    setDrawerOpen(false)
    start()
  }

  if (isStarting) {
    return (
      <div className="inline-flex h-6 items-center gap-1.5 px-2 text-xs text-muted-foreground" aria-live="polite">
        <Loader2 className="size-3 animate-spin" />
        Starting deep dive…
      </div>
    )
  }

  if (!jobFit) {
    const disabled = !hasLLMKey || !canAssess
    const title = !hasLLMKey
      ? 'Add an LLM API key in Settings to run a deep dive'
      : !canAssess
        ? 'Add a job description first'
        : 'Run a deep dive on this job'

    return (
      <button
        type="button"
        onClick={handleAssess}
        disabled={disabled}
        title={title}
        aria-label={title}
        className={cn(
          "group/assess inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs bg-primary text-primary-foreground transition-colors",
          disabled
            ? "cursor-not-allowed opacity-40"
            : "hover:bg-muted hover:text-foreground cursor-pointer",
        )}
      >
        <Telescope size={12} className={disabled ? undefined : "text-primary-foreground group-hover/assess:text-primary"} />
        Deep dive
      </button>
    )
  }

  return (
    <>
      {/* Desktop: popover — hidden below sm breakpoint */}
      <span className="max-sm:hidden">
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger
            aria-label={`Fit: ${jobFit.label}, ${jobFit.rating} out of 10. Click for details.`}
            className="rounded-md hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FitPill fit={jobFit} />
          </PopoverTrigger>
          <PopoverContent className="w-96 max-h-[min(28rem,80vh)] overflow-y-auto">
            <FitDetail
              jobFit={jobFit}
              hasLLMKey={hasLLMKey}
              canAssess={canAssess}
              onReassess={handleAssess}
              jobId={jobId}
              company={company}
              jdSnippet={jdSnippet}
            />
          </PopoverContent>
        </Popover>
      </span>

      {/* Mobile: bottom drawer — hidden at sm and above */}
      <span className="sm:hidden">
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerTrigger
            aria-label={`Fit: ${jobFit.label}, ${jobFit.rating} out of 10. Tap for details.`}
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FitPill fit={jobFit} />
          </DrawerTrigger>
          <DrawerContent>
            <DrawerTitle className="sr-only">
              {jobFit.label} – {jobFit.rating}/10 fit detail
            </DrawerTitle>
            <div className="overflow-y-auto px-4 pb-6 pt-2">
              <FitDetail
                jobFit={jobFit}
                hasLLMKey={hasLLMKey}
                canAssess={canAssess}
                onReassess={handleAssess}
                jobId={jobId}
                company={company}
                jdSnippet={jdSnippet}
              />
            </div>
          </DrawerContent>
        </Drawer>
      </span>
    </>
  )
}

type FitDetailProps = {
  jobFit: JobFitType
  hasLLMKey: boolean
  canAssess: boolean
  onReassess: () => void
  jobId?: string
  company?: string
  jdSnippet?: string
}

const GAUGE_COLORS: Record<JobFitType['label'], string> = {
  reach:    'bg-blue-400',
  possible: 'bg-amber-300',
  stretch:  'bg-amber-500',
  solid:    'bg-orange-500',
  standout: 'bg-red-500',
}

function FitDetail({ jobFit, hasLLMKey, canAssess, onReassess, jobId, company, jdSnippet }: FitDetailProps) {
  const { openPanel, setContext } = usePageContext()

  function handleAskQuestion() {
    if (!jobId) return
    setContext({
      type: 'job_fit',
      jobId,
      company: company ?? '',
      fitScore: jobFit.rating,
      jdSnippet: jdSnippet ?? '',
    })
    openPanel()
  }
  return (
    <div className="space-y-3">
      <div>
        <ScoreHeader title={jobFit.label} rating={jobFit.rating} colorClass={GAUGE_COLORS[jobFit.label]} />
        <MarkdownProse content={jobFit.justification} />
      </div>

      {jobFit.trajectoryNote && (
        <>
          <Separator />
          <div>
            <p className="text-xs font-semibold mb-1.5">Your trajectory</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{jobFit.trajectoryNote}</p>
          </div>
        </>
      )}

      {jobFit.notesUsed && (
        <>
          <Separator />
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <StickyNote size={11} className="shrink-0 fill-amber-200 text-amber-500" />
            Personal notes were included when this assessment was run.
          </p>
        </>
      )}

      <Separator />

      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          AI assessments can be wrong — trust your gut.{' '}
          <Link href="/dashboard/career-profile" className="underline underline-offset-2 hover:text-foreground transition-colors">
            Update your profile
          </Link>
        </p>
        <div className="shrink-0 flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="How fit is assessed"
                  className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                >
                  <Info size={11} />
                </button>
              }
            />
            <TooltipContent side="top">
              Fit is assessed by comparing your career profile (experience, skills,
              education) against the job description using an LLM. Your career goals
              and personal notes are included when available. Scores reflect
              real-world hiring bars — not a guarantee.
            </TooltipContent>
          </Tooltip>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onReassess() }}
            disabled={!hasLLMKey || !canAssess}
            title={
              !hasLLMKey
                ? 'Add an LLM API key to run a deep dive'
                : !canAssess
                  ? 'Add a job description to run a deep dive'
                  : 'Replace this legacy score with a deep dive'
            }
            className={cn(
              "shrink-0 text-xs inline-flex items-center gap-1 transition-colors",
              (!hasLLMKey || !canAssess)
                ? "text-muted-foreground/40 cursor-not-allowed"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Telescope size={11} className={(!hasLLMKey || !canAssess) ? undefined : "text-accent"} />
            Deep dive
          </button>
        </div>
      </div>

      {jobId && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full justify-start gap-1.5 text-xs"
          onClick={handleAskQuestion}
        >
          <Sparkles className="size-3" />
          Ask a question
        </Button>
      )}
    </div>
  )
}

function FitPill({ fit }: { fit: JobFitType }) {
  return (
    <ScorePill className={PILL_TEXT_STYLES[fit.label]}>
      <Flame size={12} className={FLAME_STYLES[fit.label]} />
      {fit.label}
    </ScorePill>
  )
}
