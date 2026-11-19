/**
 * Stage 1, Brief: one call, role 'analysis'. Decides what the CV must achieve
 * for this role (the hidden question, lead with / emphasise / play down,
 * positioning, tone) and how many items each section should show. It sees the
 * job, the strategy found by Gather and a short outline of the profile, never
 * the detailed evidence (Select does that).
 *
 * The output is validated with CvBriefSchema; budgets are clamped into
 * [floor, ceiling] (caps.ts) by the schema itself, which also keeps education
 * at 1 or more.
 */

import * as z from 'zod'
import { composeSystem, loadCVBriefPrompt } from '@/modules/llm/prompt-context'
import { attributionOf, completeValidated, type ValidatedCall } from './call'
import type { GatherResult } from './gather'
import { CV_GENERATION_FEATURES, CvBriefOutputSchema, CvBriefSchema, MAX_OUTPUT_TOKENS, TEMPERATURE, TIME_BUDGET_MS, type CvBrief } from './schema'
import { strategyToPrompt } from './strategy'

type Gathered = Extract<GatherResult, { ok: true }>

const OUTPUT_FORMAT = `Output: one JSON object in a \`\`\`json code block, nothing else. It must match this JSON Schema. Text and list limits in the descriptions are hard limits.
\`\`\`json
${JSON.stringify(z.toJSONSchema(CvBriefOutputSchema, { io: 'input' }))}
\`\`\``

/** The brief prompt (everything but the instructions). Pure. */
export function briefPrompt(g: Gathered): string {
  const { job } = g
  return [
    `# Job\n\n**${job.title}**${job.company ? ` at ${job.company}` : ''}\n\n<job_description>\n${job.description}\n</job_description>`,
    `# Strategy\n\n${strategyToPrompt(g.strategy)}`,
    `# Candidate outline\n\n${g.outline}`,
    'Return the brief as one JSON object matching the schema, in a ```json code block.',
  ].join('\n\n')
}

export type BriefResult = ValidatedCall<CvBrief>

/** Runs the Brief call. Throws LLMError (kind invalid_output, timeout, ...). */
export async function runBrief(
  g: Gathered,
  ctx: { profileId: string; jobApplicationId: string; runId: string; deadline: number; writingDeskDocumentId?: string | null },
): Promise<BriefResult> {
  const instructions = await loadCVBriefPrompt(ctx.profileId)
  const result = await completeValidated(ctx.profileId, briefPrompt(g), CvBriefSchema, {
    role: 'analysis',
    system: composeSystem(instructions, OUTPUT_FORMAT),
    maxOutputTokens: MAX_OUTPUT_TOKENS.brief,
    retryMaxOutputTokens: MAX_OUTPUT_TOKENS.briefRetry,
    temperature: TEMPERATURE.brief,
    timeoutMs: TIME_BUDGET_MS.brief,
    deadline: ctx.deadline,
    feature: CV_GENERATION_FEATURES.brief,
    attribution: attributionOf(ctx),
    label: 'brief',
  })
  return result
}
