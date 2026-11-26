"use server"

// Owner-side Server Actions for a document's agent draft. Thin wrappers: the
// profile always comes from the browser session (never from the client), the
// draft service does the work, and failures are passed through unchanged.

import { revalidatePath } from "next/cache"
import { requireProfile } from "@/lib/session"
import { acceptDraft, discardDraft, saveDraftContent } from "./draft"
import { MASTER_CV_HREF } from "./schema"

/** Route pattern of the document editor; revalidates every document page. */
const WRITING_PAGE = "/dashboard/job-applications/view/[id]/writing/[documentId]"

function revalidateEditors() {
  revalidatePath(WRITING_PAGE, "page")
  revalidatePath(MASTER_CV_HREF) // the master CV (#469) uses the same draft review
}

export async function saveDraftContentAction(deskId: string, content: string, expectedDraftRevision: number) {
  const { profile } = await requireProfile()
  const result = await saveDraftContent(profile.id, deskId, content, expectedDraftRevision)
  if (result.ok) revalidateEditors()
  return result
}

export async function acceptDraftAction(deskId: string, expectedLiveRevision: number, expectedDraftRevision: number) {
  const { profile } = await requireProfile()
  const result = await acceptDraft(profile.id, deskId, expectedLiveRevision, expectedDraftRevision)
  if (result.ok) revalidateEditors()
  return result
}

export async function discardDraftAction(deskId: string) {
  const { profile } = await requireProfile()
  const result = await discardDraft(profile.id, deskId)
  if (result.ok) revalidateEditors()
  return result
}
