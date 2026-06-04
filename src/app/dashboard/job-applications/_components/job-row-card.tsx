'use client'

import Link from "next/link"
import {
  ApplicationSource,
  APPLICATION_SOURCE_LABEL,
  type Job,
} from "@/app/types/job-application"
import { AppProgressBar } from "./app-progress-bar"
import { AppControls } from "@/components/app-item-menu"
import { Loader2, SquareArrowOutUpRight } from "lucide-react"
import { JobFit } from "./job-fit"
import { JobNotes } from "./job-notes"
import { StatusDropdown } from "./status-dropdown"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { cn, formatShortDate } from "@/lib/utils"
import { FreshnessChip } from "./freshness-chip"
import { PostingAge } from "./posting-age"
import { JobCompletenessDot } from "./job-completeness-dot"

type JobRowCardProps = {
  job: Job
  selected: boolean
  busyLabel?: string
  onToggleSelect: (id: string) => void
  onEdit: (job: Job) => void
  onArchive: (id: string) => void
  hasLLMKey: boolean
}

export function JobRowCard({ job, selected, busyLabel, onToggleSelect, onEdit, onArchive, hasLLMKey }: JobRowCardProps) {
  const {
    id, jobNumber, title, company, countries, url,
    dateApplied, datePublished, lastUpdated, status, progress,
    jobFit, notes, notesIncludeInFit, applicationSource,
    jobDescription, salaryBand,
  } = job
  const showSourceBadge = applicationSource !== ApplicationSource.Cold
  const busy = Boolean(busyLabel)

  return (
    <div
      className={cn(
        "relative border-b border-border/30 px-3 py-3 last:border-b-0 transition-colors",
        selected ? "bg-muted/40" : "hover:bg-muted/30",
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

      {/* Row 1: checkbox + title + controls */}
      <div className="flex items-start gap-2">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect(id)}
          aria-label={`Select ${title}`}
          className="mt-0.5 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 flex-wrap">
            <JobCompletenessDot job={job} />
            <Link
              href={`/dashboard/job-applications/view/${id}`}
              className="text-sm font-semibold leading-snug hover:underline truncate"
            >
              {title}
            </Link>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`View ${title} job listing on external site`}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              >
                <SquareArrowOutUpRight size={12} />
              </a>
            )}
            {showSourceBadge && (
              <Badge variant="outline" className="shrink-0 text-[10px] font-normal py-0 px-1.5 h-4">
                {APPLICATION_SOURCE_LABEL[applicationSource]}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground truncate">
            {company}
            {countries.length > 0 && ` · ${countries.join(", ")}`}
            {jobNumber && <span className="font-mono"> · {jobNumber}</span>}
          </p>
        </div>
        <AppControls id={id} onEdit={() => onEdit(job)} onArchive={() => onArchive(id)} />
      </div>

      {/* Row 2: status + progress */}
      <div className="mt-2 flex items-center gap-3">
        <StatusDropdown jobId={id} status={status} />
        <div className="flex-1 min-w-0">
          <AppProgressBar progress={progress} jobId={id} />
        </div>
      </div>

      {/* Row 3: metadata chips */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 items-center">
        {salaryBand && (
          <span className="text-xs text-muted-foreground">{salaryBand}</span>
        )}
        <JobFit jobId={id} jobFit={jobFit ?? null} canAssess={!!jobDescription?.trim()} hasLLMKey={hasLLMKey} />
        {dateApplied && (
          <span className="text-xs text-muted-foreground">{formatShortDate(dateApplied)}</span>
        )}
        <PostingAge
          datePublished={datePublished ?? null}
          dateApplied={dateApplied ?? null}
          status={status}
        />
        <FreshnessChip lastUpdated={lastUpdated} status={status} />
        <JobNotes jobId={id} initialNotes={notes ?? null} initialIncludeInFit={notesIncludeInFit} />
      </div>
    </div>
  )
}
