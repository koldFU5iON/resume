import { notFound } from "next/navigation"
import { requireProfile } from "@/lib/session"
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
    <WritingDesk desk={desk} sourceCVs={sources} />
  )
}
