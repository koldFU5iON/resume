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
      <div className="flex items-center justify-center pl-3 pr-2 py-2">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect(id)}
          aria-label={`Select ${title}`}
          className="border-primary"
        />
      </div>
      {/* Title / company */}
      <div className="min-w-0 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <JobCompletenessDot job={job} />
          <Link
            href={`/dashboard/job-applications/view/${id}`}
            className="truncate text-sm font-semibold leading-snug hover:underline"
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
          {cvDocumentId && (
            <Link
              href={`/dashboard/cv-builder/${cvDocumentId}`}
              aria-label="View CV"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <FileText size={12} />
            </Link>
          )}
          {coverLetterDocumentId && (
            <Link
              href={`/dashboard/cover-letters/${coverLetterDocumentId}`}
              aria-label="View cover letter"
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
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {company}
          {countries.length > 0 && ` · ${countries.join(", ")}`}
          {jobNumber && <span className="font-mono"> · {jobNumber}</span>}
        </p>
      </div>

      {/* Status */}
      <div className="py-2">
        <StatusDropdown jobId={id} status={status} />
      </div>

      {/* Progress */}
      <div className="hidden lg:block px-3 py-2">
        <AppProgressBar progress={progress} jobId={id} />
      </div>

      {/* Salary band */}
      <div className="px-3 py-2">
        <SalaryBandCell salaryBand={salaryBand ?? null} jobId={id} />
      </div>

      {/* Job fit */}
      <div className="flex items-center gap-0.5 py-2">
        {/* JobFit is deprecated: shown only while the early assessment is off for this user. */}
        {!earlyEnabled && <JobFit jobId={id} jobFit={jobFit ?? null} canAssess={!!jobDescription?.trim()} hasLLMKey={hasLLMKey} company={company ?? undefined} jdSnippet={jobDescription ? jobDescription.slice(0, 800) : undefined} />}
        <EarlyAssessment jobId={id} assessment={job.earlyAssessment ?? null} enabled={earlyEnabled} editHref={`/dashboard/job-applications/view/${id}`} />
      </div>

      {/* Applied date */}
      <div className="hidden lg:block px-3 py-2">
        <ApplicationDateBlock label="Applied" date={dateApplied} jobId={id} />
      </div>

      {/* Published date */}
      <div className="hidden xl:block px-3 py-2">
        <PostingAge
          datePublished={datePublished ?? null}
          dateApplied={dateApplied ?? null}
          status={status}
        />
      </div>

      {/* Notes */}
      <div className="hidden xl:flex items-center justify-center py-2">
        <JobNotes jobId={id} initialNotes={notes ?? null} initialIncludeInFit={notesIncludeInFit} />
      </div>

      {/* Last updated */}
      <div className="hidden xl:block px-3 py-2">
        <FreshnessChip lastUpdated={lastUpdated} status={status} />
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center px-2 py-2">
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
