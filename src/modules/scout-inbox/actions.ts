'use server'

import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/session'
import { createScoutInvite, revokeScoutInvite } from './service'

export async function createScoutInviteAction(name: string) {
  const { profile } = await requireProfile()
  const invite = await createScoutInvite(profile.id, name)
  revalidatePath('/dashboard/job-hunt')
  return invite
}

export async function revokeScoutInviteAction(inviteId: string) {
  const { profile } = await requireProfile()
  await revokeScoutInvite(profile.id, inviteId)
  revalidatePath('/dashboard/job-hunt')
}
