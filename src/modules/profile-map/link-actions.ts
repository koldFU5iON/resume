'use server'

// Owner-side Server Actions for evidence links. Thin wrappers: the profile
// always comes from the session, never from the client.

import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/session'
import { LLMError, type LLMErrorKind } from '@/modules/llm/errors'
import {
  addCapabilityWithEvidence,
  confirmLinks,
  rejectLinks,
  suggestLinks,
  type LinkPair,
  type SuggestResult,
} from './link-store'
import type { CapabilityKind } from './types'

const PROFILE_PAGE = '/dashboard/profile'

export async function suggestEvidenceLinksAction(): Promise<
  ({ ok: true } & SuggestResult) | { ok: false; error: LLMErrorKind; message: string }
> {
  const { profile } = await requireProfile()
  try {
    const result = await suggestLinks(profile.id)
    revalidatePath(PROFILE_PAGE)
    return { ok: true, ...result }
  } catch (err) {
    if (err instanceof LLMError) return { ok: false, error: err.kind, message: err.message }
    throw err
  }
}

export async function confirmEvidenceLinksAction(pairs: LinkPair[]): Promise<number> {
  const { profile } = await requireProfile()
  const count = await confirmLinks(profile.id, pairs.slice(0, 500))
  revalidatePath(PROFILE_PAGE)
  return count
}

export async function rejectEvidenceLinksAction(pairs: LinkPair[]): Promise<number> {
  const { profile } = await requireProfile()
  const count = await rejectLinks(profile.id, pairs.slice(0, 500))
  revalidatePath(PROFILE_PAGE)
  return count
}

export async function addCapabilityWithEvidenceAction(input: { name: string; kind: CapabilityKind; evidenceIds: string[] }) {
  const { profile } = await requireProfile()
  const result = await addCapabilityWithEvidence(profile.id, { ...input, evidenceIds: input.evidenceIds.slice(0, 50) })
  revalidatePath(PROFILE_PAGE)
  return result
}
