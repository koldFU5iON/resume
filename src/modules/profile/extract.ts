'use server'

// Two-tier extraction pipeline for a role's or a project's note (markdown in
// Experience.summary or Project.notes). Mirrors the 5-step shape of the retired job-fit.ts:
//
// 1. Gather   — load the role or project + its existing evidence + profile skills
// 2. Parse    — local tag parser bucketizes recognized H2 headings (free, offline)
// 3. LLM      — optional; only if unparsed prose is non-empty AND key is set
// 4. Merge    — combine parser + LLM outputs; annotate with duplicate hints
// 5. Return   — discriminated union; no DB writes (suggestions are in-memory)

import { requireProfile } from '@/lib/session'
import { completeStructured, getLLMConfigStatus } from '@/modules/llm/client'
import { LLMError, type LLMErrorKind } from '@/modules/llm/errors'
import { parseNotes } from './tag-parser'
import { annotateMatches, type SuggestionsWithMatches } from './duplicate-detect'
import {
  ExtractedSuggestionsSchema,
  emptyExtractedSuggestions,
  type ExtractedActivity,
  type ExtractedSkill,
} from './extract-schema'
import { getExperienceWithSuggestionContext, getProjectWithSuggestionContext } from './queries'
import { EXTRACTION_SYSTEM, extractionPrompt, noNotesMessage, projectSubject, roleSubject } from './extraction-context'

export type ExtractionSource =
  | 'parser'
  | 'parser+llm'
  | 'parser-only-no-key'
  | 'parser-llm-error' // LLM was attempted but failed; parser results still returned

type ExtractResult =
  | { ok: true; suggestions: SuggestionsWithMatches; meta: { source: ExtractionSource; llmError?: string } }
  | { ok: false; error: 'no_notes' | 'not_found' | LLMErrorKind; message: string }

/** What to extract from: a role's note or a project's note. */
export type ExtractionOwner = { experienceId: string } | { projectId: string }

export async function extractFromNotes(owner: ExtractionOwner): Promise<ExtractResult> {
  const { profile } = await requireProfile()

  // 1. Gather — profile-owned to prevent cross-account read
  const ctx = 'projectId' in owner
    ? await getProjectWithSuggestionContext(owner.projectId, profile.id)
    : await getExperienceWithSuggestionContext(owner.experienceId, profile.id)
  if (!ctx) {
    return { ok: false, error: 'not_found', message: 'projectId' in owner ? 'Project not found' : 'Experience not found' }
  }
  const subject = 'project' in ctx ? projectSubject({ ...ctx.project, role: ctx.project.experience }) : roleSubject(ctx.experience)
  const { skills: existingSkills } = ctx
  const existingActivities = 'project' in ctx ? ctx.project.activities : ctx.experience.activities

  if (!subject.body.trim()) {
    return { ok: false, error: 'no_notes', message: noNotesMessage(subject.noun) }
  }

  // 2. Parse — deterministic, always runs
  const parsed = parseNotes(subject.body)

  // 3. LLM — only when there is unparsed prose AND the user has a key
  let llmActivities: ExtractedActivity[] = []
  let llmSkills: ExtractedSkill[] = []
  let source: ExtractionSource = 'parser'
  let llmError: string | undefined

  if (parsed.unparsed.trim()) {
    const llmStatus = await getLLMConfigStatus(profile.id)

    if (!llmStatus.configured) {
      source = 'parser-only-no-key'
    } else {
      const system = EXTRACTION_SYSTEM(subject.noun)
      const prompt = extractionPrompt(subject, parsed.unparsed)

      try {
        const result = await completeStructured(profile.id, prompt, ExtractedSuggestionsSchema, {
          system,
          maxOutputTokens: 1500,
          temperature: 0.2,
          feature: 'profile-extract',
        })
        llmActivities = result.object.activities.map((a) => ({ ...a, source: 'llm' as const }))
        llmSkills = result.object.skills.map((s) => ({ ...s, source: 'llm' as const }))
        source = 'parser+llm'
      } catch (err) {
        if (err instanceof LLMError) {
          // Degrade gracefully — return whatever the tag parser found rather
          // than discarding all suggestions because the LLM tier failed.
          source = 'parser-llm-error'
          llmError = err.message
        } else {
          throw err
        }
      }
    }
  }

  // 4. Merge — parser output first, LLM output appended. Both carry `source`
  //    attribution; the UI renders a small badge per item.
  const merged = {
    overview: parsed.overview ?? emptyExtractedSuggestions.overview,
    activities: [...parsed.activities, ...llmActivities],
    skills: [...parsed.skills, ...llmSkills],
  }

  const suggestions = annotateMatches(merged, {
    activities: existingActivities,
    skills: existingSkills,
  })

  // 5. Return
  return { ok: true, suggestions, meta: { source, llmError } }
}
