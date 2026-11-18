/**
 * The experience writer: ONE call per employer that shows bullets (wave 1).
 * It writes a one-sentence summary and the bullets (a list of strings) from
 * only that employer's selected evidence; code builds the `:::compact-list`
 * block and renders the heading (company, latest title, dates, progression)
 * around it, so a malformed block cannot fail the run.
 *
 * After the answer, code checks (checks.ts), all soft: plain text only
 * (plain.ts), word and bullet limits, figures and number words the evidence
 * does not support, claimed tools, certifications and education that are not
 * in the evidence (or in progress but written as held), and titles / companies
 * the model introduced. One retry with feedback, then clean, accept and log.
 * At most TWO calls.
 */

import * as z from 'zod'
import { composeSystem } from '@/modules/llm/prompt-context'
import { completeChecked, softIssueNotes, type CheckResult } from '../call'
import { CV_GENERATION_FEATURES, MAX_OUTPUT_TOKENS, TIME_BUDGET_MS } from '../schema'
import { BULLET_MAX_WORDS, SUMMARY_MAX_WORDS } from './limits'
import { claimedHits, credentialProblems, introducedNames, unsupportedFigures, wordCount } from './checks'
import { evidenceTexts, figureIgnoredNames, type EmployerEvidence } from './evidence'
import { plainFeedback, plainLine } from './plain'
import { briefText, data, requirementsBlock } from './prompt'
import { renderEmployerEntry } from './render'
import type { CheckNote, WriteContext, WriterOutcome } from './types'

export type ExperienceOutcome = WriterOutcome & { summary: string; bullets: string[] }

export const ExperienceOutputSchema = z.object({
  summary: z.string().describe(`One plain sentence on what the candidate was responsible for, at most ${SUMMARY_MAX_WORDS} words`),
  bullets: z.array(z.string()).default([]).describe(`The bullets, one plain-text string each, without "- " or any Markdown, at most ${BULLET_MAX_WORDS} words each`),
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
    `# Limits\n\n- Summary: one sentence, at most ${SUMMARY_MAX_WORDS} words.\n- Bullets: at most ${max}, each at most ${BULLET_MAX_WORDS} words, outcome and business impact first.\n- Plain text only: no Markdown, links, HTML or ":::". Code builds the list from your strings.\n- Numbers exactly as in the evidence, whether you write them as digits or words; no title, company or date that the evidence does not contain.`,
    'Return the summary and the bullets as one JSON object matching the schema, in a ```json code block.',
  ].join('\n\n')
}

type Analysis = CheckResult & {
  /** Cleaned (plainLine). */
  summary: string
  /** Cleaned (plainLine), empty ones dropped. */
  bullets: string[]
  /** Figures that no evidence item supports, after the checks. */
  unsupported: string[]
  /** Claimed names mentioned, with whether the job's requirements name them. */
  claimed: Array<{ name: string; requested: boolean }>
  /** In-progress certifications or education the text names without in-progress wording. */
  inProgressNamed: string[]
}

/** All code checks on one answer. Pure. The summary and bullets in the result are already cleaned. */
export function analyseExperience(out: ExperienceOutput, ctx: Pick<WriteContext, 'evidence' | 'requirementText'>, emp: EmployerEvidence): Analysis {
  const soft: string[] = []
  const summary = plainLine(out.summary)
  const bullets = out.bullets.map(plainLine).filter(Boolean)
  const texts = evidenceTexts(emp)
  const evidenceText = texts.join('\n')

  // Not plain: retried once with feedback like any soft problem; the kept text is cleaned either way.
  for (const f of [plainFeedback('the summary', out.summary), ...out.bullets.map((b, i) => plainFeedback(`bullet ${i + 1}`, b))]) if (f) soft.push(f)

  if (summary === '') soft.push('the summary is empty; write one sentence')
  else if (wordCount(summary) > SUMMARY_MAX_WORDS) soft.push(`the summary is ${wordCount(summary)} words; it must be at most ${SUMMARY_MAX_WORDS}`)
  if (bullets.length === 0) soft.push('there are no bullets; write one per evidence item you use')
  if (bullets.length > emp.activities.length) soft.push(`there are ${bullets.length} bullets; at most ${emp.activities.length} (one per evidence item) are allowed`)
  bullets.forEach((b, i) => {
    if (wordCount(b) > BULLET_MAX_WORDS) soft.push(`bullet ${i + 1} is ${wordCount(b)} words; each must be at most ${BULLET_MAX_WORDS}`)
  })

  const all = [summary, ...bullets].join('\n')
  const unsupported = unsupportedFigures(all, texts, figureIgnoredNames(ctx.evidence))
  if (unsupported.length > 0) soft.push(`these figures are not in the evidence (digits or words), so remove them or use the evidence's exact figures: ${unsupported.join(', ')}`)

  const claimed = claimedHits(all, ctx.evidence.claimedNames, { evidenceText, requirementText: ctx.requirementText })
  const unrequested = claimed.filter((c) => !c.requested).map((c) => c.name)
  if (unrequested.length > 0) soft.push(`these are listed in the profile without evidence and the job does not ask for them, so do not name them in the summary or bullets: ${unrequested.join(', ')}`)

  const names = introducedNames(all, { titles: ctx.evidence.profileTitles, companies: ctx.evidence.profileCompanies }, evidenceText)
  if (names.titles.length > 0) soft.push(`do not write job titles (code shows them): ${names.titles.join(', ')}`)
  if (names.companies.length > 0) soft.push(`do not write company names that are not in the evidence: ${names.companies.join(', ')}`)

  const creds = credentialProblems(all, ctx.evidence.credentials, evidenceText)
  for (const c of creds) soft.push(c.problem)

  return { hard: [], soft, summary, bullets, unsupported, claimed, inProgressNamed: creds.filter((c) => c.inProgress).map((c) => c.name) }
}

/**
 * An entry written by code from the candidate's own activity text: no model.
 * Used when the answer has no usable bullets, or the run has no time left for
 * the call. It claims nothing the evidence does not say.
 */
export function fallbackExperience(emp: EmployerEvidence): { summary: string; bullets: string[]; markdown: string } {
  const bullets = emp.activities.map((a) => plainLine(a.text)).filter(Boolean)
  return { summary: '', bullets, markdown: renderEmployerEntry(emp.employer, '', bullets) }
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
  const notes = softIssueNotes(call)
  const checks: CheckNote[] = []
  const who = emp.employer.company
  // Within the limits even when a soft breach was accepted: never more bullets than evidence.
  let bullets = a.bullets.slice(0, emp.activities.length)
  if (bullets.length === 0) {
    bullets = fallbackExperience(emp).bullets
    notes.push('The answer had no usable bullets, so the bullets are your own activity text from the profile.')
  }
  if (a.unsupported.length > 0) {
    checks.push({ kind: 'figure', text: `${who}: ${a.unsupported.map((f) => `"${f}"`).join(', ')} could not be matched to the profile text. Worth a quick check.` })
  }
  for (const c of a.claimed.filter((c) => c.requested)) {
    notes.push(`"${c.name}" is a tool or skill you list without evidence; the job asks for it, so the text names it.`)
    checks.push({ kind: 'claimed', text: `${who}: "${c.name}" is listed in your profile without evidence, and the text names it because the job asks for it. Worth a quick check.` })
  }
  for (const name of a.inProgressNamed) {
    checks.push({ kind: 'credential', text: `${who}: "${name}" is still in progress in your profile, and the text may present it as finished. Worth a quick check.` })
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
    checks,
    checkNotes: checks.map((c) => c.text),
  }
}
