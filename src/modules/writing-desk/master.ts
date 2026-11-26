// The profile's master CV as a Writing Desk document (#469).
//
// The master CV is the one document with no job: jobApplicationId is null
// and masterOfProfileId is the profileId (unique, so a profile has at most
// one). It replaces the CV Builder's master CVDocument. A profile that still
// has only the old one gets a desk copy the first time the master CV page
// opens (ensureMasterCvDesk); until then readers fall back to converting the
// old one on the fly (getMasterCvMarkdown). The old row is never changed.
//
// Session-free: every function takes the caller's profileId and scopes every
// query by it.

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { parseCVContent } from "@/modules/cv/schema"
import { cvContentToDeskMarkdown } from "./from-cv-content"
import { MASTER_CV_NAME } from "./schema"
import { validateDraftMarkdown, type DraftIssue } from "./validate"

/** The old CV Builder master: a CVDocument with no job and a career vertical. */
async function loadLegacyMasterCv(profileId: string): Promise<{ id: string; markdown: string } | null> {
  const doc = await prisma.cVDocument.findFirst({
    where: { profileId, jobApplicationId: null, careerVerticalId: { not: null }, status: { not: "generating" } },
    select: { id: true, generatedContent: true },
    orderBy: { updatedAt: "desc" },
  })
  if (!doc) return null
  return { id: doc.id, markdown: cvContentToDeskMarkdown(parseCVContent(doc.generatedContent)) }
}

/** The master CV document's id, or null when the profile has none yet. Read-only. */
export async function getMasterCvDeskId(profileId: string): Promise<string | null> {
  const desk = await prisma.writingDeskDocument.findUnique({
    where: { masterOfProfileId: profileId },
    select: { id: true, profileId: true },
  })
  return desk && desk.profileId === profileId ? desk.id : null
}

/**
 * The master CV document's id, creating it when the profile has none: from
 * the old CV Builder master when there is one (copied, never moved), else
 * blank. Safe under concurrent first visits: the unique masterOfProfileId
 * lets one create win and the other re-reads it.
 */
export async function ensureMasterCvDesk(profileId: string): Promise<string> {
  const existing = await getMasterCvDeskId(profileId)
  if (existing) return existing

  const legacy = await loadLegacyMasterCv(profileId)
  try {
    const created = await prisma.writingDeskDocument.create({
      data: {
        profileId,
        jobApplicationId: null,
        masterOfProfileId: profileId,
        name: MASTER_CV_NAME,
        documentType: "cv",
        content: legacy?.markdown ?? "",
        sourceType: legacy ? "master-cv" : "blank",
        sourceCvDocumentId: legacy?.id ?? null,
        sourceLabel: legacy ? "Copied from your CV Builder master CV" : "Blank document",
      },
      select: { id: true },
    })
    return created.id
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await getMasterCvDeskId(profileId)
      if (raced) return raced
    }
    throw error
  }
}

/**
 * The master CV's saved Markdown for readers (MCP job context, the writing
 * contract, "start from master CV"): the desk document's live content when
 * it exists, else the old CV Builder master converted on the fly, else null.
 * Never writes. A pending draft is not the master until the owner accepts it.
 */
export async function getMasterCvMarkdown(profileId: string): Promise<string | null> {
  const desk = await prisma.writingDeskDocument.findUnique({
    where: { masterOfProfileId: profileId },
    select: { profileId: true, content: true },
  })
  if (desk && desk.profileId === profileId) return desk.content.trim() ? desk.content : null
  const legacy = await loadLegacyMasterCv(profileId)
  return legacy?.markdown.trim() ? legacy.markdown : null
}

export type LandMasterCvResult =
  | { ok: true; deskId: string }
  | { ok: false; reason: "draft_exists"; deskId: string; message: string }
  | { ok: false; reason: "invalid"; issues: DraftIssue[]; message: string }

/**
 * Lands a generated master CV as a DRAFT of the master CV document (creating
 * the document first when needed). The live document is never overwritten:
 * the owner accepts or discards the draft in the editor, as with a job CV.
 * A draft already waiting is never replaced.
 */
export async function landMasterCvDraft(profileId: string, markdown: string): Promise<LandMasterCvResult> {
  const validation = validateDraftMarkdown(markdown)
  if (!validation.ok) {
    return { ok: false, reason: "invalid", issues: validation.issues, message: "The generated master CV failed validation." }
  }

  const deskId = await ensureMasterCvDesk(profileId)
  const written = await prisma.$transaction(async tx => {
    const updated = await tx.writingDeskDocument.updateMany({
      where: { id: deskId, profileId, draftContent: null },
      data: { draftContent: markdown, draftRevision: { increment: 1 }, draftUpdatedAt: new Date(), documentType: "cv" },
    })
    if (updated.count === 0) return false
    // A draft's history starts at create_draft (queries.ts currentDraftEvents).
    await tx.writingDeskDraftEvent.create({ data: { writingDeskId: deskId, apiTokenId: null, tool: "create_draft" } })
    return true
  })
  if (!written) {
    return {
      ok: false,
      reason: "draft_exists",
      deskId,
      message: "A master CV draft is already waiting for review. Accept or discard it first.",
    }
  }
  return { ok: true, deskId }
}
