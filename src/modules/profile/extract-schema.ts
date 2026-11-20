import * as z from 'zod'
import { ResultInputSchema } from './result'

const suggestionSource = z.enum(['parser', 'llm'])
const resultFields = z.object({
  measure: z.string(),
  value: z.string(),
  baseline: z.string().nullable(),
  period: z.string().nullable(),
})

const proposedClaim = z.object({
  kind: z.enum(['achievement', 'scope']).describe('Default to achievement. Use scope for an ongoing duty.'),
  description: z.string().trim().min(1).describe('A standalone first-person claim faithful to the note.'),
  original: z.string().min(1).describe('An exact contiguous excerpt from the notes supporting the entire claim.'),
  impact: z.string().nullable().describe('A source-stated outcome, if any.'),
  result: resultFields.nullable().describe('Use verbatim phrases for the measure, value and any stated baseline or period. Null if unclear.'),
  projectName: z.string().nullable().describe('A known role project name, or a new project name explicitly stated in the excerpt.'),
})

const proposedSkill = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(80).nullable(),
  level: z.enum(['Beginner', 'Intermediate', 'Advanced', 'Expert']).nullable(),
})

export const ExtractedSuggestionsSchema = z.object({
  activities: z.array(proposedClaim),
  skills: z.array(proposedSkill.extend({ original: proposedClaim.shape.original })),
})

export type ExtractedActivity = z.infer<typeof proposedClaim> & { source: z.infer<typeof suggestionSource> }
export type ExtractedSkill = z.infer<typeof proposedSkill> & { source: z.infer<typeof suggestionSource>; original: string }

const id = z.string().min(1).max(128)
export const ExtractionOwnerSchema = z.union([
  z.strictObject({ experienceId: id }),
  z.strictObject({ projectId: id }),
])
export type ExtractionOwner = z.infer<typeof ExtractionOwnerSchema>

const projectChoice = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('existing'), id }),
  z.object({ kind: z.literal('new'), name: z.string().trim().min(1).max(160) }),
]).nullable()

const achievementFields = z.object({
  kind: z.literal('achievement'),
  description: proposedClaim.shape.description,
  impact: z.string().trim().nullable(),
  result: ResultInputSchema.nullable(),
  project: projectChoice,
  projectEdited: z.boolean(),
})
const scopeFields = z.object({ kind: z.literal('scope'), description: proposedClaim.shape.description })
const skillFields = proposedSkill.extend({ kind: z.literal('skill') })

export const DraftEditSchema = z.discriminatedUnion('kind', [achievementFields, scopeFields, skillFields])
export type DraftEdit = z.output<typeof DraftEditSchema>

const itemMetadata = { id, key: z.string(), original: z.string().min(1), source: suggestionSource }
const DraftItemSchema = z.discriminatedUnion('kind', [
  achievementFields.extend(itemMetadata), scopeFields.extend(itemMetadata), skillFields.extend(itemMetadata),
])
export type DraftItem = z.output<typeof DraftItemSchema>

export const DraftContentSchema = z.object({
  items: z.array(DraftItemSchema),
  resolved: z.array(z.string()),
  notice: z.string().nullable(),
})

export const DraftStampSchema = z.object({
  sourceVersion: z.string().length(64),
  version: z.number().int().nonnegative(),
})
export const DraftChangeSchema = DraftStampSchema.extend({
  itemId: id,
  decision: z.enum(['save', 'accept', 'replace', 'skip']),
  edit: DraftEditSchema.optional(),
  target: z.object({ id, version: z.string() }).optional(),
}).refine((input) => input.decision !== 'replace' || input.target, 'Choose a match to replace.')
export type DraftChange = z.input<typeof DraftChangeSchema>
