'use server'

import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/session'
import {
  createApiToken as createApiTokenInternal,
  listApiTokens as listApiTokensInternal,
  revokeApiToken as revokeApiTokenInternal,
  type ApiTokenScope,
  type CreatedToken,
  type ApiTokenSummary,
} from './service'

// Client-callable wrappers for the API tokens UI. Each wraps the internal
// service with the current user's profile so callers can't smuggle in a
// foreign profileId.

export async function createApiTokenAction(
  name: string,
  scopes?: ApiTokenScope[],
  expiresInDays?: number | null,
): Promise<CreatedToken> {
  const { profile } = await requireProfile()
  const expiresAt =
    expiresInDays && expiresInDays > 0
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null
  const result = await createApiTokenInternal(profile.id, name, { scopes, expiresAt })
  revalidatePath('/dashboard/settings/api-tokens')
  return result
}

export async function listApiTokensAction(): Promise<ApiTokenSummary[]> {
  const { profile } = await requireProfile()
  return listApiTokensInternal(profile.id)
}

export async function revokeApiTokenAction(tokenId: string): Promise<void> {
  const { profile } = await requireProfile()
  await revokeApiTokenInternal(profile.id, tokenId)
  revalidatePath('/dashboard/settings/api-tokens')
}
