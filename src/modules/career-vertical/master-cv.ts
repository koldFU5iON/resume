// Plain module — generates the canonical Master CV from the career vertical.
// Not a server action; persistence of the CVDocument row lives in actions.ts.
import { completeJSON } from '@/modules/llm/complete-json'
import { LLMError } from '@/modules/llm/errors'
import { composeSystem, loadCVPrompt, loadWritingContext } from '@/modules/llm/prompt-context'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { applyRoleBudgets } from './role-budgets'
import { fillCVHeader } from '@/modules/cv/header'
import { CVDocumentContentSchema, type CVDocumentContent } from '@/modules/cv/schema'
import type { CareerVerticalThreads } from './schema'

const SCHEMA_HINT = `
Section types and their data shapes:
- header:        { name, headline, subHeadline?, location?, contact: {} }  -- name, location and contact are filled in automatically from the profile; write the headline and sub-headline, leave contact empty
- profile:       { content }  -- prose, Markdown allowed
- competencies:  { items: string[] }
- capabilities:  { items: string[] }
- experience:    { company, titles: string[], subtitle?, location, duration, description, outcomes: string[] }
- education:     { institution, qualification, field?, duration, grade? }
- certification: { name, issuer?, date?, url? }
- skills:        { items: string[] }
- tools:         { items: string[] }
- languages:     { items: [{ name, proficiency? }] }  -- proficiency is an optional free-text label
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
    loadCVPrompt(profileId),
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

  const { extracted, finishReason, rawText } = await completeJSON(
    profileId,
    userMessage,
    CVDocumentContentSchema,
    {
      system: composeSystem(rules, brief, cvPrompt),
      feature: 'master-cv-generate',
      temperature: 0.3,
    },
  )

  if (!extracted.ok) {
    console.error('[generateMasterCVContent] failed to parse LLM output', {
      reason: extracted.reason,
      finishReason,
      raw: rawText.slice(0, 4000),
    })
    throw new LLMError(
      'Master CV generation returned output that could not be parsed. Try again — if it keeps failing, switch to a different model in settings.',
      'invalid_output',
      extracted.error,
    )
  }
  return fillCVHeader(extracted.value, snapshot)
}
