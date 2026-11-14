'use client'

import Link from "next/link"
import {
  ApplicationSource,
  APPLICATION_SOURCE_LABEL,
  type Job,
} from "@/app/types/job-application"
import { AppProgressBar } from "./app-progress-bar"
import { ApplicationDateBlock } from "./app-date-block"
import { AppControls } from "@/components/app-item-menu"
import { ChevronDown, Loader2, SquareArrowOutUpRight } from "lucide-react"
import { JobFit } from "./job-fit"
import { EarlyAssessment } from "./early-assessment"
import { SalaryPopover } from "./salary-popover"
import { JobNotes } from "./job-notes"
import { StatusDropdown } from "./status-dropdown"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { FreshnessChip } from "./freshness-chip"
import { PostingAge } from "./posting-age"
import { jobCompleteness } from "@/modules/jobs/completeness"
import { isHttpUrl } from "@/modules/jobs/form-utils"

type JobRowCardProps = {
  job: Job
  selected: boolean
  busyLabel?: string
  onToggleSelect: (id: string) => void
  onEdit: (job: Job) => void
  onArchive: (id: string) => void
  onGenerateCV: (id: string) => void
  onCreateCoverLetter: (id: string) => void
  hasLLMKey: boolean
  earlyEnabled: boolean
}

export function JobRowCard({ job, selected, busyLabel, onToggleSelect, onEdit, onArchive, onGenerateCV, onCreateCoverLetter, hasLLMKey, earlyEnabled }: JobRowCardProps) {
  const {
    id, jobNumber, title, company, countries, url,
    dateApplied, datePublished, lastUpdated, status, progress,
    jobFit, notes, notesIncludeInFit, applicationSource,
    jobDescription, salaryBand, salaryEstimate,
  } = job
  const showSourceBadge = applicationSource !== ApplicationSource.Cold
  const busy = Boolean(busyLabel)
  const completeness = jobCompleteness(job)

  return (
    <div
      className={cn(
        "relative border-b border-border px-4 py-5 last:border-b-0 transition-colors",
        selected ? "bg-muted/40" : "",
        busy && "hover:bg-transparent",
      )}
      data-busy={busy}
      aria-busy={busy || undefined}
    >
      {busy && (
        <div className="pointer-events-auto absolute inset-0 z-10 flex items-center justify-center bg-background/85 backdrop-blur-[1px]">
          <span role="status" className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {busyLabel}
          </span>
        </div>
      )}

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link href={`/dashboard/job-applications/view/${id}`} className="block min-h-11 text-base font-semibold leading-snug break-words hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {title}
          </Link>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground break-words">
            {company}{countries.length > 0 && ` · ${countries.join(", ")}`}
          </p>
        </div>
        <AppControls id={id} className="size-11 shrink-0" cvDocumentId={job.cvDocumentId} coverLetterDocumentId={job.coverLetterDocumentId} onEdit={() => onEdit(job)} onArchive={() => onArchive(id)} onGenerateCV={() => onGenerateCV(id)} onCreateCoverLetter={() => onCreateCoverLetter(id)} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <StatusDropdown jobId={id} status={status} className="min-h-11 px-3 text-sm" />
        <div className="flex min-w-0 flex-wrap items-center gap-1 [&_button]:min-h-11 [&_button]:px-3 [&_button]:text-sm [&_button>span]:text-sm [&_a]:min-h-11">
          {!earlyEnabled && <JobFit jobId={id} jobFit={jobFit ?? null} canAssess={!!jobDescription?.trim()} hasLLMKey={hasLLMKey} deepDive={job.deepDive} company={company ?? undefined} jdSnippet={jobDescription ? jobDescription.slice(0, 800) : undefined} />}
          <EarlyAssessment jobId={id} assessment={job.earlyAssessment ?? null} enabled={earlyEnabled} editHref={`/dashboard/job-applications/view/${id}`} deepDive={job.deepDive} />
        </div>
      </div>
      {salaryBand && <p className="mt-3 text-sm leading-relaxed text-muted-foreground break-words">{salaryBand}</p>}

      <div className="relative mt-3 border-t border-border/60 pt-2">
        <details className="group/details min-w-0">
          <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            More details<ChevronDown className="size-4 transition-transform group-open/details:rotate-180" />
          </summary>
          <div className="mt-2 space-y-4 pb-1">
            <AppProgressBar progress={progress} jobId={id} textOnly />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm text-muted-foreground">Applied</span>
              <ApplicationDateBlock label="Applied" date={dateApplied} jobId={id} compact />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>Posted</span><PostingAge datePublished={datePublished ?? null} dateApplied={dateApplied ?? null} status={status} />
              <span>· Updated</span><FreshnessChip lastUpdated={lastUpdated} status={status} />
            </div>
            {(showSourceBadge || jobNumber) && <p className="text-sm text-muted-foreground">{showSourceBadge && APPLICATION_SOURCE_LABEL[applicationSource]}{showSourceBadge && jobNumber && ' · '}{jobNumber}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <SalaryPopover jobId={id} initialEstimate={salaryEstimate ?? null} hasJD={!!jobDescription?.trim()} hasLLMKey={hasLLMKey} showLabel />
              <JobNotes jobId={id} initialNotes={notes ?? null} initialIncludeInFit={notesIncludeInFit} showLabel />
            </div>
            {completeness.missing.length > 0 && <p className="text-sm text-muted-foreground">Missing details: {completeness.missing.join(', ')}</p>}
            {isHttpUrl(url) && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Original listing<SquareArrowOutUpRight className="size-4" /><span className="sr-only"> (opens in a new tab)</span></a>}
          </div>
        </details>
        <label className="absolute right-0 top-2 flex min-h-11 cursor-pointer items-center gap-2 rounded px-1 text-sm text-muted-foreground">
          <Checkbox checked={selected} onCheckedChange={() => onToggleSelect(id)} aria-label={`Select ${title}`} className="size-5 after:inset-0" />
          <span aria-hidden="true">Select</span>
        </label>
      </div>
    </div>
  )
}
