'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { getPromptDef } from './registry'
import { PROMPT_MAX_LENGTH } from './schema'
import type { PromptOverrides } from './schema'

async function readOverrides(profileId: string): Promise<PromptOverrides> {
  const settings = await prisma.userSettings.findUnique({
    where: { profileId },
    select: { customPrompts: true },
  })
  return (settings?.customPrompts as PromptOverrides | null) ?? {}
}

async function writeOverrides(profileId: string, overrides: PromptOverrides): Promise<void> {
  const keys = Object.keys(overrides)
  await prisma.userSettings.upsert({
    where: { profileId },
    update: { customPrompts: keys.length > 0 ? overrides : Prisma.JsonNull },
    create: { profileId, customPrompts: keys.length > 0 ? overrides : Prisma.JsonNull },
  })
  revalidatePath('/dashboard/settings/prompts')
}

export async function savePromptOverride(key: string, text: string): Promise<void> {
  const { profile } = await requireProfile()

  const def = getPromptDef(key)
  if (!def) throw new Error(`Unknown prompt key "${key}"`)

  const trimmed = text.trim()
  if (trimmed.length === 0) throw new Error('Prompt cannot be empty. Revert to the default instead.')
  if (trimmed.length > PROMPT_MAX_LENGTH) {
    throw new Error(`Prompt must be ${PROMPT_MAX_LENGTH} characters or fewer.`)
  }

  const overrides = await readOverrides(profile.id)
  overrides[key] = trimmed
  await writeOverrides(profile.id, overrides)
}

export async function revertPrompt(key: string): Promise<void> {
  const { profile } = await requireProfile()

  if (!getPromptDef(key)) throw new Error(`Unknown prompt key "${key}"`)

  const overrides = await readOverrides(profile.id)
  if (!(key in overrides)) return
  delete overrides[key]
  await writeOverrides(profile.id, overrides)
}

export async function resetAllPrompts(): Promise<void> {
  const { profile } = await requireProfile()
  await writeOverrides(profile.id, {})
}
