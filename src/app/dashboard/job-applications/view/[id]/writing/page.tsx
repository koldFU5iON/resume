import { notFound, redirect } from "next/navigation"
import { requireProfile } from "@/lib/session"
import { writingDeskDocumentHref } from "@/modules/jobs/workspace-nav"
import { ensurePrimaryWritingDesk } from "@/modules/writing-desk/documents"

/**
 * The job-scoped Writing Desk URL, kept for old links (#370). It opens the
 * job's primary document, the oldest by (createdAt, id): for jobs from the
 * one-desk-per-job era, the desk they already had. A job with no document
 * yet gets a blank one, as this URL always did. Documents live at
 * /writing/<documentId>.
 */
export default async function WritingDeskPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, { profile }] = await Promise.all([params, requireProfile()])
  const desk = await ensurePrimaryWritingDesk(profile.id, id)
  if (!desk) notFound()
  redirect(writingDeskDocumentHref(id, desk.id))
}
