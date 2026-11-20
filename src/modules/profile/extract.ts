'use server'

import { revalidatePath } from 'next/cache'
import { ZodError } from 'zod'
import { requireProfile } from '@/lib/session'
import { changeExtractionDraft, ExtractionDraftError, regenerateExtractionDraft } from './extraction-draft'
import type { DraftChange, ExtractionOwner } from './extract-schema'

async function updateReview(operation: (profileId: string) => Promise<void>) {
  const { profile } = await requireProfile()
  try {
    await operation(profile.id)
  } catch (error) {
    if (error instanceof ExtractionDraftError || error instanceof ZodError) {
      return { ok: false as const, message: error instanceof ZodError ? error.issues[0].message : error.message }
    }
    throw error
  }
  revalidatePath('/dashboard/profile', 'layout')
  return { ok: true as const }
}

export async function extractFromNotes(owner: ExtractionOwner, stamp: { version: number; sourceVersion: string }, replacePending: boolean) {
  return updateReview((profileId) => regenerateExtractionDraft(profileId, owner, stamp, replacePending))
}

export async function reviewExtractionItem(owner: ExtractionOwner, change: DraftChange) {
  return updateReview((profileId) => changeExtractionDraft(profileId, owner, change))
}
