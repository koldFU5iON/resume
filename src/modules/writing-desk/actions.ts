"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireProfile } from "@/lib/session"
import { parseCVContent } from "@/modules/cv/schema"
import { toMarkdown } from "@/modules/cv/export"
import {
  WritingDeskContentSchema,
  WritingDeskDocumentTypeSchema,
  type WritingDeskDocumentType,
  type WritingDeskSaveResult,
} from "./schema"
import { getWritingDeskSourceLabel } from "./queries"

async function getOwnedDesk(id: string, profileId: string) {
  const desk = await prisma.writingDeskDocument.findFirst({
    where: { id, profileId },
    select: { id: true, jobApplicationId: true, revision: true, content: true },
  })
  if (!desk) throw new Error("Writing desk not found")
  return desk
}

async function conflictResult(id: string, profileId: string): Promise<WritingDeskSaveResult> {
  const desk = await getOwnedDesk(id, profileId)
  return { ok: false, reason: "conflict", revision: desk.revision, content: desk.content }
}

export async function getOrCreateWritingDesk(jobApplicationId: string): Promise<{ id: string }> {
  const { profile } = await requireProfile()
  const job = await prisma.jobApplication.findFirst({
    where: { id: jobApplicationId, profileId: profile.id },
    select: { id: true },
  })
  if (!job) throw new Error("Job not found")

  const desk = await prisma.writingDeskDocument.upsert({
    where: { jobApplicationId: job.id },
    update: {},
    create: { profileId: profile.id, jobApplicationId: job.id },
    select: { id: true },
  })
  return desk
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
  const desk = await getOwnedDesk(id, profile.id)
  revalidatePath(`/dashboard/job-applications/view/${desk.jobApplicationId}/writing`)
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
    const cv = await prisma.cVDocument.findFirst({
      where: { id: cvId, profileId: profile.id },
      select: {
        id: true,
        generatedContent: true,
        jobApplicationId: true,
        careerVerticalId: true,
        jobTitle: true,
        company: true,
        updatedAt: true,
      },
    })
    if (!cv) throw new Error("Source CV not found")
    data = {
      content: toMarkdown(parseCVContent(cv.generatedContent)),
      sourceType: cv.jobApplicationId === null && cv.careerVerticalId !== null ? "master-cv" : "previous-cv",
      sourceCvDocumentId: cv.id,
      sourceLabel: getWritingDeskSourceLabel(cv),
      revision: { increment: 1 },
    }
  }

  const updated = await prisma.writingDeskDocument.updateMany({
    where: { id, profileId: profile.id, revision: expectedRevision },
    data,
  })
  if (updated.count === 0) return conflictResult(id, profile.id)
  return { ok: true, revision: expectedRevision + 1 }
}
