import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/db'
import { PROMPT_REGISTRY } from './registry'
import type { PromptOverrides } from './schema'

async function readBundledPrompt(filename: string): Promise<string> {
  const promptPath = path.join(process.cwd(), 'src/lib/prompts', filename)
  return readFile(promptPath, 'utf-8').catch(() => {
    throw new Error(`${filename} missing from bundle — check outputFileTracingIncludes in next.config.ts`)
  })
}

export async function loadPromptOverrides(profileId: string): Promise<PromptOverrides> {
  const settings = await prisma.userSettings.findUnique({
    where: { profileId },
    select: { customPrompts: true },
  })
  return (settings?.customPrompts as PromptOverrides | null) ?? {}
}

/**
 * Resolves a prompt for a user: returns their saved override when present,
 * otherwise the bundled default file. Accepts an optional already-loaded
 * override map to avoid an extra DB read when the caller has one in hand.
 */
export async function loadPromptText(
  profileId: string,
  key: string,
  overrides?: PromptOverrides,
): Promise<string> {
  const map = overrides ?? (await loadPromptOverrides(profileId))
  const override = map[key]
  if (override) return override
  return loadDefaultPrompt(key)
}

/** Loads the bundled default for a prompt key — no user overrides applied. */
export async function loadDefaultPrompt(key: string): Promise<string> {
  const def = PROMPT_REGISTRY.find(p => p.key === key)
  if (!def) throw new Error(`Unknown prompt key "${key}"`)
  return readBundledPrompt(def.filename)
}

/** Loads every bundled default prompt, keyed by registry key. Used by the settings page. */
export async function loadAllDefaultPrompts(): Promise<Record<string, string>> {
  const entries = await Promise.all(
    PROMPT_REGISTRY.map(async p => [p.key, await readBundledPrompt(p.filename)] as const),
  )
  return Object.fromEntries(entries)
}
