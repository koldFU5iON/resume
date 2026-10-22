import { notFound } from "next/navigation"
import { requireProfile } from "@/lib/session"
import { JobContextNav } from "@/components/job-context-nav"
import { getJobAssets } from "@/modules/jobs/queries"
import { getOrCreateWritingDesk } from "@/modules/writing-desk/actions"
import { getWritingDesk, listWritingDeskSourceCVs } from "@/modules/writing-desk/queries"
import { WritingDesk } from "./_components/writing-desk"

export default async function WritingDeskPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, { profile }] = await Promise.all([params, requireProfile()])
  await getOrCreateWritingDesk(id)
  const [desk, sources, assets] = await Promise.all([
    getWritingDesk(profile.id, id),
    listWritingDeskSourceCVs(profile.id),
    getJobAssets(id, profile.id),
  ])
  if (!desk || !assets) notFound()

  return (
    <div className="flex h-full flex-col">
      <JobContextNav
        jobId={assets.jobId}
        company={assets.company}
        title={assets.title}
        cvDocumentId={assets.cvDocumentId}
        coverLetterDocumentId={assets.coverLetterDocumentId}
        interviewPrepSessionId={assets.interviewPrepSessionId}
        current="writing-desk"
      />
      <WritingDesk desk={desk} sourceCVs={sources} />
    </div>
  )
}
