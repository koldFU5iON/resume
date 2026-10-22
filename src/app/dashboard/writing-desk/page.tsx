import Link from "next/link"
import { NotebookPen } from "lucide-react"
import { requireProfile } from "@/lib/session"
import { listWritingDeskJobs } from "@/modules/writing-desk/queries"
import {
  APPLICATION_STATUS_LABEL,
} from "@/app/types/job-application"
import type { WritingDeskDocumentType } from "@/modules/writing-desk/schema"
import { daysAgo, formatRelative } from "@/lib/utils"

const DOCUMENT_TYPE_LABELS: Record<WritingDeskDocumentType, string> = {
  cv: "CV",
  "cover-letter": "Cover letter",
  "interview-prep": "Interview prep",
  other: "Other",
}

export default async function WritingDeskIndexPage() {
  const { profile } = await requireProfile()
  const jobs = await listWritingDeskJobs(profile.id)

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Writing Desk</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Pick a job application to write for. Each desk is a free-form Markdown workspace.
        </p>
      </div>

      {jobs.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          <NotebookPen className="mx-auto mb-3 size-8" />
          <p>No job applications yet.</p>
          <p className="mt-1">
            <Link href="/dashboard/job-applications" className="underline">
              Add a job application →
            </Link>
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/50 rounded-md border">
          {jobs.map(job => {
            const days = job.deskUpdatedAt ? daysAgo(job.deskUpdatedAt) : null
            const deskLabel = job.hasContent
              ? [
                  job.documentType ? DOCUMENT_TYPE_LABELS[job.documentType] : "Draft",
                  days !== null ? formatRelative(days) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Not started"
            return (
              <Link
                key={job.id}
                href={`/dashboard/job-applications/view/${job.id}/writing`}
                className="flex items-start gap-4 px-4 py-3 transition-colors hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {job.title}
                    {job.company ? ` · ${job.company}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {APPLICATION_STATUS_LABEL[job.status]} · {deskLabel}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">Open →</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
