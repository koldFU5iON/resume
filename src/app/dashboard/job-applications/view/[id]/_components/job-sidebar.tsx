import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { type Job } from "@/app/types/job-application"
import { JobFit } from "@/app/dashboard/job-applications/_components/job-fit"
import { SalaryEstimate } from "@/app/dashboard/job-applications/_components/salary-estimate"
import { StatusDropdown } from "@/app/dashboard/job-applications/_components/status-dropdown"
import { formatDate, cn } from "@/lib/utils"
import { FileText, Mail, ClipboardList } from "lucide-react"

interface Props {
  job: Job
  hasLLMKey: boolean
}

function fitStrengthLabel(rating: number): string {
  if (rating >= 8) return "Strong match"
  if (rating >= 6) return "Good match"
  return "Partial match"
}

export function JobSidebar({ job, hasLLMKey }: Props) {
  return (
    <div className="flex flex-col gap-4 overflow-y-auto border-r p-4">
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
        </CardContent>
      </Card>

      {/* Fit score card */}
      <Card>
        <CardContent className="flex flex-col gap-2 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fit Score</p>
          <JobFit
            jobId={job.id}
            jobFit={job.jobFit ?? null}
            canAssess={!!job.jobDescription?.trim()}
            hasLLMKey={hasLLMKey}
            company={job.company ?? undefined}
            jdSnippet={job.jobDescription ? job.jobDescription.slice(0, 800) : undefined}
          />
          {job.jobFit && (
            <p className="text-xs text-muted-foreground">
              {fitStrengthLabel(job.jobFit.rating)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Salary card */}
      <Card>
        <CardContent className="flex flex-col gap-2 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {job.salaryEstimate?.source === 'estimated' ? 'Salary estimate' : 'Salary'}
          </p>
          <SalaryEstimate
            jobId={job.id}
            initialEstimate={job.salaryEstimate ?? null}
            hasJD={!!job.jobDescription?.trim()}
            hasLLMKey={hasLLMKey}
          />
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
