'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import { revokeMcpConnection } from './connections'

export async function disconnectMcpAction(clientId: string) {
  const session = await requireSession()
  await revokeMcpConnection(session.user.id, clientId)
  revalidatePath('/dashboard/settings/api-tokens')
}
