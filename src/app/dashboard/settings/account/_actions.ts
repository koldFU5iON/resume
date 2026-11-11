'use server'

import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/session'

export async function updateNameAction(name: string): Promise<{ error?: string }> {
  try {
    await auth.api.updateUser({
      headers: await headers(),
      body: { name: name.trim() },
    })
    return {}
  } catch {
    return { error: 'Failed to update name. Please try again.' }
  }
}

export async function changePasswordAction(
  currentPassword: string,
  newPassword: string,
): Promise<{ error?: string }> {
  try {
    await auth.api.changePassword({
      headers: await headers(),
      body: { currentPassword, newPassword, revokeOtherSessions: false },
    })
    return {}
  } catch (err: unknown) {
    const message =
      err instanceof Error && err.message.toLowerCase().includes('invalid')
        ? 'Current password is incorrect.'
        : 'Failed to change password. Please try again.'
    return { error: message }
  }
}

export async function unlinkAccountAction(providerId: string): Promise<{ error?: string }> {
  try {
    // Better Auth 1.7 unlinks by the account row id, and only among the
    // signed-in user's own accounts. Resolve it from the provider here.
    const session = await requireSession()
    const account = await prisma.account.findFirst({
      where: { userId: session.user.id, providerId },
      select: { id: true },
    })
    if (!account) return { error: 'That sign-in method is not linked.' }
    await auth.api.unlinkAccount({
      headers: await headers(),
      body: { accountId: account.id },
    })
    return {}
  } catch (err: unknown) {
    const message =
      err instanceof Error && err.message.toLowerCase().includes('last')
        ? 'Cannot remove your only sign-in method.'
        : 'Failed to unlink account. Please try again.'
    return { error: message }
  }
}
