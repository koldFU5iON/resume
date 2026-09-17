'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { encrypt, decrypt } from '@/lib/encryption'
import { SUPPORTED_PROVIDERS } from './client'
import { fetchProviderModels, type ProviderModel } from './models'

export type SaveLLMApiKeyInput = {
  provider: string
  apiKey: string
}

/**
 * Validates the API key by fetching models from the provider, then writes
 * both the encrypted key and the model list atomically. If the key is
 * invalid or the provider is unreachable, nothing is written.
 */
export async function saveLLMApiKey(
  input: SaveLLMApiKeyInput,
): Promise<{ models: ProviderModel[] }> {
  const { profile } = await requireProfile()

  const provider = input.provider.trim()
  if (!SUPPORTED_PROVIDERS.includes(provider as typeof SUPPORTED_PROVIDERS[number])) {
    throw new Error(`Unsupported provider "${provider}"`)
  }
  if (!input.apiKey.trim()) throw new Error('API key is required')

  const models = await fetchProviderModels(provider, input.apiKey.trim())

  await prisma.userSettings.upsert({
    where: { profileId: profile.id },
    update: {
      llmProvider: provider,
      llmApiKey: encrypt(input.apiKey.trim()),
      availableModels: models,
      availableModelsUpdatedAt: new Date(),
    },
    create: {
      profileId: profile.id,
      llmProvider: provider,
      llmApiKey: encrypt(input.apiKey.trim()),
      availableModels: models,
      availableModelsUpdatedAt: new Date(),
    },
  })

  revalidatePath('/dashboard/settings/llm')
  return { models }
}

export async function saveLLMModel(model: string): Promise<void> {
  const { profile } = await requireProfile()
  if (!model.trim()) throw new Error('Model is required')

  await prisma.userSettings.update({
    where: { profileId: profile.id },
    data: { llmModel: model.trim() },
  })

  revalidatePath('/dashboard/settings/llm')
}

export async function refreshModels(): Promise<ProviderModel[]> {
  const { profile } = await requireProfile()

  const settings = await prisma.userSettings.findUnique({
    where: { profileId: profile.id },
    select: { llmProvider: true, llmApiKey: true },
  })

  if (!settings?.llmApiKey) throw new Error('No API key configured.')

  const apiKey = decrypt(settings.llmApiKey)
  if (!apiKey) throw new Error('Stored API key could not be decrypted. Re-enter your key.')

  const models = await fetchProviderModels(settings.llmProvider, apiKey)

  await prisma.userSettings.update({
    where: { profileId: profile.id },
    data: { availableModels: models, availableModelsUpdatedAt: new Date() },
  })

  revalidatePath('/dashboard/settings/llm')
  return models
}

export async function clearLLMApiKey(): Promise<void> {
  const { profile } = await requireProfile()

  await prisma.userSettings.update({
    where: { profileId: profile.id },
    data: {
      llmApiKey: null,
      availableModels: Prisma.JsonNull,
      availableModelsUpdatedAt: null,
    },
  })

  revalidatePath('/dashboard/settings/llm')
}

export async function saveChatModel(model: string): Promise<void> {
  const { profile } = await requireProfile()
  if (!model.trim()) throw new Error('Model is required')
  await prisma.userSettings.update({
    where: { profileId: profile.id },
    data: { chatModel: model.trim() },
  })
}

export async function getChatSettings(): Promise<{
  chatModel: string | null
  llmModel: string
  availableModels: { id: string; name: string }[] | null
  configured: boolean
}> {
  const { profile } = await requireProfile()
  const settings = await prisma.userSettings.findUnique({
    where: { profileId: profile.id },
    select: { chatModel: true, llmModel: true, availableModels: true, llmApiKey: true },
  })
  return {
    chatModel: settings?.chatModel ?? null,
    llmModel: settings?.llmModel ?? 'claude-sonnet-4-5-20251001',
    availableModels: (settings?.availableModels as { id: string; name: string }[] | null) ?? null,
    configured: !!settings?.llmApiKey,
  }
}

const WRITING_BRIEF_MAX_LENGTH = 2000

export async function updateWritingBrief(brief: string): Promise<void> {
  const { profile } = await requireProfile()
  if (brief.length > WRITING_BRIEF_MAX_LENGTH) {
    throw new Error(`Writing brief must be ${WRITING_BRIEF_MAX_LENGTH} characters or fewer.`)
  }
  const trimmed = brief.trim() || null
  await prisma.userSettings.upsert({
    where: { profileId: profile.id },
    update: { writingBrief: trimmed },
    create: { profileId: profile.id, writingBrief: trimmed },
  })
  revalidatePath('/dashboard/settings/ai-writing')
}
