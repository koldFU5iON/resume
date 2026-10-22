import { prisma } from "@/lib/db"
import type { ApplicationStatusType } from "@/app/types/job-application"
import type { WritingDeskDocumentType } from "./schema"

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
      jobApplication: {
        select: { id: true, title: true, company: true, jobDescription: true },
      },
    },
  })

  return desk as WritingDeskWithJob | null
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
