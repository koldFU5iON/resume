/**
 * The experience writer: ONE call per employer that shows bullets (wave 1).
 * It writes a one-sentence summary and the bullets as a `:::compact-list`
 * block from only that employer's selected evidence; code renders the heading
 * (company, latest title, dates, progression) around it.
 *
 * After the answer, code checks (checks.ts): block validity (hard); word and
 * bullet limits, figures that are not in the evidence, claimed tools, and
 * titles / companies the model introduced (soft). One retry with feedback,
 * then accept and log. At most TWO calls.
 */

import * as z from 'zod'
import { composeSystem } from '@/modules/llm/prompt-context'
import { completeChecked, type CheckResult } from '../call'
import { CV_GENERATION_FEATURES, MAX_OUTPUT_TOKENS, TIME_BUDGET_MS } from '../schema'
import {
  BULLET_MAX_WORDS, SUMMARY_MAX_WORDS,
} from './limits'
import { claimedHits, introducedNames, parseListBlock, unsupportedFigures, wordCount } from './checks'
import { evidenceTexts, type EmployerEvidence } from './evidence'
import { blockSyntax, briefText, data, requirementsBlock } from './prompt'
import { renderEmployerEntry } from './render'
import type { WriteContext, WriterOutcome } from './types'

export type ExperienceOutcome = WriterOutcome & { summary: string; bullets: string[] }

export const ExperienceOutputSchema = z.object({
  summary: z.string().describe(`One sentence on what the candidate was responsible for, at most ${SUMMARY_MAX_WORDS} words`),
  block: z.string().describe(`The bullets as one ":::compact-list" block: a line ":::compact-list", one "- " bullet per line, then a line ":::"`),
})
export type ExperienceOutput = z.infer<typeof ExperienceOutputSchema>

export const EXPERIENCE_OUTPUT_FORMAT = `Output: one JSON object in a \`\`\`json code block, nothing else. It must match this JSON Schema. Limits in the descriptions are hard limits.
\`\`\`json
${JSON.stringify(z.toJSONSchema(ExperienceOutputSchema, { io: 'input' }))}
\`\`\``

/** The user message of an experience call. Pure; carries no name, employer, title or contact detail. */
export function experiencePrompt(ctx: Pick<WriteContext, 'brief' | 'strategy'>, emp: EmployerEvidence): string {
  const max = emp.activities.length
  const items = emp.activities.map((a) => `[${a.id}] ${a.kind}: ${a.text}${a.impact ? ` — impact: ${a.impact}` : ''}${a.highlighted ? ' (the candidate highlighted this)' : ''}`)
  return [
    '# Brief',
    briefText(ctx.brief),
    '# Job requirements\n\nFor emphasis only. They are not facts about the candidate.',
    data('job_requirements', requirementsBlock(ctx.strategy)),
    '# Evidence for this employer\n\nThese items are everything you may state. Best first.',
    data('evidence', items.join('\n')),
    `# Limits\n\n- Summary: one sentence, at most ${SUMMARY_MAX_WORDS} words.\n- Bullets: at most ${max}, each at most ${BULLET_MAX_WORDS} words, outcome and business impact first.\n- Numbers exactly as in the evidence; no title, company or date that the evidence does not contain.`,
    `# Block syntax\n\n${blockSyntax(['compact-list'])}`,
    'Return the summary and the block as one JSON object matching the schema, in a ```json code block.',
  ].join('\n\n')
}

type Analysis = CheckResult & {
  summary: string
  bullets: string[]
  /** Figures that no evidence item contains, after the checks. */
  unsupported: string[]
  /** Claimed names mentioned, with whether the job's requirements name them. */
  claimed: Array<{ name: string; requested: boolean }>
}

/** All code checks on one answer. Pure. */
export function analyseExperience(out: ExperienceOutput, ctx: Pick<WriteContext, 'evidence' | 'requirementText'>, emp: EmployerEvidence): Analysis {
  const hard: string[] = []
  const soft: string[] = []
  const parsed = parseListBlock(out.block, 'compact-list')
  const bullets = parsed.ok ? parsed.bullets : []
  if (!parsed.ok) hard.push(...parsed.problems)
  const summary = out.summary.trim().replace(/\s+/g, ' ')
  const texts = evidenceTexts(emp)
  const evidenceText = texts.join('\n')

  if (summary === '') soft.push('the summary is empty; write one sentence')
  else if (wordCount(summary) > SUMMARY_MAX_WORDS) soft.push(`the summary is ${wordCount(summary)} words; it must be at most ${SUMMARY_MAX_WORDS}`)
  if (bullets.length > emp.activities.length) soft.push(`there are ${bullets.length} bullets; at most ${emp.activities.length} (one per evidence item) are allowed`)
  bullets.forEach((b, i) => {
    if (wordCount(b) > BULLET_MAX_WORDS) soft.push(`bullet ${i + 1} is ${wordCount(b)} words; each must be at most ${BULLET_MAX_WORDS}`)
  })

  const all = [summary, ...bullets].join('\n')
  const unsupported = unsupportedFigures(all, texts)
  if (unsupported.length > 0) soft.push(`these figures are not in the evidence, so remove them or use the evidence's exact figures: ${unsupported.join(', ')}`)

  const claimed = claimedHits(all, ctx.evidence.claimedNames, { evidenceText, requirementText: ctx.requirementText })
  const unrequested = claimed.filter((c) => !c.requested).map((c) => c.name)
  if (unrequested.length > 0) soft.push(`these are listed in the profile without evidence and the job does not ask for them, so do not name them in the summary or bullets: ${unrequested.join(', ')}`)

  const names = introducedNames(all, { titles: ctx.evidence.profileTitles, companies: ctx.evidence.profileCompanies }, evidenceText)
  if (names.titles.length > 0) soft.push(`do not write job titles (code shows them): ${names.titles.join(', ')}`)
  if (names.companies.length > 0) soft.push(`do not write company names that are not in the evidence: ${names.companies.join(', ')}`)

  return { hard, soft, summary, bullets, unsupported, claimed }
}

/** Writes one employer's entry. Throws LLMError (invalid_output, timeout, ...). */
export async function writeExperience(ctx: WriteContext, emp: EmployerEvidence, instructions: { rules: string; brief: string | null; prompt: string }): Promise<ExperienceOutcome> {
  const call = await completeChecked(ctx.profileId, experiencePrompt(ctx, emp), ExperienceOutputSchema, {
    role: 'default',
    system: composeSystem(instructions.rules, instructions.brief, instructions.prompt, EXPERIENCE_OUTPUT_FORMAT),
    maxOutputTokens: MAX_OUTPUT_TOKENS.writeExperience,
    retryMaxOutputTokens: MAX_OUTPUT_TOKENS.writeExperienceRetry,
    temperature: 0.4,
    timeoutMs: TIME_BUDGET_MS.write,
    deadline: ctx.deadline,
    feature: CV_GENERATION_FEATURES.writeExperience,
    attribution: { jobApplicationId: ctx.jobApplicationId, runId: ctx.runId },
    label: 'experience section',
    check: (v) => analyseExperience(v, ctx, emp),
  })
  const a = analyseExperience(call.value, ctx, emp)
  // Within the limits even when a soft breach was accepted: never more bullets than evidence.
  const bullets = a.bullets.slice(0, emp.activities.length)
  const notes = [...call.softIssues.map((s) => `Accepted with a problem after the retry: ${s}.`)]
  const checkNotes: string[] = []
  const who = emp.employer.company
  if (a.unsupported.length > 0) {
    checkNotes.push(`${who}: ${a.unsupported.map((f) => `"${f}"`).join(', ')} could not be matched to the profile text. Worth a quick check.`)
  }
  for (const c of a.claimed.filter((c) => c.requested)) {
    notes.push(`"${c.name}" is a tool or skill you list without evidence; the job asks for it, so a bullet names it.`)
    checkNotes.push(`${who}: "${c.name}" is listed in your profile without evidence, and a bullet names it because the job asks for it. Worth a quick check.`)
  }
  if (emp.missing > 0) notes.push(`${emp.missing === 1 ? '1 selected activity is' : `${emp.missing} selected activities are`} no longer in the profile and was skipped.`)
  return {
    markdown: renderEmployerEntry(emp.employer, a.summary, bullets),
    summary: a.summary,
    bullets,
    model: call.model,
    usage: call.usage,
    retries: call.retries,
    notes,
    checkNotes,
  }
}
