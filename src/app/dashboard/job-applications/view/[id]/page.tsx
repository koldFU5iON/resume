import { notFound } from "next/navigation"
import { getJobApplicationById } from "@/modules/jobs/queries"
import { requireProfile } from "@/lib/session"
import { getLLMConfigStatus } from "@/modules/llm/client"
import { isEarlyAssessmentEnabled } from "@/modules/job-assessment/queries"
import { JobDetailHeader } from "./_components/job-detail-header"
import { JobSidebar } from "./_components/job-sidebar"
import { JobDescriptionPane } from "./_components/job-description-pane"
import { JobNotesPane } from "./_components/job-notes-pane"
import { JobPageContext } from "./_components/job-page-context"

// Server Actions on this page queue the early job assessment, which runs in
// after() within this limit; keep in sync with ROUTE_MAX_DURATION_S in
// src/modules/job-assessment/queue.ts.
export const maxDuration = 300

export default async function ViewJobPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [job, { profile }] = await Promise.all([
    getJobApplicationById(id),
    requireProfile(),
  ])

  if (!job) {
    notFound()
  }

  const [{ configured: hasLLMKey }, earlyEnabled] = await Promise.all([
    getLLMConfigStatus(profile.id),
    isEarlyAssessmentEnabled(profile.id),
  ])

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden">
      <JobPageContext jobId={job.id} title={job.title} company={job.company} status={job.status} />

      {/* Full-width header */}
      <JobDetailHeader job={job} hasLLMKey={hasLLMKey} />

      {/* Three-column workspace */}
      <div className="grid flex-1 grid-cols-[200px_1fr_1fr] overflow-hidden">
        <JobSidebar job={job} hasLLMKey={hasLLMKey} earlyEnabled={earlyEnabled} />
        <JobDescriptionPane jobDescription={job.jobDescription} />
        <JobNotesPane jobId={job.id} notes={job.notes} notesIncludeInFit={job.notesIncludeInFit} />
      </div>
    </div>
  )
}
