import { z } from "zod"

export const HeaderDataSchema = z.object({
  name: z.string(),
  headline: z.string(),
  subHeadline: z.string().nullish(),
  location: z.string().nullish(),
  contact: z.object({
    email: z.string().nullish(),
    phone: z.string().nullish(),
    linkedin: z.string().nullish(),
    website: z.string().nullish(),
  }),
})

export const ProfileDataSchema = z.object({ content: z.string() })
export const CompetenciesDataSchema = z.object({ items: z.array(z.string()) })
export const CapabilitiesDataSchema = z.object({ items: z.array(z.string()) })

export const ExperienceDataSchema = z.object({
  company: z.string(),
  titles: z.array(z.string()),
  subtitle: z.string().nullish(),
  location: z.string(),
  duration: z.string(),
  description: z.string(),
  outcomes: z.array(z.string()),
})

export const EducationDataSchema = z.object({
  institution: z.string(),
  qualification: z.string(),
  field: z.string().nullish(),
  duration: z.string(),
  grade: z.string().nullish(),
})

export const CertificationDataSchema = z.object({
  name: z.string(),
  issuer: z.string().nullish(),
  date: z.string().nullish(),
  url: z.string().nullish(),
})

export const SkillsDataSchema = z.object({ items: z.array(z.string()) })
export const ToolsDataSchema = z.object({ items: z.array(z.string()) })
export const LanguagesDataSchema = z.object({
  items: z.array(z.object({ name: z.string(), proficiency: z.string() })),
})

export const CustomDataSchema = z.object({
  heading: z.string(),
  subtype: z.enum(['text', 'list']),
  content: z.string().nullish(),
  items: z.array(z.string()).nullish(),
})

export const CVSectionSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string(), type: z.literal("header"),        visible: z.boolean(), data: HeaderDataSchema }),
  z.object({ id: z.string(), type: z.literal("profile"),       visible: z.boolean(), data: ProfileDataSchema }),
  z.object({ id: z.string(), type: z.literal("competencies"),  visible: z.boolean(), data: CompetenciesDataSchema }),
  z.object({ id: z.string(), type: z.literal("capabilities"),  visible: z.boolean(), data: CapabilitiesDataSchema }),
  z.object({ id: z.string(), type: z.literal("experience"),    visible: z.boolean(), data: ExperienceDataSchema }),
  z.object({ id: z.string(), type: z.literal("education"),     visible: z.boolean(), data: EducationDataSchema }),
  z.object({ id: z.string(), type: z.literal("certification"), visible: z.boolean(), data: CertificationDataSchema }),
  z.object({ id: z.string(), type: z.literal("skills"),        visible: z.boolean(), data: SkillsDataSchema }),
  z.object({ id: z.string(), type: z.literal("tools"),         visible: z.boolean(), data: ToolsDataSchema }),
  z.object({ id: z.string(), type: z.literal("languages"),     visible: z.boolean(), data: LanguagesDataSchema }),
  z.object({ id: z.string(), type: z.literal("custom"),        visible: z.boolean(), data: CustomDataSchema }),
])

export const CVDocumentContentSchema = z.object({
  version: z.literal(1),
  sections: z.array(CVSectionSchema),
})

export type CVDocumentContent = z.infer<typeof CVDocumentContentSchema>
export type CVSection = z.infer<typeof CVSectionSchema>
export type HeaderData = z.infer<typeof HeaderDataSchema>
export type ProfileData = z.infer<typeof ProfileDataSchema>
export type CompetenciesData = z.infer<typeof CompetenciesDataSchema>
export type CapabilitiesData = z.infer<typeof CapabilitiesDataSchema>
export type ExperienceData = z.infer<typeof ExperienceDataSchema>
export type EducationData = z.infer<typeof EducationDataSchema>
export type CertificationData = z.infer<typeof CertificationDataSchema>
export type SkillsData = z.infer<typeof SkillsDataSchema>
export type ToolsData = z.infer<typeof ToolsDataSchema>
export type LanguagesData = z.infer<typeof LanguagesDataSchema>
export type CustomData = z.infer<typeof CustomDataSchema>

// Merge an (LLM-proposed) data object onto an existing section, then validate
// the result against the section's schema. Persists nothing — throws if the
// merged section is invalid so the CV document can never be corrupted.
export function mergeSectionData(
  existing: CVSection,
  proposedData: Record<string, unknown>,
): CVSection {
  if (proposedData == null || typeof proposedData !== 'object') {
    throw new Error('The AI proposed an invalid CV change and it was not applied.')
  }
  const candidate = { ...existing, data: { ...existing.data, ...proposedData } }
  const parsed = CVSectionSchema.safeParse(candidate)
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map(i => i.path.join('.') || i.code)
      .join(', ')
    console.error('[mergeSectionData] proposed CV section rejected', parsed.error.issues)
    throw new Error(
      `The AI's CV change was incomplete (${fields}) and was not applied. ` +
      'Try a more focused change, or ask the coach to keep all existing fields.',
    )
  }
  return parsed.data
}

export function parseCVContent(raw: string): CVDocumentContent {
  try {
    const parsed = JSON.parse(raw)
    const result = CVDocumentContentSchema.safeParse(parsed)
    if (result.success) return result.data
    // Only log for documents that carry real content. Placeholder rows stuck at
    // '{}' after a failed generation are expected and would spam the logs on
    // every page load.
    if (parsed && typeof parsed === 'object' && 'sections' in parsed) {
      console.error('[parseCVContent] schema validation failed', result.error.issues)
    }
    // Salvage: one corrupt section should not blank the whole CV. Keep the
    // sections that individually validate so the rest of the document survives.
    if (Array.isArray(parsed?.sections)) {
      const sections = parsed.sections.filter(
        (s: unknown): s is CVSection => CVSectionSchema.safeParse(s).success,
      )
      if (sections.length !== parsed.sections.length) {
        console.error(
          `[parseCVContent] dropped ${parsed.sections.length - sections.length} invalid section(s)`,
        )
      }
      return { version: 1, sections }
    }
    return { version: 1, sections: [] }
  } catch {
    return { version: 1, sections: [] }
  }
}
