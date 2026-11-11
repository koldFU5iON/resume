import * as z from 'zod'

// Canonical, lowercase skill levels. Every write path (manual form, notes
// extraction, CV import) goes through normalizeSkillLevel so the stored value
// always matches the UI select and the readers that filter on it
// (e.g. chat/context.ts keeps only 'expert' | 'advanced').
export const SKILL_LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'] as const
export type SkillLevel = (typeof SKILL_LEVELS)[number]
export const DEFAULT_SKILL_LEVEL: SkillLevel = 'intermediate'

export function normalizeSkillLevel(value: unknown): SkillLevel {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return (SKILL_LEVELS as readonly string[]).includes(v) ? (v as SkillLevel) : DEFAULT_SKILL_LEVEL
}

export const DEFAULT_SKILL_CATEGORY = 'General'

export const SkillInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(80).transform((c) => c || DEFAULT_SKILL_CATEGORY),
  level: z.unknown().transform(normalizeSkillLevel),
  yearsOfExperience: z.number().min(0).max(80).optional(),
})

export const ACTIVITY_KINDS = ['responsibility', 'achievement'] as const

export const ActivityInputSchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  description: z.string().trim().min(1),
  impact: z.string().trim().optional(),
})
