import { notFound } from "next/navigation"
import { requireProfile } from "@/lib/session"
import { getCV } from "@/modules/cv/queries"
import { getLatestMasterCV } from "@/modules/career-vertical/queries"
import { JobWorkspace } from "@/components/job-workspace/job-workspace"
import { CvEditor } from "./_components/cv-editor"

type Props = { params: Promise<{ id: string }> }

export default async function CVEditorPage({ params }: Props) {
  const { id } = await params
  const { profile } = await requireProfile()
  const [cv, masterCV] = await Promise.all([getCV(id, profile.id), getLatestMasterCV(profile.id)])
  if (!cv) notFound()

  // Stale = tailored from a master CV that has since been regenerated or edited.
  const stale =
    cv.jobApplicationId !== null &&
    cv.masterCvUpdatedAt !== null &&
    masterCV !== null &&
    cv.masterCvUpdatedAt < masterCV.updatedAt

  // The master CV stays: Writing Desk documents start from it, so it gets no
  // "Deprecating soon" notice (with no job, `current` only drives that notice).
  const isMasterCV = cv.jobApplicationId === null && cv.careerVerticalId !== null

  return (
    <JobWorkspace jobId={cv.jobApplicationId} current={isMasterCV ? undefined : { kind: "cv", id: cv.id }}>
      <CvEditor key={cv.id} cv={{ ...cv, profileName: cv.profile.name }} stale={stale} />
    </JobWorkspace>
  )
}
