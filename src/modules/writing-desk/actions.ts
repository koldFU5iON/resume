"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireProfile } from "@/lib/session"
import { createWritingDeskDocument, loadSourceCv, renameWritingDeskDocument } from "./documents"
import { getWritingDeskLiveState, listWritingDeskSourceCVs, type WritingDeskSourceOption } from "./queries"
import {
  WritingDeskContentSchema,
  WritingDeskDocumentTypeSchema,
  WritingDeskIdSchema,
  type CreateWritingDeskDocumentResult,
  type RenameWritingDeskDocumentResult,
  type WritingDeskDocumentType,
  type WritingDeskSaveResult,
} from "./schema"

/** The job workspace layout: its document tabs show each document's name and type. */
const JOB_WORKSPACE_LAYOUT = "/dashboard/job-applications/view/[id]"

async function getOwnedDesk(id: string, profileId: string) {
  const desk = await prisma.writingDeskDocument.findFirst({
    where: { id, profileId },
    select: { id: true, revision: true, content: true },
  })
  if (!desk) throw new Error("Writing desk not found")
  return desk
}

async function conflictResult(id: string, profileId: string): Promise<WritingDeskSaveResult> {
  const desk = await getOwnedDesk(id, profileId)
  return { ok: false, reason: "conflict", revision: desk.revision, content: desk.content }
}

/**
 * Adds a named document to one of the signed-in user's jobs (blank, or from
 * one of their CVs). Never replaces an existing document. The creation UI is
 * Phase 3 (#371).
 */
export async function createWritingDeskDocumentAction(input: unknown): Promise<CreateWritingDeskDocumentResult> {
  const { profile } = await requireProfile()
  const result = await createWritingDeskDocument(profile.id, input)
  if (result.ok) revalidatePath(JOB_WORKSPACE_LAYOUT, "layout")
  return result
}

/** Renames one of the signed-in user's documents; the job's tabs pick up the new name. */
export async function renameWritingDeskDocumentAction(input: unknown): Promise<RenameWritingDeskDocumentResult> {
  const { profile } = await requireProfile()
  const result = await renameWritingDeskDocument(profile.id, input)
  if (result.ok) revalidatePath(JOB_WORKSPACE_LAYOUT, "layout")
  return result
}

/** The signed-in user's CVs a new document can start from, for the "+" dialog. */
export async function listWritingDeskSourceCVsAction(): Promise<WritingDeskSourceOption[]> {
  const { profile } = await requireProfile()
  return listWritingDeskSourceCVs(profile.id)
}

/** A document's saved content and revision, so an editor can tell whether it is showing a stale copy. */
export async function getWritingDeskLiveStateAction(id: unknown): Promise<{ content: string; revision: number } | null> {
  const { profile } = await requireProfile()
  const parsed = WritingDeskIdSchema.safeParse(id)
  if (!parsed.success) return null
  return getWritingDeskLiveState(profile.id, parsed.data)
}

export async function setWritingDeskDocumentType(
  id: string,
  documentType: WritingDeskDocumentType,
  expectedRevision: number,
): Promise<WritingDeskSaveResult> {
  const { profile } = await requireProfile()
  const parsedType = WritingDeskDocumentTypeSchema.parse(documentType)
  const updated = await prisma.writingDeskDocument.updateMany({
    where: { id, profileId: profile.id, revision: expectedRevision },
    data: { documentType: parsedType, revision: { increment: 1 } },
  })
  if (updated.count === 0) return conflictResult(id, profile.id)
  revalidatePath(JOB_WORKSPACE_LAYOUT, "layout")
  return { ok: true, revision: expectedRevision + 1 }
}

export async function updateWritingDeskContent(
  id: string,
  content: string,
  expectedRevision: number,
): Promise<WritingDeskSaveResult> {
  const { profile } = await requireProfile()
  const parsedContent = WritingDeskContentSchema.parse(content)
  const updated = await prisma.writingDeskDocument.updateMany({
    where: { id, profileId: profile.id, revision: expectedRevision },
    data: { content: parsedContent, revision: { increment: 1 } },
  })
  if (updated.count === 0) return conflictResult(id, profile.id)
  return { ok: true, revision: expectedRevision + 1 }
}

export async function setWritingDeskSource(
  id: string,
  cvId: string | null,
  expectedRevision: number,
): Promise<WritingDeskSaveResult> {
  const { profile } = await requireProfile()
  let data: {
    content?: string
    sourceType: string
    sourceCvDocumentId: string | null
    sourceLabel: string | null
    revision: { increment: 1 }
  }

  if (cvId === null) {
    data = {
      sourceType: "blank",
      sourceCvDocumentId: null,
      sourceLabel: "Blank document",
      revision: { increment: 1 },
    }
  } else {
    const source = await loadSourceCv(profile.id, cvId)
    if (!source) throw new Error("Source CV not found")
    data = { ...source, revision: { increment: 1 } }
  }

  const updated = await prisma.writingDeskDocument.updateMany({
    where: { id, profileId: profile.id, revision: expectedRevision },
    data,
  })
  if (updated.count === 0) return conflictResult(id, profile.id)
  return { ok: true, revision: expectedRevision + 1 }
}
