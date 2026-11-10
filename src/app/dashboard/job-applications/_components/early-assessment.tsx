'use client'

import { useState, useTransition, type ReactNode } from "react"
import Link from "next/link"
import {
  Ban,
  Check,
  CircleAlert,
  CircleHelp,
  Gauge,
  Info,
  Loader2,
  RotateCw,
  ScanSearch,
  TriangleAlert,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { notifyUsageUpdated } from "@/lib/usage-events"
import { assessJobFit } from "@/modules/jobs/job-fit"
import { rerunJobAssessment } from "@/modules/job-assessment/actions"
import type { AssessmentView } from "@/modules/job-assessment/queries"
import type { Blocker } from "@/modules/job-assessment/schema"
import { notifyAssessmentStarted } from "./assessment-poller"
import { ScoreHeader, ScorePill } from "./score-display"
import {
  ATTENTION_TEXT_STYLE,
  EARLY_GAUGE_COLORS,
  EARLY_TEXT_STYLES,
  IN_PROGRESS_LABEL,
  blockerItems,
  canDeepAnalyse,
  earlyAriaLabel,
  earlyHeading,
  earlyPillText,
  earlyTone,
  enrichmentNote,
  failureSummary,
  footerLine,
  isAssessmentInProgress,
  yearsGapItems,
} from "./early-assessment-view"

type EarlyAssessmentProps = {
  jobId: string
  assessment: AssessmentView | null
  /** The early assessment is on for this user (decided on the server): shows Assess and Re-run. */
  enabled: boolean
  hasLLMKey?: boolean
  /** The job has a description, so the deep analysis (assessJobFit) can run. */
  hasDescription?: boolean
}

/**
 * Early assessment (Jev) pill, next to the JobFit pill. Works the same way:
 * desktop opens a Popover, mobile a bottom Drawer, both with
 * EarlyAssessmentDetail inside. Runs in progress show a spinner; the
 * AssessmentPoller on the page refreshes them.
 */
export function EarlyAssessment({ jobId, assessment, enabled, hasLLMKey = true, hasDescription = true }: EarlyAssessmentProps) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isRerunning, startRerun] = useTransition()
  const [isAnalysing, startAnalysis] = useTransition()
  // Id of the run that was current when Re-run succeeded (null: there was
  // none). Until the server sends a newer run, the pill shows "Queued…".
  const [rerunFrom, setRerunFrom] = useState<string | null | undefined>(undefined)
  const showQueued = isRerunning || (rerunFrom !== undefined && (assessment?.id ?? null) === rerunFrom)

  function closeDetail() {
    setPopoverOpen(false)
    setDrawerOpen(false)
  }

  function handleRerun() {
    if (isRerunning) return
    const from = assessment?.id ?? null
    closeDetail()
    startRerun(async () => {
      const result = await rerunJobAssessment(jobId)
      if (result.ok) {
        setRerunFrom(from)
        notifyAssessmentStarted()
      } else {
        toast.error(result.error)
      }
    })
  }

  function handleDeepAnalysis() {
    if (isAnalysing) return
    startAnalysis(async () => {
      const result = await assessJobFit(jobId)
      if (result.ok) {
        notifyUsageUpdated()
        closeDetail()
        toast.success("Deep analysis ready. Open the fit score to read it.")
      } else {
        toast.error(result.message, {
          action: result.error === 'not_configured'
            ? { label: 'Set up', onClick: () => { window.location.href = '/dashboard/settings/llm' } }
            : undefined,
        })
      }
    })
  }

  if (showQueued) return <InProgressPill status="queued" />

  if (!assessment) {
    if (!enabled) return null
    return (
      <button
        type="button"
        onClick={handleRerun}
        title="Run the early assessment"
        aria-label="Run the early assessment"
        className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Gauge size={12} aria-hidden="true" />
        Assess
      </button>
    )
  }

  if (isAssessmentInProgress(assessment)) {
    return <InProgressPill status={assessment.status as keyof typeof IN_PROGRESS_LABEL} />
  }

  const detail = (
    <EarlyAssessmentDetail
      view={assessment}
      enabled={enabled}
      onRerun={handleRerun}
      deepAnalysis={{
        pending: isAnalysing,
        disabledReason: !hasLLMKey
          ? 'Add an LLM API key in Settings to run a deep analysis'
          : !hasDescription
            ? 'Add a job description first'
            : null,
        onRun: handleDeepAnalysis,
      }}
    />
  )

  return (
    <>
      {/* Desktop: popover — hidden below sm breakpoint */}
      <span className="max-sm:hidden">
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger
            aria-label={earlyAriaLabel(assessment, 'Click')}
            className="rounded-md hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <EarlyPill view={assessment} />
          </PopoverTrigger>
          <PopoverContent className="w-96 max-h-[min(28rem,80vh)] overflow-y-auto">
            {detail}
          </PopoverContent>
        </Popover>
      </span>

      {/* Mobile: bottom drawer — hidden at sm and above */}
      <span className="sm:hidden">
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerTrigger
            aria-label={earlyAriaLabel(assessment, 'Tap')}
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <EarlyPill view={assessment} />
          </DrawerTrigger>
          <DrawerContent aria-describedby={undefined}>
            <DrawerTitle className="sr-only">
              Early assessment: {assessment.status === 'failed' ? 'needs attention' : `${earlyHeading(assessment)}, ${assessment.score}/10`}
            </DrawerTitle>
            <div className="overflow-y-auto px-4 pb-6 pt-2">
              {detail}
            </div>
          </DrawerContent>
        </Drawer>
      </span>
    </>
  )
}

function InProgressPill({ status }: { status: keyof typeof IN_PROGRESS_LABEL }) {
  return (
    <span role="status">
      <ScorePill className="font-normal text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        <span className="sr-only">Early assessment: </span>
        {IN_PROGRESS_LABEL[status]}
      </ScorePill>
    </span>
  )
}

function EarlyPill({ view }: { view: AssessmentView }) {
  if (view.status === 'failed') {
    return (
      <ScorePill className={ATTENTION_TEXT_STYLE}>
        <TriangleAlert size={12} aria-hidden="true" />
        Needs attention
      </ScorePill>
    )
  }
  const tone = earlyTone(view)
  return (
    <ScorePill className={cn("tabular-nums", EARLY_TEXT_STYLES[tone])}>
      {view.blocked
        ? <Ban size={12} aria-hidden="true" />
        : <Gauge size={12} aria-hidden="true" />}
      {earlyPillText(view)}
    </ScorePill>
  )
}

type DeepAnalysis = {
  pending: boolean
  /** Why the button is disabled, or null when it can run. */
  disabledReason: string | null
  onRun: () => void
}

type EarlyAssessmentDetailProps = {
  view: AssessmentView
  enabled: boolean
  onRerun: () => void
  deepAnalysis?: DeepAnalysis
}

export function EarlyAssessmentDetail({ view, enabled, onRerun, deepAnalysis }: EarlyAssessmentDetailProps) {
  const failed = view.status === 'failed'
  const blockers = blockerItems(view.blockers)
  const yearsGaps = yearsGapItems(view.blockers)
  const enrichment = enrichmentNote(view)
  const summary = failed ? failureSummary(view.failureKind) : null
  const reasons = view.failureReasons.filter((r) => r !== summary)
  const showDeep = deepAnalysis && canDeepAnalyse(view)

  return (
    <div className="space-y-3">
      {failed ? (
        <div className="space-y-2">
          <p className={cn("flex items-center gap-1.5 text-sm font-semibold", ATTENTION_TEXT_STYLE)}>
            <TriangleAlert size={14} aria-hidden="true" />
            Needs attention
          </p>
          {summary && <p className="text-xs leading-relaxed">{summary}</p>}
          {reasons.length > 0 && (
            <ul className="space-y-1">
              {reasons.map((r, i) => (
                <li key={i} className="text-xs text-muted-foreground leading-relaxed">{r}</li>
              ))}
            </ul>
          )}
          {view.failureKind === 'no_llm_key' && (
            <Link
              href="/dashboard/settings/llm"
              className="inline-block text-xs underline underline-offset-2 hover:text-foreground"
            >
              Add an LLM API key
            </Link>
          )}
          {enabled && (
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={onRerun}>
              <RotateCw className="size-3" aria-hidden="true" />
              Re-run
            </Button>
          )}
        </div>
      ) : (
        <div>
          <ScoreHeader
            title={earlyHeading(view)}
            rating={view.score ?? 0}
            colorClass={EARLY_GAUGE_COLORS[earlyTone(view)]}
            titleClassName={view.blocked ? 'text-destructive' : undefined}
          />
          {view.blocked && view.level && (
            <p className="text-xs text-muted-foreground">
              Scores as {view.level}, but at least one requirement rules it out.
            </p>
          )}
        </div>
      )}

      {blockers.length > 0 && (
        <Section title="Blockers">
          {blockers.map((b, i) => (
            <FlagItem
              key={i}
              icon={b.severity === 'hard'
                ? <Ban size={12} className="text-destructive" aria-hidden="true" />
                : <CircleAlert size={12} className={ATTENTION_TEXT_STYLE} aria-hidden="true" />}
              blocker={b}
              srPrefix={b.severity === 'hard' ? 'Blocker: ' : 'Not confirmed: '}
            />
          ))}
        </Section>
      )}

      {view.strengths.length > 0 && (
        <Section title="Strengths">
          {view.strengths.map((s, i) => (
            <Item key={i} icon={<Check size={12} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />}>
              {s}
            </Item>
          ))}
        </Section>
      )}

      {(yearsGaps.length > 0 || view.gaps.length > 0) && (
        <Section title="Gaps">
          {yearsGaps.map((b, i) => (
            <FlagItem
              key={`y${i}`}
              icon={<TriangleAlert size={12} className={ATTENTION_TEXT_STYLE} aria-hidden="true" />}
              blocker={b}
            />
          ))}
          {view.gaps.map((g, i) => (
            <Item key={`g${i}`} icon={<X size={12} className="text-destructive" aria-hidden="true" />}>
              <span className="sr-only">Major gap: </span>{g}
            </Item>
          ))}
        </Section>
      )}

      {view.unsettled.length > 0 && (
        <Section title="Check these" hint="The description doesn't make clear whether you meet these.">
          {view.unsettled.map((u, i) => (
            <Item key={i} icon={<CircleHelp size={12} className="text-muted-foreground" aria-hidden="true" />}>
              {u}
            </Item>
          ))}
        </Section>
      )}

      {(view.notes.length > 0 || enrichment) && (
        <>
          <Separator />
          <div className="space-y-1">
            {view.notes.map((n, i) => (
              <p key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
                {n}
              </p>
            ))}
            {enrichment && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <ScanSearch size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
                {enrichment}
              </p>
            )}
          </div>
        </>
      )}

      <Separator />

      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Early check against your profile and search context.
          <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground/80">{footerLine(view)}</span>
        </p>
        {!failed && enabled && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRerun() }}
            className="shrink-0 inline-flex items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCw size={11} aria-hidden="true" />
            Re-run
          </button>
        )}
      </div>

      {showDeep && (
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-1.5 text-xs"
          onClick={deepAnalysis.onRun}
          disabled={deepAnalysis.pending || deepAnalysis.disabledReason !== null}
          title={deepAnalysis.disabledReason ?? undefined}
        >
          {deepAnalysis.pending
            ? <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            : <ScanSearch className="size-3" aria-hidden="true" />}
          {deepAnalysis.pending ? 'Running deep analysis…' : 'Deep analysis'}
        </Button>
      )}
      {showDeep && deepAnalysis.disabledReason && (
        <p className="text-xs text-muted-foreground">{deepAnalysis.disabledReason}</p>
      )}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <>
      <Separator />
      <div className="space-y-1.5">
        <p className="text-xs font-semibold">{title}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        <ul className="space-y-1.5">{children}</ul>
      </div>
    </>
  )
}

function Item({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-1.5 text-xs leading-relaxed">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">{children}</span>
    </li>
  )
}

function FlagItem({ icon, blocker, srPrefix }: { icon: ReactNode; blocker: Blocker; srPrefix?: string }) {
  return (
    <Item icon={icon}>
      {srPrefix && <span className="sr-only">{srPrefix}</span>}
      <span className="font-medium">{blocker.label}</span>
      {blocker.detail && (
        <span className="block text-muted-foreground">{blocker.detail}</span>
      )}
    </Item>
  )
}
