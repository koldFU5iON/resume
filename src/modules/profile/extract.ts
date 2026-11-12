'use server'

// Two-tier extraction pipeline for Experience notes (markdown stored in
// Experience.summary). Mirrors the 5-step shape of the retired job-fit.ts:
//
// 1. Gather   — load experience + existing activities + profile skills
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
import { getExperienceWithSuggestionContext } from './queries'

export type ExtractionSource =
  | 'parser'
  | 'parser+llm'
  | 'parser-only-no-key'
  | 'parser-llm-error' // LLM was attempted but failed; parser results still returned

type ExtractResult =
  | { ok: true; suggestions: SuggestionsWithMatches; meta: { source: ExtractionSource; llmError?: string } }
  | { ok: false; error: 'no_notes' | 'not_found' | LLMErrorKind; message: string }

export async function extractFromNotes(experienceId: string): Promise<ExtractResult> {
  const { profile } = await requireProfile()

  // 1. Gather — profile-owned to prevent cross-account read
  const ctx = await getExperienceWithSuggestionContext(experienceId, profile.id)
  if (!ctx) {
    return { ok: false, error: 'not_found', message: 'Experience not found' }
  }
  const { experience, skills: existingSkills } = ctx

  if (!experience.summary?.trim()) {
    return {
      ok: false,
      error: 'no_notes',
      message: 'Add some notes first — paste anything about this role and click Extract.',
    }
  }

  // 2. Parse — deterministic, always runs
  const parsed = parseNotes(experience.summary)

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
      const system = `You are an experienced career writer extracting structured resume material from messy notes.

Be conservative — prefer fewer high-confidence items over many noisy ones. Only extract content that clearly came from the person's own work at this role. Do not fabricate metrics or outcomes. If a bullet is ambiguous between a responsibility and an achievement, classify it as a responsibility.

Output only the JSON schema — no prose, no commentary.`

      const startDateStr = experience.startDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      const endDateStr = experience.endDate
        ? experience.endDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        : 'Present'

      const prompt = `# Role context (already structured — do not re-extract these facts)

**${experience.role}** at ${experience.company} (${startDateStr} → ${endDateStr})

# Unstructured notes to extract from

${parsed.unparsed}

Extract activities (responsibilities and achievements) and skills from the notes above. Set source to "llm" for every item. Return a JSON object matching the schema.`

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
    activities: experience.activities,
    skills: existingSkills,
  })

  // 5. Return
  return { ok: true, suggestions, meta: { source, llmError } }
}
