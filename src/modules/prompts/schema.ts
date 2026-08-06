import { z } from 'zod'
import { PROMPT_REGISTRY } from './registry'

export const PROMPT_MAX_LENGTH = 20_000

export const PromptOverridesSchema = z.record(
  z.string(),
  z.string().max(PROMPT_MAX_LENGTH),
).refine(
  (overrides) => Object.keys(overrides).every(key =>
    PROMPT_REGISTRY.some(p => p.key === key),
  ),
  { message: 'Contains an unknown prompt key.' },
)

export type PromptOverrides = z.infer<typeof PromptOverridesSchema>
