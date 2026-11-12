import { notFound } from "next/navigation"
import { getJobApplicationById } from "@/modules/jobs/queries"
import { requireProfile } from "@/lib/session"
import { getLLMConfigStatus } from "@/modules/llm/client"
import { toDeepDiveAccess } from "@/modules/deep-dive/access"
import { isEarlyAssessmentEnabled } from "@/modules/job-assessment/queries"
import { getJobSponsorStatus } from "@/modules/companies/queries"
import { getJobSpend } from "@/modules/llm/job-cost"
import { JobDetailHeader } from "./_components/job-detail-header"
import { JobSidebar } from "./_components/job-sidebar"
import { JobDescriptionPane } from "./_components/job-description-pane"
import { JobNotesPane } from "./_components/job-notes-pane"
import { JobPageContext } from "./_components/job-page-context"

// Server Actions on this page queue the early job assessment and start deep
// dives, which run in after() within this limit; keep in sync with
// ROUTE_MAX_DURATION_S (src/modules/job-assessment/queue.ts) and
// DEEP_DIVE_ROUTE_MAX_DURATION_S (src/modules/deep-dive/schema.ts).
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

  const [llmConfig, earlyEnabled, sponsor, spend] = await Promise.all([
    getLLMConfigStatus(profile.id),
    isEarlyAssessmentEnabled(profile.id),
    // The chip is a nice-to-have: a failed lookup must not break the page.
    getJobSponsorStatus(profile.id, job.id).catch(() => null),
    getJobSpend(profile.id, job.id).catch(() => null),
  ])
  const hasLLMKey = llmConfig.configured

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden">
      <JobPageContext jobId={job.id} title={job.title} company={job.company} status={job.status} />

      {/* Full-width header */}
      <JobDetailHeader job={job} hasLLMKey={hasLLMKey} sponsor={sponsor} />

      {/* Three-column workspace */}
      <div className="grid flex-1 grid-cols-[200px_1fr_1fr] overflow-hidden">
        <JobSidebar job={job} hasLLMKey={hasLLMKey} earlyEnabled={earlyEnabled} deepDiveAccess={toDeepDiveAccess(llmConfig)} spend={spend} />
        <JobDescriptionPane jobDescription={job.jobDescription} />
        <JobNotesPane jobId={job.id} notes={job.notes} notesIncludeInFit={job.notesIncludeInFit} />
      </div>
    </div>
  )
}
