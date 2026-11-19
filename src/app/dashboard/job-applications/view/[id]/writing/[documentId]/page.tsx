import { notFound } from "next/navigation"
import { requireProfile } from "@/lib/session"
import { getWritingDeskDocument, listWritingDeskSourceCVs } from "@/modules/writing-desk/queries"
import { hasCvGeneration } from "@/modules/cv-generation/queries"
import { loadVault } from "@/modules/profile-map/load"
import { checkProfileReadiness } from "@/modules/profile-readiness"
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

  // Only an empty CV shows the Generate entry (see WritingDesk), so only then pay for the vault.
  const showsGenerate = desk.documentType === "cv" && !desk.content.trim() && !desk.draft
  const readinessFixCount = showsGenerate ? checkProfileReadiness(await loadVault(profile.id), new Date()).fixCount : 0

  return <WritingDesk key={desk.id} desk={desk} sourceCVs={sources} hasCvGeneration={hasRun} readinessFixCount={readinessFixCount} />
}
