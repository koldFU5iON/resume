import { notFound } from "next/navigation"
import { requireProfile } from "@/lib/session"
import { getCV } from "@/modules/cv/queries"
import { getLatestMasterCV } from "@/modules/career-vertical/queries"
import { getJobAssets } from "@/modules/jobs/queries"
import { JobContextNav } from "@/components/job-context-nav"
import { CvEditor } from "./_components/cv-editor"

type Props = { params: Promise<{ id: string }> }

export default async function CVEditorPage({ params }: Props) {
  const { id } = await params
  const { profile } = await requireProfile()
  const [cv, masterCV] = await Promise.all([getCV(id, profile.id), getLatestMasterCV(profile.id)])
  if (!cv) notFound()

  const jobAssets = cv.jobApplicationId
    ? await getJobAssets(cv.jobApplicationId, profile.id)
    : null

  // Stale = tailored from a master CV that has since been regenerated or edited.
  const stale =
    cv.jobApplicationId !== null &&
    cv.masterCvUpdatedAt !== null &&
    masterCV !== null &&
    cv.masterCvUpdatedAt < masterCV.updatedAt

  return (
    <div className="flex h-full flex-col">
      {jobAssets && (
        <JobContextNav
          jobId={jobAssets.jobId}
          company={jobAssets.company}
          title={jobAssets.title}
          cvDocumentId={jobAssets.cvDocumentId}
          coverLetterDocumentId={jobAssets.coverLetterDocumentId}
          interviewPrepSessionId={jobAssets.interviewPrepSessionId}
          current="cv"
        />
      )}
      <CvEditor cv={{ ...cv, profileName: cv.profile.name }} stale={stale} />
    </div>
  )
}
