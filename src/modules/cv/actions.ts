'use server'

import { requireProfile } from '@/lib/session'
import { revalidatePath } from 'next/cache'
import { acceptCV, unacceptCV } from './acceptance'

const ACCEPT_ERRORS = {
  not_found: 'CV not found',
  no_job: 'Only a CV for a job can be accepted.',
  not_ready: 'This CV is not ready to accept yet.',
  already_accepted: 'This CV is already accepted.',
} as const

/** Marks a job CV as accepted (the one used to apply). */
export async function markCVAccepted(cvId: string): Promise<{ acceptedAt: Date }> {
  const { profile } = await requireProfile()
  const res = await acceptCV(profile.id, cvId)
  if (!res.ok) throw new Error(ACCEPT_ERRORS[res.reason])
  revalidatePath(`/dashboard/cv-builder/${cvId}`)
  revalidatePath('/dashboard/cv-builder')
  return { acceptedAt: res.acceptedAt }
}

/** Undoes an acceptance: the CV goes back to draft. */
export async function unmarkCVAccepted(cvId: string): Promise<void> {
  const { profile } = await requireProfile()
  if (!(await unacceptCV(profile.id, cvId))) throw new Error('This CV is not accepted.')
  revalidatePath(`/dashboard/cv-builder/${cvId}`)
  revalidatePath('/dashboard/cv-builder')
}
