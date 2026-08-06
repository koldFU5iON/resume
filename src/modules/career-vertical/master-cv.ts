// Plain module — generates the canonical Master CV from the career vertical.
// Not a server action; persistence of the CVDocument row lives in actions.ts.
import { complete } from '@/modules/llm/client'
import { composeSystem, loadCVPrompt, loadWritingContext } from '@/modules/llm/prompt-context'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { applyRoleBudgets } from '@/modules/cv/score-evidence'
import { CVDocumentContentSchema, parseCVContent, type CVDocumentContent } from '@/modules/cv/schema'
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
