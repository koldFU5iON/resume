import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { type Job } from "@/app/types/job-application"
import { JobFit } from "@/app/dashboard/job-applications/_components/job-fit"
import { EarlyAssessment } from "@/app/dashboard/job-applications/_components/early-assessment"
import { AssessmentPoller } from "@/app/dashboard/job-applications/_components/assessment-poller"
import { pendingSignature } from "@/app/dashboard/job-applications/_components/early-assessment-view"
import { SalaryPopover } from "@/app/dashboard/job-applications/_components/salary-popover"
import { StatusDropdown } from "@/app/dashboard/job-applications/_components/status-dropdown"
import { formatDate, cn } from "@/lib/utils"
import type { DeepDiveAccess } from "@/modules/deep-dive/access"
import { DeepDiveEntry } from "./deep-dive-entry"
import { FileText, Mail, ClipboardList, NotebookPen } from "lucide-react"

interface Props {
  job: Job
  hasLLMKey: boolean
  /** Early assessment on for this user (decided on the server). */
  earlyEnabled?: boolean
  deepDiveAccess: DeepDiveAccess
}

function fitStrengthLabel(rating: number): string {
  if (rating >= 8) return "Strong match"
  if (rating >= 6) return "Good match"
  return "Partial match"
}

/** @deprecated JobFit (Claude) is superseded by the early assessment; shown only for reference or while that is off. */
function LegacyJobFit({ job, hasLLMKey }: { job: Job; hasLLMKey: boolean }) {
  return (
    <>
      <JobFit
        jobId={job.id}
        jobFit={job.jobFit ?? null}
        canAssess={!!job.jobDescription?.trim()}
        hasLLMKey={hasLLMKey}
        hasDeepDive={!!job.deepDive?.hasReport}
        company={job.company ?? undefined}
        jdSnippet={job.jobDescription ? job.jobDescription.slice(0, 800) : undefined}
      />
      {job.jobFit && !job.deepDive?.hasReport && (
        <p className="text-xs text-muted-foreground">
          {fitStrengthLabel(job.jobFit.rating)}
        </p>
      )}
    </>
  )
}

export function JobSidebar({ job, hasLLMKey, earlyEnabled = false, deepDiveAccess }: Props) {
  const early = job.earlyAssessment ?? null

  return (
    <div className="flex flex-col gap-4 overflow-y-auto border-r p-4 [&>*]:shrink-0">
      {/* Stats card */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</p>
            <StatusDropdown jobId={job.id} status={job.status} />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Progress</p>
            <p className="text-sm font-medium capitalize">{job.progress}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Applied</p>
            <p className="text-sm font-medium">{formatDate(job.dateApplied) ?? "Not recorded"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Last updated</p>
            <p className="text-sm font-medium">{formatDate(job.lastUpdated) ?? "—"}</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Salary</p>
              <SalaryPopover
                jobId={job.id}
                initialEstimate={job.salaryEstimate ?? null}
                hasJD={!!job.jobDescription?.trim()}
                hasLLMKey={hasLLMKey}
              />
            </div>
            <p className="text-sm font-medium">{job.salaryBand ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      {/* Fit score card */}
      <Card>
        <CardContent className="flex flex-col gap-2 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fit Score</p>
          {earlyEnabled ? (
            <>
              <EarlyAssessment jobId={job.id} assessment={early} enabled deepDive={job.deepDive} deepDiveAccess={deepDiveAccess} />
              <AssessmentPoller signature={pendingSignature([early])} />
              {/* JobFit is deprecated: kept here for reference until it's removed. */}
              <details className="mt-1 border-t pt-3 text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Legacy fit score (deprecated)
                </summary>
                <div className="mt-2 space-y-1">
                  <LegacyJobFit job={job} hasLLMKey={hasLLMKey} />
                </div>
              </details>
            </>
          ) : (
            <>
              <LegacyJobFit job={job} hasLLMKey={hasLLMKey} />
              {early && (
                <div className="mt-1 space-y-1 border-t pt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Early assessment</p>
                  <EarlyAssessment jobId={job.id} assessment={early} enabled={false} deepDive={job.deepDive} deepDiveAccess={deepDiveAccess} />
                  <AssessmentPoller signature={pendingSignature([early])} />
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Deep dive: next to the early assessment (spec §7) */}
      <Card>
        <CardContent className="flex flex-col gap-2 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Deep dive</p>
          <DeepDiveEntry jobId={job.id} deepDive={job.deepDive ?? null} access={deepDiveAccess} />
        </CardContent>
      </Card>

      {/* Application Assets */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground px-1">
          Application Assets
        </p>

        {/* CV */}
        <Card>
          <CardContent className="flex flex-col gap-1.5 pt-3 pb-3">
            <div className="flex items-center gap-1.5">
              <FileText size={13} className="shrink-0 text-muted-foreground" />
              <p className="text-xs font-medium">CV</p>
            </div>
            {job.cvDocumentId ? (
              <>
                <p className="text-xs text-muted-foreground">Draft ready</p>
                <Link
                  href={`/dashboard/cv-builder/${job.cvDocumentId}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
                >
                  Open CV →
                </Link>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">Not started</p>
                <Link
                  href={`/dashboard/cv-builder/new?jobId=${job.id}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
                >
                  Create CV
                </Link>
              </>
            )}
          </CardContent>
        </Card>

        {/* Cover Letter */}
        <Card>
          <CardContent className="flex flex-col gap-1.5 pt-3 pb-3">
            <div className="flex items-center gap-1.5">
              <Mail size={13} className="shrink-0 text-muted-foreground" />
              <p className="text-xs font-medium">Cover Letter</p>
            </div>
            {job.coverLetterDocumentId ? (
              <Link
                href={`/dashboard/cover-letters/${job.coverLetterDocumentId}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
              >
                Open cover letter →
              </Link>
            ) : (
              <Link
                href={`/dashboard/cover-letters/new?jobId=${job.id}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
              >
                Create cover letter
              </Link>
            )}
          </CardContent>
        </Card>

        {/* Writing Desk */}
        <Card>
          <CardContent className="flex flex-col gap-1.5 pt-3 pb-3">
            <div className="flex items-center gap-1.5">
              <NotebookPen size={13} className="shrink-0 text-muted-foreground" />
              <p className="text-xs font-medium">Writing Desk</p>
            </div>
            <p className="text-xs text-muted-foreground">Free-form application writing</p>
            <Link
              href={`/dashboard/job-applications/view/${job.id}/writing`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
            >
              Open writing desk →
            </Link>
          </CardContent>
        </Card>

        {/* Interview Prep */}
        <Card>
          <CardContent className="flex flex-col gap-1.5 pt-3 pb-3">
            <div className="flex items-center gap-1.5">
              <ClipboardList size={13} className="shrink-0 text-muted-foreground" />
              <p className="text-xs font-medium">Interview Prep</p>
            </div>
            {job.interviewPrepSessionId ? (
              <Link
                href={`/dashboard/interview-prep/${job.interviewPrepSessionId}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
              >
                Open prep →
              </Link>
            ) : (
              <Link
                href={`/dashboard/interview-prep/new?jobId=${job.id}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
              >
                Start prep
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
