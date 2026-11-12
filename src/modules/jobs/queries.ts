import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { ApplicationStatus, type ApplicationStatusType, type Job } from "@/app/types/job-application"
import { requireProfile } from "@/lib/session"
import { getEarlyAssessmentForJob, getEarlyAssessmentsForJobs } from "@/modules/job-assessment/queries"
import { getDeepDiveSummaries, getDeepDiveSummary, type DeepDiveSummary } from "@/modules/deep-dive/queries"

/**
 * The legacy JobFit as the UI shows it: hidden (null) once the job has a
 * complete deep dive, which replaces it (spec §10). Done here once so rows,
 * filters, sorts and the sidebar all agree.
 */
function visibleJobFit<T>(jobFit: T, deepDive: DeepDiveSummary | null | undefined): T | null {
  return deepDive?.hasReport ? null : jobFit
}

export type DashboardJobSlim = {
  id: string
  title: string
  company: string
  status: ApplicationStatusType
  lastUpdated: Date
}

export type DashboardStats = {
  totalActive: number
  byStatus: Partial<Record<ApplicationStatusType, number>>
  lastActivity: Date | null
  recentJobs: DashboardJobSlim[]
  staleJobs: DashboardJobSlim[]
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const { profile } = await requireProfile()
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [statusRows, recentRows, staleRows] = await Promise.all([
    prisma.jobApplication.findMany({
      where: { profileId: profile.id, archivedAt: null },
      select: { status: true, lastUpdated: true },
    }),
    prisma.jobApplication.findMany({
      where: { profileId: profile.id, archivedAt: null },
      orderBy: { lastUpdated: 'desc' },
      take: 4,
      select: { id: true, title: true, company: true, status: true, lastUpdated: true },
    }),
    prisma.jobApplication.findMany({
      where: {
        profileId: profile.id,
        archivedAt: null,
        OR: [
          { status: 'not started', lastUpdated: { lt: sevenDaysAgo } },
          { status: { in: ['in-progress', 'applied'] }, lastUpdated: { lt: fourteenDaysAgo } },
        ],
      },
      orderBy: { lastUpdated: 'asc' },
      take: 5,
      select: { id: true, title: true, company: true, status: true, lastUpdated: true },
    }),
  ])

  const byStatus = statusRows.reduce<Partial<Record<ApplicationStatusType, number>>>((acc, row) => {
    const s = row.status as ApplicationStatusType
    acc[s] = (acc[s] ?? 0) + 1
    return acc
  }, {})

  const lastActivity = statusRows.length > 0
    ? statusRows.reduce<Date>((latest, row) =>
        row.lastUpdated > latest ? row.lastUpdated : latest,
        statusRows[0].lastUpdated
      )
    : null

  return {
    totalActive: statusRows.length,
    byStatus,
    lastActivity,
    recentJobs: recentRows as DashboardJobSlim[],
    staleJobs: staleRows as DashboardJobSlim[],
  }
}

export async function getActiveJobs(): Promise<Job[]> {
  const { profile } = await requireProfile()
  const jobs = await prisma.jobApplication.findMany({
    where: { profileId: profile.id, archivedAt: null },
    orderBy: [{ dateApplied: { sort: 'desc', nulls: 'last' } }, { lastUpdated: 'desc' }],
    include: {
      cvDocuments: {
        select: { id: true },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
      coverLetters: {
        select: { id: true },
        take: 1,
        orderBy: { updatedAt: 'desc' },
      },
      interviewPrepSessions: {
        select: { id: true },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  // One more query for all jobs (not one per job); {} when the feature is off.
  const ids = jobs.map(j => j.id)
  const [early, deepDives] = await Promise.all([
    getEarlyAssessmentsForJobs(profile.id, ids),
    getDeepDiveSummaries(profile.id, ids),
  ])
  return jobs.map(j => ({
    ...j,
    cvDocumentId: j.cvDocuments[0]?.id ?? null,
    coverLetterDocumentId: j.coverLetters[0]?.id ?? null,
    interviewPrepSessionId: j.interviewPrepSessions[0]?.id ?? null,
    earlyAssessment: early[j.id] ?? null,
    deepDive: deepDives[j.id] ?? null,
    jobFit: visibleJobFit(j.jobFit, deepDives[j.id]),
  })) as Job[]
}

export type JobPickerOption = {
  id: string
  title: string
  company: string | null
  status: ApplicationStatusType
}

/** Slim list of non-archived jobs for linking to a cover letter. */
export async function listActiveJobsForPicker(profileId: string): Promise<JobPickerOption[]> {
  const jobs = await prisma.jobApplication.findMany({
    where: { profileId, archivedAt: null, status: { in: ['not started', 'in-progress'] } },
    orderBy: [{ dateApplied: { sort: 'desc', nulls: 'last' } }, { lastUpdated: 'desc' }],
    select: { id: true, title: true, company: true, status: true },
  })
  return jobs as JobPickerOption[]
}

export async function getJobApplicationById(id: string): Promise<Job | null> {
  const { profile } = await requireProfile()
  const [job, earlyAssessment, deepDive] = await Promise.all([prisma.jobApplication.findFirst({
    where: { id, profileId: profile.id },
    include: {
      cvDocuments: {
        select: { id: true },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
      coverLetters: {
        select: { id: true },
        take: 1,
        orderBy: { updatedAt: 'desc' },
      },
      interviewPrepSessions: {
        select: { id: true },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
  }), getEarlyAssessmentForJob(profile.id, id), getDeepDiveSummary(profile.id, id)])
  if (!job) return null
  return {
    ...job,
    cvDocumentId: job.cvDocuments[0]?.id ?? null,
    coverLetterDocumentId: job.coverLetters[0]?.id ?? null,
    interviewPrepSessionId: job.interviewPrepSessions[0]?.id ?? null,
    earlyAssessment,
    deepDive,
    jobFit: visibleJobFit(job.jobFit, deepDive),
  } as Job
}

export type JobAssets = {
  jobId: string
  company: string | null
  title: string
  /** The job ad's URL, when known. */
  url: string | null
  cvDocumentId: string | null
  coverLetterDocumentId: string | null
  interviewPrepSessionId: string | null
}

/** Lightweight query for the cross-tool nav bar. Returns null if not found or not owned by profileId. */
export async function getJobAssets(jobId: string, profileId: string): Promise<JobAssets | null> {
  const job = await prisma.jobApplication.findFirst({
    where: { id: jobId, profileId },
    select: {
      id: true,
      company: true,
      title: true,
      url: true,
      cvDocuments: {
        select: { id: true },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
      coverLetters: {
        select: { id: true },
        take: 1,
        orderBy: { updatedAt: 'desc' },
      },
      interviewPrepSessions: {
        select: { id: true },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  if (!job) return null
  return {
    jobId: job.id,
    company: job.company,
    title: job.title,
    url: job.url,
    cvDocumentId: job.cvDocuments[0]?.id ?? null,
    coverLetterDocumentId: job.coverLetters[0]?.id ?? null,
    interviewPrepSessionId: job.interviewPrepSessions[0]?.id ?? null,
  }
}

export type AgentJobInclude = 'active' | 'rejected' | 'archived' | 'all'

export type AgentJobSummary = {
  id: string
  title: string
  company: string | null
  status: ApplicationStatusType
  dateApplied: Date | null
  lastUpdated: Date
}

/**
 * Session-free job list for external agents (MCP). Always scoped to profileId.
 * - active:   not archived and not rejected (default)
 * - rejected: rejected and not archived
 * - archived: archived, any status
 * - all:      no status/archive filter
 */
export async function listJobsForAgent(
  profileId: string,
  opts: { include?: AgentJobInclude; company?: string },
): Promise<AgentJobSummary[]> {
  const include = opts.include ?? 'active'
  const where: Prisma.JobApplicationWhereInput = { profileId }

  if (include === 'active') {
    where.archivedAt = null
    where.status = { not: ApplicationStatus.Rejected }
  } else if (include === 'rejected') {
    where.archivedAt = null
    where.status = ApplicationStatus.Rejected
  } else if (include === 'archived') {
    where.archivedAt = { not: null }
  }

  const company = opts.company?.trim()
  if (company) where.company = { contains: company, mode: 'insensitive' }

  const jobs = await prisma.jobApplication.findMany({
    where,
    orderBy: { lastUpdated: 'desc' },
    select: { id: true, title: true, company: true, status: true, dateApplied: true, lastUpdated: true },
  })
  return jobs as AgentJobSummary[]
}

export type ActiveJobForNav = {
  id: string
  title: string
  company: string | null
  status: ApplicationStatusType
}

/** Slim list of interviewing/in-progress jobs for the cross-tool nav bar. */
export async function getActiveJobsForNav(profileId: string): Promise<ActiveJobForNav[]> {
  const jobs = await prisma.jobApplication.findMany({
    where: {
      profileId,
      archivedAt: null,
      status: { in: ['interviewing', 'in-progress'] },
    },
    orderBy: { lastUpdated: 'desc' },
    take: 10,
    select: { id: true, title: true, company: true, status: true },
  })
  return jobs as ActiveJobForNav[]
}

export async function getArchivedJobs(): Promise<Job[]> {
  const { profile } = await requireProfile()
  const jobs = await prisma.jobApplication.findMany({
    where: { profileId: profile.id, archivedAt: { not: null } },
    orderBy: [{ archivedAt: 'desc' }],
    include: {
      cvDocuments: {
        select: { id: true },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
      coverLetters: {
        select: { id: true },
        take: 1,
        orderBy: { updatedAt: 'desc' },
      },
      interviewPrepSessions: {
        select: { id: true },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  return jobs.map(j => ({
    ...j,
    cvDocumentId: j.cvDocuments[0]?.id ?? null,
    coverLetterDocumentId: j.coverLetters[0]?.id ?? null,
    interviewPrepSessionId: j.interviewPrepSessions[0]?.id ?? null,
  })) as Job[]
}
