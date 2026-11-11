import * as z from "zod"

// Stored in UserSettings.onboardingContext as JSON. Keep this small and gentle:
// it is user-provided context for future LLM assistance, not a Career Profile/CV source.
//
// Tolerant per field: over-long text is truncated and a malformed field falls
// back to its empty value, so one bad field can never empty the whole context
// (normalize → merge → write would otherwise silently wipe the stored data).
function lenientText(max: number) {
  return z.string().transform((s) => s.trim().slice(0, max).trimEnd()).catch("").default("")
}

export const onboardingContextSchema = z.object({
  preferredName: lenientText(120),
  currentRole: lenientText(200),
  targetRole: lenientText(200),
  industries: lenientText(500),
  workPreferences: lenientText(500),
  extraContext: lenientText(1500),
  // Additional role types for job hunt scanning — managed from the Job Hunt page,
  // not the onboarding form. Preserved when the onboarding form is saved.
  additionalRoles: z
    .array(z.unknown())
    .catch([])
    .default([])
    .transform((items) =>
      items.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim().slice(0, 100)] : [])),
    ),
})

export type OnboardingContext = z.infer<typeof onboardingContextSchema>

export const emptyOnboardingContext: OnboardingContext = {
  preferredName: "",
  currentRole: "",
  targetRole: "",
  industries: "",
  workPreferences: "",
  extraContext: "",
  additionalRoles: [],
}

export function normalizeOnboardingContext(value: unknown): OnboardingContext {
  const parsed = onboardingContextSchema.safeParse(value ?? {})
  if (!parsed.success) return emptyOnboardingContext
  return parsed.data
}

export function onboardingContextHasContent(context: OnboardingContext) {
  return Object.values(context).some((value) =>
    Array.isArray(value) ? value.length > 0 : value.trim().length > 0,
  )
}
