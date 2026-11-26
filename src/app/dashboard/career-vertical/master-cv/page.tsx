import { notFound } from "next/navigation"
import { requireProfile } from "@/lib/session"
import { ensureMasterCvDesk } from "@/modules/writing-desk/master"
import { getMasterCvDeskView, listWritingDeskSourceCVs } from "@/modules/writing-desk/queries"
import { MASTER_CV_SOURCE_ID } from "@/modules/writing-desk/schema"
import { WritingDesk } from "@/app/dashboard/job-applications/view/[id]/writing/_components/writing-desk"

/**
 * The profile's master CV (#469): a Writing Desk document with no job. The
 * first visit creates it, copied from the old CV Builder master when there
 * is one. Regenerating it from the career vertical lands as a draft here.
 */
export default async function MasterCvPage() {
  const { profile } = await requireProfile()
  await ensureMasterCvDesk(profile.id)
  const [desk, sources] = await Promise.all([getMasterCvDeskView(profile.id), listWritingDeskSourceCVs(profile.id)])
  if (!desk) notFound()

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The master can start from another CV, never from itself. */}
      <WritingDesk key={desk.id} desk={desk} sourceCVs={sources.filter(source => source.id !== MASTER_CV_SOURCE_ID)} />
    </div>
  )
}
