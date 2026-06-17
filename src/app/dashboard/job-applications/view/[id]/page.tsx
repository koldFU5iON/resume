import { notFound } from "next/navigation"
import { getJobApplicationById } from "@/modules/jobs/queries"
import { requireProfile } from "@/lib/session"
import { getLLMConfigStatus } from "@/modules/llm/client"
import { JobDetailHeader } from "./_components/job-detail-header"
import { JobSidebar } from "./_components/job-sidebar"
import { JobDescriptionPane } from "./_components/job-description-pane"
import { JobNotesPane } from "./_components/job-notes-pane"
import { JobPageContext } from "./_components/job-page-context"
import { JobMobileView } from "./_components/job-mobile-view"

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

  const { configured: hasLLMKey } = await getLLMConfigStatus(profile.id)

  return (
    <>
      <JobPageContext jobId={job.id} title={job.title} company={job.company} status={job.status} />

      {/* Mobile layout — hidden at md and above */}
      <div className="md:hidden">
        <JobMobileView job={job} hasLLMKey={hasLLMKey} />
      </div>

      {/* Desktop layout — hidden below md, unchanged */}
      <div className="hidden md:flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden">
        <JobDetailHeader job={job} />
        <div className="grid flex-1 grid-cols-[200px_1fr_1fr] overflow-hidden">
          <JobSidebar job={job} hasLLMKey={hasLLMKey} />
          <JobDescriptionPane jobDescription={job.jobDescription} />
          <JobNotesPane jobId={job.id} notes={job.notes} notesIncludeInFit={job.notesIncludeInFit} />
        </div>
      </div>
    </>
  )
}
