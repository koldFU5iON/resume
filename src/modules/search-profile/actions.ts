'use server'

import { nanoid } from 'nanoid'
import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import {
  SearchProfileSchema,
  normalizeSearchProfile,
  normalizeSuggestions,
  type SearchProfile,
  type SearchSuggestion,
} from './schema'

export type SaveSearchProfileResult =
  | { ok: true; profile: SearchProfile }
  | { ok: false; error: string }

/**
 * Save the whole search profile, `eligibility` included. The input is run
 * through `SearchProfileSchema` first (tolerant per field: over-long text is
 * truncated, codes normalised, invalid entries dropped), and the canonical
 * profile that was stored is returned so the caller can reset its form state.
 * A non-object input is rejected without touching the stored profile.
 */
export async function saveSearchProfile(data: SearchProfile): Promise<SaveSearchProfileResult> {
  const { profile } = await requireProfile()
  const parsed = SearchProfileSchema.safeParse(data)
  if (!parsed.success) return { ok: false, error: 'Invalid search profile' }
  const searchProfile = parsed.data
  await prisma.userSettings.upsert({
    where: { profileId: profile.id },
    create: { profileId: profile.id, searchProfile },
    update: { searchProfile },
  })
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/search-context')
  return { ok: true, profile: searchProfile }
}

export async function emitSuggestion(
  profileId: string,
  suggestion: Omit<SearchSuggestion, 'id' | 'createdAt'>,
) {
  const settings = await prisma.userSettings.findUnique({
    where: { profileId },
    select: { searchSuggestions: true },
  })
  const existing = normalizeSuggestions(settings?.searchSuggestions)
  if (existing.some((s) => s.field === suggestion.field)) return

  const next: SearchSuggestion = { ...suggestion, id: nanoid(), createdAt: new Date().toISOString() }
  const queue = [...existing, next] as unknown as Prisma.InputJsonValue[]
  await prisma.userSettings.upsert({
    where: { profileId },
    create: { profileId, searchSuggestions: queue },
    update: { searchSuggestions: queue },
  })
  revalidatePath('/dashboard/search-context')
}

export async function acceptSuggestion(suggestionId: string) {
  const { profile } = await requireProfile()
  const settings = await prisma.userSettings.findUnique({
    where: { profileId: profile.id },
    select: { searchProfile: true, searchSuggestions: true },
  })
  const suggestions = normalizeSuggestions(settings?.searchSuggestions)
  const suggestion = suggestions.find((s) => s.id === suggestionId)
  if (!suggestion) return

  const current = normalizeSearchProfile(settings?.searchProfile)
  const remaining = suggestions.filter((s) => s.id !== suggestionId)
  // suggestedValue is z.unknown() in the queue, so run the merged profile
  // through the schema. The schema is lenient (a bad field falls back to its
  // empty value), so a non-empty suggestion that parses to empty was invalid:
  // drop it instead of blanking the user's field.
  const parsed = SearchProfileSchema.safeParse({ ...current, [suggestion.field]: suggestion.suggestedValue })
  const valid =
    parsed.success &&
    !(isEmptyValue(parsed.data[suggestion.field]) && !isEmptyValue(suggestion.suggestedValue))
  const updated: SearchProfile = valid ? parsed.data : current

  await prisma.userSettings.update({
    where: { profileId: profile.id },
    data: {
      searchProfile: updated as unknown as Prisma.InputJsonValue,
      searchSuggestions: remaining as unknown as Prisma.InputJsonValue[],
    },
  })
  revalidatePath('/dashboard/search-context')
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

export async function dismissSuggestion(suggestionId: string) {
  const { profile } = await requireProfile()
  const settings = await prisma.userSettings.findUnique({
    where: { profileId: profile.id },
    select: { searchSuggestions: true },
  })
  const remaining = normalizeSuggestions(settings?.searchSuggestions).filter(
    (s) => s.id !== suggestionId,
  )
  await prisma.userSettings.update({
    where: { profileId: profile.id },
    data: { searchSuggestions: remaining as unknown as Prisma.InputJsonValue[] },
  })
  revalidatePath('/dashboard/search-context')
}
