'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { extractJobFromUrl } from './extract'
import { queueJobAssessmentSafely } from '@/modules/job-assessment/queue'

export type QuickCaptureResult =
  | { ok: true; jobId: string; title: string; company: string | null; duplicate: boolean }
  | { ok: false; error: string }

export async function quickCaptureJob(rawUrl: string): Promise<QuickCaptureResult> {
  const url = rawUrl.trim()
  if (!url) return { ok: false, error: 'URL is required' }

  const { profile } = await requireProfile()

  const existing = await prisma.jobApplication.findFirst({
    where: { profileId: profile.id, url },
    select: { id: true, title: true, company: true },
  })
  if (existing) {
    return { ok: true, jobId: existing.id, title: existing.title, company: existing.company ?? null, duplicate: true }
  }

  const extraction = await extractJobFromUrl(url)
  if (!extraction.ok) return { ok: false, error: extraction.error }

  const title   = extraction.data.title?.trim()
  const company = extraction.data.company?.trim()
  if (!title || !company) {
    return { ok: false, error: 'Could not extract title and company — fill in manually' }
  }

  const countries = extraction.data.location
    ? extraction.data.location.split(',').map(s => s.trim()).filter(Boolean)
    : []

  const job = await prisma.jobApplication.create({
    data: {
      profileId: profile.id,
      url,
      title,
      company,
      countries,
      jobDescription: extraction.data.jobDescription ?? null,
      jobNumber:      extraction.data.jobNumber      ?? null,
      datePublished:  extraction.data.datePublished  ?? null,
      salaryBand:     extraction.data.salaryBand     ?? null,
      applicationSource: 'cold',
    },
    select: { id: true, title: true, company: true },
  })

  await queueJobAssessmentSafely(profile.id, job.id, { reason: 'quick-capture' })

  revalidatePath('/dashboard/job-applications')
  return { ok: true, jobId: job.id, title: job.title, company: job.company ?? null, duplicate: false }
}
