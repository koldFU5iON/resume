import { notFound, redirect } from "next/navigation"
import { requireProfile } from "@/lib/session"
import { getCV } from "@/modules/cv/queries"
import { getLatestMasterCV } from "@/modules/career-vertical/queries"
import { JobWorkspace } from "@/components/job-workspace/job-workspace"
import { CvView } from "./_components/cv-view"
import { cvContentToDeskMarkdown } from "@/modules/writing-desk/from-cv-content"
import { MASTER_CV_HREF } from "@/modules/writing-desk/schema"

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

  // The master CV moved to the writing desk (#469): the old one opens there
  // (its first visit copies it in; this row is left as it is).
  if (cv.jobApplicationId === null && cv.careerVerticalId !== null) redirect(MASTER_CV_HREF)

  return (
    <JobWorkspace jobId={cv.jobApplicationId} current={{ kind: "cv", id: cv.id }}>
      <CvView
        key={cv.id}
        cv={{ ...cv, profileName: cv.profile.name }}
        markdown={cvContentToDeskMarkdown(cv.content, { contact: "keep" })}
        stale={stale}
      />
    </JobWorkspace>
  )
}
