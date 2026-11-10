'use server'

import { nanoid } from 'nanoid'
import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import {
  normalizeEligibility,
  normalizeSearchProfile,
  normalizeSuggestions,
  type SearchProfile,
  type SearchSuggestion,
} from './schema'

/**
 * Save the whole search profile, `eligibility` included. Eligibility is
 * re-normalised server-side (codes uppercased, invalid entries dropped — see
 * `EligibilitySchema`), so the stored value is always in canonical form.
 */
export async function saveSearchProfile(data: SearchProfile) {
  const { profile } = await requireProfile()
  const searchProfile: SearchProfile = { ...data, eligibility: normalizeEligibility(data.eligibility) }
  await prisma.userSettings.upsert({
    where: { profileId: profile.id },
    create: { profileId: profile.id, searchProfile },
    update: { searchProfile },
  })
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/search-context')
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
  const updated: SearchProfile = { ...current, [suggestion.field]: suggestion.suggestedValue }
  const remaining = suggestions.filter((s) => s.id !== suggestionId)

  await prisma.userSettings.update({
    where: { profileId: profile.id },
    data: {
      searchProfile: updated as unknown as Prisma.InputJsonValue,
      searchSuggestions: remaining as unknown as Prisma.InputJsonValue[],
    },
  })
  revalidatePath('/dashboard/search-context')
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
