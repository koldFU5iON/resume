import { prisma } from '@/lib/db'
import { normalizeSearchProfile } from '@/modules/search-profile/schema'
import { loadPromptText } from '@/modules/prompts/loader'

export type WritingContext = {
  rules: string
  brief: string | null
  searchProfileSummary: string | null
}

export async function loadWritingRules(profileId: string): Promise<string> {
  return loadPromptText(profileId, 'writing-rules')
}

export async function loadCVPrompt(profileId: string): Promise<string> {
  return loadPromptText(profileId, 'cv-generate')
}

export async function loadCVJobAnalysisPrompt(profileId: string): Promise<string> {
  return loadPromptText(profileId, 'cv-job-analysis')
}

export async function loadEvidenceScoringPrompt(profileId: string): Promise<string> {
  return loadPromptText(profileId, 'cv-evidence-score')
}

export async function loadCVScanPrompt(profileId: string): Promise<string> {
  return loadPromptText(profileId, 'cv-recruiter-scan')
}

export async function loadATSContextPrompt(profileId: string): Promise<string> {
  return loadPromptText(profileId, 'cv-ats-context')
}

export async function loadCareerVerticalPrompt(profileId: string): Promise<string> {
  return loadPromptText(profileId, 'career-vertical')
}

export async function loadWritingContext(profileId: string): Promise<WritingContext> {
  const [rules, settings] = await Promise.all([
    loadWritingRules(profileId).catch(() => ''),
    prisma.userSettings.findUnique({
      where: { profileId },
      select: { writingBrief: true, searchProfile: true },
    }),
  ])

  const sp = normalizeSearchProfile(settings?.searchProfile)
  const lines: string[] = []
  if (sp.roles.length > 0)    lines.push(`Target roles: ${sp.roles.join(', ')}`)
  if (sp.careerGoals)         lines.push(`Career goals: ${sp.careerGoals}`)
  if (sp.pivotContext)        lines.push(`Career change context: ${sp.pivotContext}`)
  if (sp.remotePreference)    lines.push(`Remote preference: ${sp.remotePreference}`)
  if (sp.countries.length > 0) lines.push(`Countries: ${sp.countries.join(', ')}`)

  return {
    rules,
    brief: settings?.writingBrief ?? null,
    searchProfileSummary: lines.length > 0 ? lines.join('\n') : null,
  }
}

export function composeSystem(...parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => Boolean(p)).join('\n\n---\n\n')
}
