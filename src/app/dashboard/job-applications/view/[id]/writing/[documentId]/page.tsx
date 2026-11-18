import { notFound } from "next/navigation"
import { requireProfile } from "@/lib/session"
import { getWritingDeskDocument, listWritingDeskSourceCVs } from "@/modules/writing-desk/queries"
import { hasCvGeneration } from "@/modules/cv-generation/queries"
import { WritingDesk } from "../_components/writing-desk"

/** One Writing Desk document, addressed by id. It must be the profile's and this job's. */
export default async function WritingDeskDocumentPage({
  params,
}: {
  params: Promise<{ id: string; documentId: string }>
}) {
  const [{ id, documentId }, { profile }] = await Promise.all([params, requireProfile()])
  const [desk, sources, hasRun] = await Promise.all([
    getWritingDeskDocument(profile.id, id, documentId),
    listWritingDeskSourceCVs(profile.id),
    hasCvGeneration(profile.id, id),
  ])
  if (!desk) notFound()

  return <WritingDesk key={desk.id} desk={desk} sourceCVs={sources} hasCvGeneration={hasRun} />
}
