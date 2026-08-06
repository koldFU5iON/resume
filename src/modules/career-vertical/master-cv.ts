// Plain module — generates the canonical Master CV from the career vertical.
// Not a server action; persistence of the CVDocument row lives in actions.ts.
import { complete } from '@/modules/llm/client'
import { composeSystem, loadCVPrompt, loadWritingContext } from '@/modules/llm/prompt-context'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { applyRoleBudgets } from '@/modules/cv/score-evidence'
import {
  CVDocumentContentSchema,
  parseCVContent,
  type CapabilitiesData,
  type CompetenciesData,
  type CVDocumentContent,
  type ExperienceData,
  type HeaderData,
  type ProfileData,
  type SkillsData,
  type ToolsData,
} from '@/modules/cv/schema'
import type { CareerVerticalThreads } from './schema'

const SCHEMA_HINT = `
Section types and their data shapes:
- header:        { name, headline, subHeadline?, location?, contact: { email?, phone?, linkedin?, website? } }
- profile:       { content }  -- prose, Markdown allowed
- competencies:  { items: string[] }
- capabilities:  { items: string[] }
- experience:    { company, titles: string[], location, duration, description, outcomes: string[] }
- education:     { institution, qualification, field?, duration, grade? }
- certification: { name, issuer?, date?, url? }
- skills:        { items: string[] }
- tools:         { items: string[] }
- languages:     { items: [{ name, proficiency }] }
`

export function formatCareerVerticalContext(vertical: CareerVerticalThreads): string {
  return [
    '== CAREER VERTICAL ==',
    `Career thesis: ${vertical.thesis ?? 'Not set'}`,
    '',
    `Business problems: ${vertical.businessProblems.join(', ')}`,
    `Responsibilities: ${vertical.responsibilities.join(', ')}`,
    `Outcomes: ${vertical.outcomes.join(', ')}`,
    `Competencies: ${vertical.competencies.join(', ')}`,
  ].join('\n')
}

function sectionData<T>(content: CVDocumentContent, type: string): T | undefined {
  return content.sections.find(s => s.type === type && s.visible)?.data as T | undefined
}

// Serializes the master CV's narrative sections for use as a tailoring seed.
// The master owns the candidate's voice (headline, profile prose, competency
// and skill framing); job-targeted generation adapts it rather than rewriting.
// Returns null when there is no usable master content.
export function formatMasterCVNarrative(content: CVDocumentContent | null): string | null {
  if (!content || content.sections.length === 0) return null

  const header = sectionData<HeaderData>(content, 'header')
  const profile = sectionData<ProfileData>(content, 'profile')
  const competencies = sectionData<CompetenciesData>(content, 'competencies')
  const capabilities = sectionData<CapabilitiesData>(content, 'capabilities')
  const skills = sectionData<SkillsData>(content, 'skills')
  const tools = sectionData<ToolsData>(content, 'tools')
  const experience = content.sections
    .filter(s => s.type === 'experience' && s.visible)
    .map(s => s.data as ExperienceData)

  if (!header && !profile && !competencies && !capabilities && !skills && !tools && experience.length === 0) {
    return null
  }

  const lines: string[] = ['== MASTER CV (CANONICAL NARRATIVE) ==']

  if (header) {
    lines.push(`Headline: ${header.headline}`)
    if (header.subHeadline) lines.push(`Sub-headline: ${header.subHeadline}`)
  }
  if (profile) lines.push(`Profile: ${profile.content}`)
  if (competencies?.items.length) lines.push(`Competencies: ${competencies.items.join(', ')}`)
  if (capabilities?.items.length) lines.push(`Capabilities: ${capabilities.items.join(', ')}`)
  if (skills?.items.length) lines.push(`Skills: ${skills.items.join(', ')}`)
  if (tools?.items.length) lines.push(`Tools: ${tools.items.join(', ')}`)
  if (experience.length > 0) {
    lines.push('Experience (canonical wording):')
    for (const exp of experience) {
      const title = exp.titles.join('/')
      lines.push(
        `- ${exp.company}${title ? ` | ${title}` : ''} — ${exp.description}${
          exp.outcomes.length ? ` Outcomes: ${exp.outcomes.join('; ')}` : ''
        }`,
      )
    }
  }

  lines.push(
    "Instructions: keep the headline, sub-headline, competencies, capabilities, skills and tools from this master CV unless the job explicitly requires otherwise. Reuse the profile prose, adapting it only to weave in the job's keywords. For companies listed above, reuse the canonical description and outcome wording, editing for emphasis rather than rewriting. Include experience the job explicitly requires even if it is not listed above.",
  )

  return lines.join('\n')
}

export async function generateMasterCVContent(
  profileId: string,
  vertical: CareerVerticalThreads,
): Promise<CVDocumentContent> {
  const [snapshot, { rules, brief }, cvPrompt] = await Promise.all([
    buildProfileSnapshot(profileId),
    loadWritingContext(profileId),
    loadCVPrompt(),
  ])

  // Master CV = strongest evidence only. Deterministic role budgets cap the
  // activity count per role without an LLM relevance pass (no job to score against).
  const filteredSnapshot = applyRoleBudgets(snapshot)

  const userMessage = [
    '== MODE: MASTER CV ==',
    "No specific job target. Build the candidate's canonical master CV organised around the career vertical below.",
    '',
    formatCareerVerticalContext(vertical),
    '',
    '== CANDIDATE PROFILE ==',
    serializeProfileForLLM(filteredSnapshot),
    '',
    '== OUTPUT SCHEMA ==',
    SCHEMA_HINT,
  ].join('\n')

  const result = await complete(profileId, userMessage, {
    system: composeSystem(rules, brief, cvPrompt),
    feature: 'master-cv-generate',
    maxOutputTokens: 4000,
    temperature: 0.3,
  })

  const jsonMatch = result.text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = jsonMatch ? jsonMatch[1].trim() : result.text.trim()

  const parsed = CVDocumentContentSchema.safeParse(JSON.parse(raw))
  return parsed.success ? parsed.data : parseCVContent(raw)
}
