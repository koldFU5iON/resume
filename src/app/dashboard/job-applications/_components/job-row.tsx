'use client'

import Link from "next/link"
import {
  ApplicationSource,
  APPLICATION_SOURCE_LABEL,
  type Job,
} from "@/app/types/job-application"
import { AppProgressBar } from "./app-progress-bar"
import { StatusDropdown } from "./status-dropdown"
import { AppControls } from "@/components/app-item-menu"
import { Loader2, FileText, Mail, SquareArrowOutUpRight } from "lucide-react"
import { ApplicationDateBlock } from "./app-date-block"
import { JobFit } from "./job-fit"
import { EarlyAssessment } from "./early-assessment"
import { JobNotes } from "./job-notes"
import { SalaryBandCell } from "./salary-band-cell"
import { JobCompletenessDot } from "./job-completeness-dot"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { FreshnessChip } from "./freshness-chip"
import { PostingAge } from "./posting-age"
import clsx from "clsx"
import { isHttpUrl } from "@/modules/jobs/form-utils"

type JobRowProps = {
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

export function JobRow({ job, selected, busyLabel, onToggleSelect, onEdit, onArchive, onGenerateCV, onCreateCoverLetter, hasLLMKey, earlyEnabled }: JobRowProps) {
  const {
    id, jobNumber, title, company, countries, url,
    dateApplied, datePublished, lastUpdated, status, progress,
    jobFit, notes, notesIncludeInFit, applicationSource,
    jobDescription, salaryBand, cvDocumentId, coverLetterDocumentId,
  } = job
  const showSourceBadge = applicationSource !== ApplicationSource.Cold
  const busy = Boolean(busyLabel)

  const statusTheme = {
    applied: "var(--status-applied)",
    interviewing: "var(--status-interviewing)",
    "not started": "var(--status-not-started)",
    "in-progress": "var(--status-in-progress)",
    accepted: "var(--status-accepted)",
    rejected: "var(--status-rejected)",
  }[status] ?? "var(--status-not-started)"

  return (
    <div
      style={{
        "--status-color": statusTheme,
      } as React.CSSProperties}
      className={
        clsx(
          "group relative col-span-full grid grid-cols-subgrid items-center",
          "rounded-l-md border-b border-border/30 last:border-b-0",
          "transition-colors duration-150",
          "hover:bg-linear-30 hover:from-(--status-color) hover:to-5% hover:to-muted/50 data-[selected=true]:bg-muted/40 data-[busy=true]:hover:bg-transparent",
          "border-l-2",
          "border-l-(--status-color)"
        )}
      data-selected={selected}
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

      {/* Checkbox */}
      <div className="flex items-center justify-center px-2 py-3">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect(id)}
          aria-label={`Select ${title}`}
          className="border-primary"
        />
      </div>
      {/* Title / company */}
      <div className="min-w-0 px-3 py-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <JobCompletenessDot job={job} />
          <Link
            href={`/dashboard/job-applications/view/${id}`}
            className="min-w-0 line-clamp-2 text-sm font-semibold leading-snug hover:underline"
          >
            {title}
          </Link>
          {isHttpUrl(url) && (
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
          {cvDocumentId && (
            <Link
              href={`/dashboard/cv-builder/${cvDocumentId}`}
              aria-label="View CV in the CV Builder (deprecating soon)"
              title="CV Builder · Deprecating soon"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <FileText size={12} />
            </Link>
          )}
          {coverLetterDocumentId && (
            <Link
              href={`/dashboard/cover-letters/${coverLetterDocumentId}`}
              aria-label="View cover letter in the cover letter editor (deprecating soon)"
              title="Cover letter editor · Deprecating soon"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Mail size={12} />
            </Link>
          )}
          {showSourceBadge && (
            <Badge variant="outline" className="shrink-0 text-[10px] font-normal py-0 px-1.5 h-4">
              {APPLICATION_SOURCE_LABEL[applicationSource]}
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-4">
          <p className="min-w-0 max-w-full truncate text-xs text-muted-foreground">
            {company}
            {countries.length > 0 && ` · ${countries.join(", ")}`}
            {jobNumber && <span className="font-mono"> · {jobNumber}</span>}
          </p>
          <div className="flex min-w-0 max-w-full items-center gap-2">
            <span className="shrink-0 text-xs text-muted-foreground">Salary</span>
            <SalaryBandCell salaryBand={salaryBand ?? null} jobId={id} />
          </div>
        </div>
      </div>

      {/* Application status and progress share a compact, fixed-width column. */}
      <div className="flex flex-col items-start px-2 py-3">
        <StatusDropdown jobId={id} status={status} />
        <AppProgressBar progress={progress} jobId={id} compact />
      </div>

      {/* Job fit */}
      <div className="flex min-w-0 flex-wrap items-center gap-0.5 px-2 py-3">
        {/* JobFit is deprecated: shown only while the early assessment is off for this user. */}
        {!earlyEnabled && <JobFit jobId={id} jobFit={jobFit ?? null} canAssess={!!jobDescription?.trim()} hasLLMKey={hasLLMKey} deepDive={job.deepDive} company={company ?? undefined} jdSnippet={jobDescription ? jobDescription.slice(0, 800) : undefined} />}
        <EarlyAssessment jobId={id} assessment={job.earlyAssessment ?? null} enabled={earlyEnabled} editHref={`/dashboard/job-applications/view/${id}`} deepDive={job.deepDive} />
      </div>

      {/* Dates stay together, with the same alignment in every row. */}
      <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] items-center justify-items-start gap-x-1 px-2 py-3 text-xs text-muted-foreground">
        <span>Applied</span>
        <ApplicationDateBlock label="Applied" date={dateApplied} jobId={id} compact />
        <span>Published</span>
        <PostingAge datePublished={datePublished ?? null} dateApplied={dateApplied ?? null} status={status} />
        <span>Updated</span>
        <FreshnessChip lastUpdated={lastUpdated} status={status} />
      </div>

      {/* Controls */}
      <div className="flex items-center justify-end gap-1 px-2 py-3">
        <JobNotes jobId={id} initialNotes={notes ?? null} initialIncludeInFit={notesIncludeInFit} />
        <AppControls
          id={id}
          cvDocumentId={cvDocumentId}
          coverLetterDocumentId={coverLetterDocumentId}
          onEdit={() => onEdit(job)}
          onArchive={() => onArchive(id)}
          onGenerateCV={() => onGenerateCV(id)}
          onCreateCoverLetter={() => onCreateCoverLetter(id)}
        />
      </div>
    </div>
  )
}
