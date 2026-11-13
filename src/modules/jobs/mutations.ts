'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import * as z from 'zod'
import { createJobSchema, updateJobSchema } from './schema'
import {
  ApplicationProgress,
  ApplicationStatus,
  type ApplicationProgressType,
  type ApplicationStatusType,
} from '@/app/types/job-application'
import type { Job } from '@/app/types/job-application'
import { requireProfile } from '@/lib/session'
import { getArchivedJobs } from './queries'
import { assessmentMaybeEnabled, queueJobAssessmentSafely } from '@/modules/job-assessment/queue'
import { linkJobCompany } from '@/modules/companies/match'
import { acceptLatestCVForAppliedJob } from '@/modules/cv/acceptance'

// Progress stages in funnel order. Used to compute "everything before stage X"
// for the auto-advance logic below.
const PROGRESS_ORDER = Object.values(ApplicationProgress)

// Declarative status → workflow rules. Adding a new status (or changing the
// auto-advance floor) is now a one-line edit instead of another if-arm.
//   minProgress: floor to bump progress to (never rewinds further-along jobs)
//   setDateApplied: backfill dateApplied if it's still null
//   acceptLatestCv: the job has been applied for, so accept its most recent
//                   draft CV if none is accepted yet (see modules/cv/acceptance)
type StatusTransition = {
  minProgress?: ApplicationProgressType
  setDateApplied?: boolean
  acceptLatestCv?: boolean
}
const STATUS_TRANSITIONS: Record<ApplicationStatusType, StatusTransition> = {
  [ApplicationStatus.NotStarted]: {},
  [ApplicationStatus.InProgress]: { minProgress: ApplicationProgress.Preparing },
  [ApplicationStatus.Applied]: {
    minProgress: ApplicationProgress.Pending,
    setDateApplied: true,
    acceptLatestCv: true,
  },
  [ApplicationStatus.Interviewing]: {
    minProgress: ApplicationProgress.Recruiter,
    setDateApplied: true,
    acceptLatestCv: true,
  },
  [ApplicationStatus.Accepted]: { minProgress: ApplicationProgress.Offer },
  [ApplicationStatus.Rejected]: {},
}

export async function createJobApplication(data: z.infer<typeof createJobSchema>) {
  const { profile } = await requireProfile()
  // Runtime parse: a hand-made call can't set other columns, and blanks are trimmed.
  const v = createJobSchema.parse(data)
  const countries = v.location
    ? v.location.split(',').map(s => s.trim()).filter(Boolean)
    : []
  const job = await prisma.jobApplication.create({
    data: {
      title: v.title,
      company: v.company || null,
      url: v.url || null,
      jobNumber: v.jobNumber || null,
      salaryBand: v.salaryBand || null,
      jobDescription: v.jobDescription?.trim() ? v.jobDescription : null,
      datePublished: v.datePublished ?? null,
      applicationSource: v.applicationSource,
      isRecruitmentAgency: v.isRecruitmentAgency ?? false,
      recruiterName: v.isRecruitmentAgency ? v.recruiterName || null : null,
      countries,
      profileId: profile.id,
    },
  })
  await linkJobCompany(profile.id, job.id)
  await queueJobAssessmentSafely(profile.id, job.id, { reason: 'created' })
  revalidatePath('/dashboard/job-applications')
  return job
}

// Fields the early assessment reads: a change to any of them re-runs it.
type AssessedFields = {
  title: string
  company: string | null
  jobDescription: string | null
  countries: string[]
  salaryBand: string | null
}

function assessedFieldsChanged(current: AssessedFields, payload: Record<string, unknown>): boolean {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const sent = (k: keyof AssessedFields) => payload[k] !== undefined
  if (sent('title') && text(payload.title) !== text(current.title)) return true
  if (sent('company') && text(payload.company) !== text(current.company)) return true
  if (sent('jobDescription') && text(payload.jobDescription) !== text(current.jobDescription)) return true
  if (sent('salaryBand') && text(payload.salaryBand) !== text(current.salaryBand)) return true
  if (sent('countries') && (payload.countries as string[]).join('|') !== current.countries.join('|')) return true
  return false
}

export async function updateJobDate(id: string, date: Date) {
  const { profile } = await requireProfile()

  const result = await prisma.jobApplication.updateMany({
    where: { id, profileId: profile.id },
    data: { dateApplied: date },
  })
  if (result.count === 0) throw new Error('Job not found')

  revalidatePath('/dashboard/job-applications')
  revalidatePath(`/dashboard/job-applications/view/${id}`)
}

export async function updateJobStatus(id: string, status: ApplicationStatusType) {
  const { profile } = await requireProfile()
  const transition = STATUS_TRANSITIONS[status]

  const result = await prisma.jobApplication.updateMany({
    where: { id, profileId: profile.id },
    data: { status },
  })
  if (result.count === 0) throw new Error('Job not found')

  // Backfill applied date the first time the job enters the pipeline.
  if (transition.setDateApplied) {
    await prisma.jobApplication.updateMany({
      where: { id, profileId: profile.id, dateApplied: null },
      data: { dateApplied: new Date() },
    })
  }

  // Best effort: a failure here must not undo or fail the status change.
  if (transition.acceptLatestCv) {
    try {
      const acceptedCvId = await acceptLatestCVForAppliedJob(profile.id, id)
      if (acceptedCvId) revalidatePath(`/dashboard/cv-builder/${acceptedCvId}`)
    } catch (err) {
      console.error('[updateJobStatus] could not accept the latest CV', err)
    }
  }

  // Auto-advance progress to the floor for this status. The `progress in [stages before]`
  // filter is the "never rewind" guarantee — jobs already further along stay put.
  if (transition.minProgress) {
    const stagesBefore = PROGRESS_ORDER.slice(0, PROGRESS_ORDER.indexOf(transition.minProgress))
    if (stagesBefore.length > 0) {
      await prisma.jobApplication.updateMany({
        where: { id, profileId: profile.id, progress: { in: stagesBefore } },
        data: { progress: transition.minProgress },
      })
    }
  }

  revalidatePath('/dashboard/job-applications')
  revalidatePath(`/dashboard/job-applications/view/${id}`)
}

export async function updateJobProgress(id: string, progress: ApplicationProgressType) {
  const { profile } = await requireProfile()

  const result = await prisma.jobApplication.updateMany({
    where: { id, profileId: profile.id },
    data: { progress },
  })
  if (result.count === 0) throw new Error('Job not found')

  revalidatePath('/dashboard/job-applications')
  revalidatePath(`/dashboard/job-applications/view/${id}`)
}

export async function updateJobApplication(
  id: string,
  data: z.infer<typeof updateJobSchema>,
): Promise<{ staleFitData: boolean }> {
  const { profile } = await requireProfile()
  const validated = updateJobSchema.parse(data)

  const { location, url, salaryBand, jobDescription, recruiterName, ...rest } = validated
  const payload: Record<string, unknown> = { ...rest }
  if (url !== undefined) payload.url = url || null
  if (location !== undefined) {
    payload.countries = location
      ? location.split(',').map(s => s.trim()).filter(Boolean)
      : []
  }
  if (salaryBand !== undefined) payload.salaryBand = salaryBand || null
  if (jobDescription !== undefined) payload.jobDescription = jobDescription
  if (recruiterName !== undefined) payload.recruiterName = recruiterName || null

  // The trigger's change detection needs the current values; skip the read
  // entirely when the assessment can't run (env/flag, no DB) and the stale
  // fit check doesn't need it either.
  const checkAssessedFields = assessmentMaybeEnabled() &&
    ['title', 'company', 'jobDescription', 'countries', 'salaryBand'].some(k => payload[k] !== undefined)

  // Read the current values once: for the stale fit/analysis check and to see
  // whether a field the early assessment reads actually changed.
  const current = jobDescription !== undefined || checkAssessedFields
    ? await prisma.jobApplication.findFirst({
        where: { id, profileId: profile.id },
        select: {
          title: true, company: true, jobDescription: true, countries: true, salaryBand: true,
          jobFit: true, jobAnalysis: true,
        },
      })
    : null

  // Check for stale fit/analysis data before updating
  let staleFitData = false
  if (
    jobDescription !== undefined &&
    current &&
    current.jobDescription !== jobDescription &&
    (current.jobFit !== null || current.jobAnalysis !== null)
  ) {
    staleFitData = true
  }

  const result = await prisma.jobApplication.updateMany({
    where: { id, profileId: profile.id },
    data: payload,
  })
  if (result.count === 0) throw new Error('Job not found')

  if (payload.company !== undefined) await linkJobCompany(profile.id, id)

  if (checkAssessedFields && current && assessedFieldsChanged(current, payload)) {
    await queueJobAssessmentSafely(profile.id, id, { reason: 'edited' })
  }

  revalidatePath('/dashboard/job-applications')
  revalidatePath(`/dashboard/job-applications/view/${id}`)

  return { staleFitData }
}

export async function archiveJobApplication(id: string) {
  const { profile } = await requireProfile()

  const result = await prisma.jobApplication.updateMany({
    where: { id, profileId: profile.id },
    data: { archivedAt: new Date() },
  })
  if (result.count === 0) throw new Error('Job not found')

  revalidatePath('/dashboard/job-applications')
  revalidatePath(`/dashboard/job-applications/view/${id}`)
}

export async function updateJobSalaryBand(id: string, salaryBand: string | null) {
  const { profile } = await requireProfile()

  // Only the trigger needs the previous value: skip the read when it can't run.
  const current = assessmentMaybeEnabled()
    ? await prisma.jobApplication.findFirst({
        where: { id, profileId: profile.id },
        select: { salaryBand: true },
      })
    : null

  const result = await prisma.jobApplication.updateMany({
    where: { id, profileId: profile.id },
    data: { salaryBand },
  })
  if (result.count === 0) throw new Error('Job not found')

  if (current && (current.salaryBand ?? '').trim() !== (salaryBand ?? '').trim()) {
    await queueJobAssessmentSafely(profile.id, id, { reason: 'salary' })
  }

  revalidatePath('/dashboard/job-applications')
  revalidatePath(`/dashboard/job-applications/view/${id}`)
}

export async function updateJobNotes(id: string, notes: string, includeInFit: boolean) {
  const { profile } = await requireProfile()
  const trimmed = notes.trim()

  const result = await prisma.jobApplication.updateMany({
    where: { id, profileId: profile.id },
    data: {
      notes: trimmed || null,
      notesIncludeInFit: trimmed ? includeInFit : false,
    },
  })
  if (result.count === 0) throw new Error('Job not found')

  revalidatePath('/dashboard/job-applications')
  revalidatePath(`/dashboard/job-applications/view/${id}`)
}

export async function bulkArchiveJobApplications(ids: string[]) {
  if (ids.length === 0) return { archived: 0 }
  const { profile } = await requireProfile()

  const result = await prisma.jobApplication.updateMany({
    where: { id: { in: ids }, profileId: profile.id },
    data: { archivedAt: new Date() },
  })

  revalidatePath('/dashboard/job-applications')
  return { archived: result.count }
}

export async function restoreJobApplication(id: string): Promise<void> {
  const { profile } = await requireProfile()
  await prisma.jobApplication.update({
    where: { id, profileId: profile.id },
    data: { archivedAt: null },
  })
  revalidatePath('/dashboard/job-applications')
  revalidatePath(`/dashboard/job-applications/view/${id}`)
}

export async function bulkRestoreJobApplications(ids: string[]) {
  if (ids.length === 0) return { restored: 0 }
  const { profile } = await requireProfile()
  const result = await prisma.jobApplication.updateMany({
    where: { id: { in: ids }, profileId: profile.id, archivedAt: { not: null } },
    data: { archivedAt: null },
  })
  revalidatePath('/dashboard/job-applications')
  return { restored: result.count }
}

export async function getArchivedJobsAction(): Promise<Job[]> {
  return getArchivedJobs()
}
