// Model roles: feature code says what kind of work a call is, and the user's
// settings decide which model does it. This is the only module that names
// model ids (ROLE_RECOMMENDATIONS); feature modules pass `role` to
// complete()/completeStructured() instead of choosing a model.
//
// Client-safe: no server imports, so the settings page can use the labels
// and the resolver to flag stale choices.

import { z } from 'zod'

export const MODEL_ROLES = ['default', 'fast', 'research', 'analysis'] as const
export type ModelRole = (typeof MODEL_ROLES)[number]

/** Roles the user can point at a model of their choice. `default` is always llmModel. */
export const CONFIGURABLE_ROLES = ['fast', 'research', 'analysis'] as const
export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number]

export const ROLE_INFO: Record<ModelRole, { label: string; description: string }> = {
  default: {
    label: 'Default',
    description: 'Writing and generation: CVs, cover letters, chat.',
  },
  fast: {
    label: 'Fast',
    description: 'Extraction, structuring and classification: job facts, reading job pages.',
  },
  research: {
    label: 'Research',
    description: 'Gathering facts from the web. Needs a model that supports web search.',
  },
  analysis: {
    label: 'Analysis',
    description: 'Long reasoning over a lot of context, such as a deep dive on a job.',
  },
}

export function isModelRole(value: unknown): value is ModelRole {
  return typeof value === 'string' && (MODEL_ROLES as readonly string[]).includes(value)
}

export function isConfigurableRole(value: unknown): value is ConfigurableRole {
  return typeof value === 'string' && (CONFIGURABLE_ROLES as readonly string[]).includes(value)
}

/** Stored shape of UserSettings.llmModelRoles. A missing role means "no explicit choice". */
export const ModelRoleChoicesSchema = z.object({
  fast: z.string().trim().min(1).max(200).optional(),
  research: z.string().trim().min(1).max(200).optional(),
  analysis: z.string().trim().min(1).max(200).optional(),
})
export type ModelRoleChoices = z.infer<typeof ModelRoleChoicesSchema>

/** Reads llmModelRoles leniently: drops unknown keys and invalid entries rather than failing. */
export function normalizeModelRoleChoices(raw: unknown): ModelRoleChoices {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: ModelRoleChoices = {}
  for (const role of CONFIGURABLE_ROLES) {
    const parsed = ModelRoleChoicesSchema.shape[role].safeParse((raw as Record<string, unknown>)[role])
    if (parsed.success && parsed.data) out[role] = parsed.data
  }
  return out
}

/**
 * Recommended model per provider and role. Used to prefill the settings page
 * and as the fallback when the user hasn't chosen a model for a role. An entry
 * stays null until a model has been checked against the features that use the
 * role; null falls back to the user's default model.
 */
export const ROLE_RECOMMENDATIONS: Record<'anthropic' | 'openai' | 'google', Record<ConfigurableRole, string | null>> = {
  // research/analysis: measured on the job deep dive, 2026-11-11 (docs/deep-dive.md). Haiku as the research
  // model cost ~4x less but returned far fewer pay findings (0 and 4 vs 13-15 for Sonnet).
  anthropic: { fast: 'claude-haiku-5-5', research: 'claude-sonnet-5-5', analysis: 'claude-opus-5-5' },
  openai: { fast: null, research: null, analysis: null },
  google: { fast: null, research: null, analysis: null },
}

export function recommendedModel(provider: string, role: ModelRole): string | null {
  if (role === 'default') return null
  return (ROLE_RECOMMENDATIONS as Record<string, Record<ConfigurableRole, string | null> | undefined>)[provider]?.[role] ?? null
}

/** Model ids from a cached UserSettings.availableModels value, or null when unknown. */
export function availableModelIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  return raw
    .map((m) => (m && typeof m === 'object' ? (m as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string')
}

export type RoleResolutionInput = {
  provider: string
  /** The user's default model (UserSettings.llmModel). */
  defaultModel: string
  /** The user's cached model ids; null when never fetched (then every id is trusted). */
  availableModels: string[] | null
  choices: ModelRoleChoices
}

export type RoleResolution = {
  model: string
  source: 'choice' | 'recommended' | 'default'
  /** The user's choice for this role, when it's no longer in their model list. */
  staleChoice: string | null
}

/**
 * Model for a role: the user's choice if their key still has it, else the
 * provider's recommendation if their key has it, else their default model.
 */
export function resolveRoleModel(input: RoleResolutionInput, role: ModelRole): RoleResolution {
  if (role === 'default') return { model: input.defaultModel, source: 'default', staleChoice: null }
  const has = (id: string) => input.availableModels === null || input.availableModels.includes(id)

  const choice = input.choices[role] ?? null
  if (choice && has(choice)) return { model: choice, source: 'choice', staleChoice: null }
  const staleChoice = choice

  const recommended = recommendedModel(input.provider, role)
  if (recommended && has(recommended)) return { model: recommended, source: 'recommended', staleChoice }

  return { model: input.defaultModel, source: 'default', staleChoice }
}
