'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { queueJobAssessment } from './queue'

export type RerunResult = { ok: true } | { ok: false; error: string }

/** Re-runs the early assessment of one of the signed-in user's jobs. */
export async function rerunJobAssessment(jobId: string): Promise<RerunResult> {
  const { profile } = await requireProfile()

  const job = await prisma.jobApplication.findFirst({
    where: { id: jobId, profileId: profile.id },
    select: { id: true },
  })
  if (!job) return { ok: false, error: 'Job not found' }

  try {
    const result = await queueJobAssessment(profile.id, job.id, { reason: 'manual' })
    if (!result.queued) {
      return { ok: false, error: result.reason === 'disabled' ? 'Early assessment is not enabled' : 'Job not found' }
    }
  } catch {
    return { ok: false, error: 'Could not start the assessment — try again' }
  }

  revalidatePath('/dashboard/job-applications')
  revalidatePath(`/dashboard/job-applications/view/${job.id}`)
  return { ok: true }
}
