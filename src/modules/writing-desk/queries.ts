import { prisma } from "@/lib/db"
import type { ApplicationStatusType } from "@/app/types/job-application"
import { buildProfileSnapshot } from "@/modules/profile/snapshot"
import { listDraftEvents } from "./draft"
import { checkFacts, type FactWarning } from "./fact-check"
import { getWritingDeskSourceLabel } from "./documents"
import {
  WRITING_DESK_DOCUMENT_ORDER,
  parseWritingDeskDocumentType,
  type WritingDeskDocumentSummary,
  type WritingDeskDocumentType,
} from "./schema"
import { validateDraftMarkdown, type DraftIssue } from "./validate"

/** How many agent draft events the review screen lists. */
const DRAFT_HISTORY_LIMIT = 10

export type WritingDeskSourceOption = {
  id: string
  label: string
  sourceType: "previous-cv" | "master-cv"
}

export type WritingDeskWithJob = {
  id: string
  name: string
  content: string
  revision: number
  documentType: WritingDeskDocumentType | null
  sourceType: string | null
  sourceCvDocumentId: string | null
  sourceLabel: string | null
  jobApplication: {
    id: string
    title: string
    company: string | null
    jobDescription: string | null
  }
  /** The pending agent draft awaiting the owner's review, or null. */
  draft: {
    content: string
    draftRevision: number
    updatedAt: Date
    warnings: FactWarning[]
    issues: DraftIssue[]
    events: Array<{ tool: string; createdAt: Date }>
  } | null
}

/** Re-exported for existing callers; defined beside the source loader. */
export { getWritingDeskSourceLabel }

/**
 * Events are logged per desk, so earlier (accepted or discarded) drafts share
 * the log. Every draft starts with create_draft, so newest-first, the pending
 * draft's history ends at the first create_draft.
 */
function currentDraftEvents(events: Array<{ tool: string; createdAt: Date }>) {
  const start = events.findIndex(event => event.tool === "create_draft")
  const current = start === -1 ? events : events.slice(0, start + 1)
  return current.map(event => ({ tool: event.tool, createdAt: event.createdAt }))
}

/**
 * One document, addressed by id. It must belong to the profile AND to the
 * given job, so a document id can't be read through another job's URL.
 */
export async function getWritingDeskDocument(
  profileId: string,
  jobApplicationId: string,
  documentId: string,
): Promise<WritingDeskWithJob | null> {
  const desk = await prisma.writingDeskDocument.findFirst({
    where: { id: documentId, profileId, jobApplicationId },
    select: {
      id: true,
      name: true,
      content: true,
      revision: true,
      documentType: true,
      sourceType: true,
      sourceCvDocumentId: true,
      sourceLabel: true,
      draftContent: true,
      draftRevision: true,
      draftUpdatedAt: true,
      updatedAt: true,
      jobApplication: {
        select: { id: true, title: true, company: true, jobDescription: true },
      },
    },
  })
  if (!desk) return null

  const { draftContent, draftRevision, draftUpdatedAt, updatedAt, ...live } = desk
  let draft: WritingDeskWithJob["draft"] = null
  if (draftContent !== null) {
    const [profile, events] = await Promise.all([
      buildProfileSnapshot(profileId),
      listDraftEvents(profileId, desk.id, DRAFT_HISTORY_LIMIT),
    ])
    draft = {
      content: draftContent,
      draftRevision,
      updatedAt: draftUpdatedAt ?? updatedAt,
      warnings: checkFacts(draftContent, profile),
      issues: validateDraftMarkdown(draftContent).issues,
      events: currentDraftEvents(events),
    }
  }

  return {
    ...live,
    documentType: parseWritingDeskDocumentType(live.documentType),
    draft,
  }
}

/** The job's documents, primary (oldest) first. Empty when the job has none or isn't the profile's. */
export async function listWritingDeskDocuments(
  profileId: string,
  jobApplicationId: string,
): Promise<WritingDeskDocumentSummary[]> {
  const docs = await prisma.writingDeskDocument.findMany({
    where: { profileId, jobApplicationId },
    orderBy: WRITING_DESK_DOCUMENT_ORDER,
    select: { id: true, name: true, documentType: true, draftContent: true, createdAt: true, updatedAt: true },
  })
  return docs.map(({ draftContent, documentType, ...doc }) => ({
    ...doc,
    documentType: parseWritingDeskDocumentType(documentType),
    hasDraft: draftContent !== null,
  }))
}

export async function listWritingDeskSourceCVs(profileId: string): Promise<WritingDeskSourceOption[]> {
  const cvs = await prisma.cVDocument.findMany({
    where: { profileId, status: { not: "generating" } },
    select: {
      id: true,
      jobApplicationId: true,
      careerVerticalId: true,
      jobTitle: true,
      company: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  })

  return cvs.map(cv => ({
    id: cv.id,
    label: getWritingDeskSourceLabel(cv),
    sourceType: cv.jobApplicationId === null && cv.careerVerticalId !== null
      ? "master-cv"
      : "previous-cv",
  }))
}

export type WritingDeskJobOption = {
  id: string
  title: string
  company: string | null
  status: ApplicationStatusType
  /** The primary document's type. */
  documentType: WritingDeskDocumentType | null
  documentCount: number
  /** When any of the job's documents last changed. */
  deskUpdatedAt: Date | null
}

/** Non-archived jobs with a summary of their writing desk, for the desk picker. */
export async function listWritingDeskJobs(profileId: string): Promise<WritingDeskJobOption[]> {
  const jobs = await prisma.jobApplication.findMany({
    where: { profileId, archivedAt: null },
    orderBy: { lastUpdated: "desc" },
    select: {
      id: true,
      title: true,
      company: true,
      status: true,
      lastUpdated: true,
      writingDesks: {
        select: { documentType: true, updatedAt: true },
        orderBy: WRITING_DESK_DOCUMENT_ORDER,
      },
    },
  })

  return jobs.map(job => ({
    id: job.id,
    title: job.title,
    company: job.company,
    status: job.status as ApplicationStatusType,
    documentType: parseWritingDeskDocumentType(job.writingDesks[0]?.documentType ?? null),
    documentCount: job.writingDesks.length,
    deskUpdatedAt: job.writingDesks.reduce<Date | null>(
      (latest, doc) => (latest === null || doc.updatedAt > latest ? doc.updatedAt : latest),
      null,
    ),
  }))
}
