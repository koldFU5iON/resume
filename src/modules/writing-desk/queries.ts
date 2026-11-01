import { prisma } from "@/lib/db"
import type { ApplicationStatusType } from "@/app/types/job-application"
import { buildProfileSnapshot } from "@/modules/profile/snapshot"
import { listDraftEvents } from "./draft"
import { checkFacts, type FactWarning } from "./fact-check"
import type { WritingDeskDocumentType } from "./schema"
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

function sourceLabel(cv: {
  jobApplicationId: string | null
  careerVerticalId: string | null
  jobTitle: string | null
  company: string | null
  updatedAt: Date
}): string {
  if (cv.jobApplicationId === null && cv.careerVerticalId !== null) return "Master CV"
  if (cv.jobTitle && cv.company) return `CV - ${cv.jobTitle} at ${cv.company}`
  if (cv.jobTitle) return `CV - ${cv.jobTitle}`
  return `CV - ${cv.updatedAt.toLocaleDateString("en-GB")}`
}

export function getWritingDeskSourceLabel(cv: Parameters<typeof sourceLabel>[0]): string {
  return sourceLabel(cv)
}

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

export async function getWritingDesk(
  profileId: string,
  jobApplicationId: string,
): Promise<WritingDeskWithJob | null> {
  const desk = await prisma.writingDeskDocument.findFirst({
    where: { profileId, jobApplicationId },
    select: {
      id: true,
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
    documentType: live.documentType as WritingDeskDocumentType | null,
    draft,
  }
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
    label: sourceLabel(cv),
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
  documentType: WritingDeskDocumentType | null
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
      writingDesk: {
        select: { documentType: true, updatedAt: true },
      },
    },
  })

  return jobs.map(job => ({
    id: job.id,
    title: job.title,
    company: job.company,
    status: job.status as ApplicationStatusType,
    documentType: (job.writingDesk?.documentType as WritingDeskDocumentType | null) ?? null,
    deskUpdatedAt: job.writingDesk?.updatedAt ?? null,
  }))
}
