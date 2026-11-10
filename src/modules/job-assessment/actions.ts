'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { startBackfill, type BackfillStart } from './backfill'
import { isAssessmentEnabledFor, queueJobAssessment } from './queue'

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

/**
 * Queues the next backfill batch of the signed-in user's "not started" jobs
 * (backfill.ts). Refused while runs are pending, so batches don't stack.
 */
export async function startAssessmentBackfill(): Promise<BackfillStart> {
  const requestStartedAt = Date.now()
  const { profile } = await requireProfile()
  if (!(await isAssessmentEnabledFor(profile.id))) return { ok: false, error: 'Early assessment is not enabled' }

  let result: BackfillStart
  try {
    result = await startBackfill(profile.id, { requestStartedAt })
  } catch {
    return { ok: false, error: 'Could not start the assessments. Try again.' }
  }

  if (result.ok && result.queued > 0) {
    revalidatePath('/dashboard/job-applications')
    revalidatePath('/dashboard/settings')
  }
  return result
}
