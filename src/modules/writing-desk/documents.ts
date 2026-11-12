// A job's Writing Desk documents (#370): creation and primary-document
// resolution.
//
// Session-free: every function takes the caller's profileId first and scopes
// every query by it; Server Actions and routes pass the session's profile.
//
// A job can hold several documents, ordered oldest first by (createdAt, id).
// The first is the job's primary document: job-scoped links (the old
// /writing URL, the old PDF URL) resolve to it, and for jobs migrated from
// the one-desk-per-job model it is the desk they already had.
//
// Creating a document takes a per-job advisory lock, so two first visits
// can't both create a "first" document and the per-job cap holds. Agent draft
// resolution (draft.ts) takes the same lock.

import { prisma } from "@/lib/db"
import { toMarkdown } from "@/modules/cv/export"
import { parseCVContent } from "@/modules/cv/schema"
import {
  CreateWritingDeskDocumentSchema,
  DEFAULT_WRITING_DESK_DOCUMENT_NAME,
  MAX_WRITING_DESK_DOCUMENTS_PER_JOB,
  RenameWritingDeskDocumentSchema,
  WRITING_DESK_DOCUMENT_ORDER,
  type CreateWritingDeskDocumentResult,
  type RenameWritingDeskDocumentResult,
  type WritingDeskSourceType,
} from "./schema"

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

export function jobDocumentsLockKey(jobId: string): string {
  return `writing-desk-documents:${jobId}`
}

/** Serialises document creation and agent resolution for one job until the transaction ends. */
export async function lockJobDocuments(tx: Tx, jobId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${jobDocumentsLockKey(jobId)}))`
}

export async function findOwnedJob(profileId: string, jobId: string): Promise<{ id: string } | null> {
  return prisma.jobApplication.findFirst({ where: { id: jobId, profileId }, select: { id: true } })
}

type SourceCvLabelFields = {
  jobApplicationId: string | null
  careerVerticalId: string | null
  jobTitle: string | null
  company: string | null
  updatedAt: Date
}

export function getWritingDeskSourceLabel(cv: SourceCvLabelFields): string {
  if (cv.jobApplicationId === null && cv.careerVerticalId !== null) return "Master CV"
  if (cv.jobTitle && cv.company) return `CV - ${cv.jobTitle} at ${cv.company}`
  if (cv.jobTitle) return `CV - ${cv.jobTitle}`
  return `CV - ${cv.updatedAt.toLocaleDateString("en-GB")}`
}

export type WritingDeskSource = {
  content: string
  sourceType: Exclude<WritingDeskSourceType, "blank">
  sourceCvDocumentId: string
  sourceLabel: string
}

/** A CV of this profile as a document source, or null when it isn't theirs (or doesn't exist). */
export async function loadSourceCv(profileId: string, cvId: string): Promise<WritingDeskSource | null> {
  const cv = await prisma.cVDocument.findFirst({
    where: { id: cvId, profileId },
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
  if (!cv) return null
  return {
    content: toMarkdown(parseCVContent(cv.generatedContent)),
    sourceType: cv.jobApplicationId === null && cv.careerVerticalId !== null ? "master-cv" : "previous-cv",
    sourceCvDocumentId: cv.id,
    sourceLabel: getWritingDeskSourceLabel(cv),
  }
}

/**
 * Creates a named document on one of the profile's jobs, blank or from one of
 * their CVs. Never replaces or touches another document. Input is validated
 * here, at the boundary, whatever the caller.
 */
export async function createWritingDeskDocument(
  profileId: string,
  input: unknown,
): Promise<CreateWritingDeskDocumentResult> {
  const parsed = CreateWritingDeskDocumentSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid document" }
  }
  const { jobId, name, documentType, sourceCvId } = parsed.data

  const job = await findOwnedJob(profileId, jobId)
  if (!job) return { ok: false, reason: "job_not_found", message: "Job not found." }

  const source = sourceCvId === null ? null : await loadSourceCv(profileId, sourceCvId)
  if (sourceCvId !== null && !source) return { ok: false, reason: "source_not_found", message: "Source CV not found." }

  return prisma.$transaction(async (tx): Promise<CreateWritingDeskDocumentResult> => {
    await lockJobDocuments(tx, job.id)
    const count = await tx.writingDeskDocument.count({ where: { profileId, jobApplicationId: job.id } })
    if (count >= MAX_WRITING_DESK_DOCUMENTS_PER_JOB) {
      return { ok: false, reason: "limit", message: `A job can hold up to ${MAX_WRITING_DESK_DOCUMENTS_PER_JOB} documents.` }
    }
    const created = await tx.writingDeskDocument.create({
      data: {
        profileId,
        jobApplicationId: job.id,
        name,
        documentType,
        ...(source ?? { sourceType: "blank", sourceCvDocumentId: null, sourceLabel: "Blank document" }),
      },
      select: { id: true },
    })
    return { ok: true, id: created.id }
  })
}

/**
 * Renames one of the profile's documents. The name is metadata, not content:
 * it doesn't bump the revision, so a rename never conflicts with an edit
 * that is saving at the same time. Returns the stored (trimmed) name.
 */
export async function renameWritingDeskDocument(
  profileId: string,
  input: unknown,
): Promise<RenameWritingDeskDocumentResult> {
  const parsed = RenameWritingDeskDocumentSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, reason: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid name" }
  }
  const { documentId, name } = parsed.data
  const updated = await prisma.writingDeskDocument.updateMany({
    where: { id: documentId, profileId },
    data: { name },
  })
  if (updated.count === 0) return { ok: false, reason: "not_found", message: "Document not found." }
  return { ok: true, name }
}

/**
 * The job's primary (oldest) document, creating an unnamed blank one when the
 * job has none yet. Null when the job isn't the profile's. Backs the
 * job-scoped /writing URL, which has always opened (and created) the job's desk.
 */
export async function ensurePrimaryWritingDesk(profileId: string, jobId: string): Promise<{ id: string } | null> {
  const job = await findOwnedJob(profileId, jobId)
  if (!job) return null

  const existing = await getPrimaryWritingDeskId(profileId, job.id)
  if (existing) return { id: existing }

  return prisma.$transaction(async tx => {
    await lockJobDocuments(tx, job.id)
    const first = await tx.writingDeskDocument.findFirst({
      where: { profileId, jobApplicationId: job.id },
      orderBy: WRITING_DESK_DOCUMENT_ORDER,
      select: { id: true },
    })
    if (first) return first
    return tx.writingDeskDocument.create({
      data: { profileId, jobApplicationId: job.id, name: DEFAULT_WRITING_DESK_DOCUMENT_NAME },
      select: { id: true },
    })
  })
}

/** The job's primary (oldest) document id, or null. Read-only; scoped to the profile. */
export async function getPrimaryWritingDeskId(profileId: string, jobId: string): Promise<string | null> {
  const first = await prisma.writingDeskDocument.findFirst({
    where: { profileId, jobApplicationId: jobId },
    orderBy: WRITING_DESK_DOCUMENT_ORDER,
    select: { id: true },
  })
  return first?.id ?? null
}
