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
import { CV_GENERATION_FEATURES, MAX_OUTPUT_TOKENS, TEMPERATURE, TIME_BUDGET_MS } from '../schema'
import { BULLET_MAX_WORDS, SUMMARY_MAX_WORDS } from './limits'
import { claimedHits, credentialProblems, introducedNames, projectReflected, repeatedFigures, unsupportedFigures, wordCount } from './checks'
import { evidenceTexts, figureIgnoredNames, type EmployerEvidence } from './evidence'
import { plainFeedback, plainLine, plainReasons } from './plain'
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

/** The most bullets an employer entry may have: its activities, plus one for each project that rides along as extra evidence. */
export const maxBullets = (emp: Pick<EmployerEvidence, 'activities' | 'projects'>) => emp.activities.length + emp.projects.length

/** The user message of an experience call. Pure; carries no name, employer, title or contact detail. */
export function experiencePrompt(ctx: Pick<WriteContext, 'brief' | 'strategy'>, emp: EmployerEvidence): string {
  const max = maxBullets(emp)
  const items = emp.activities.map((a) => `[${a.id}] ${a.kind}: ${a.text}${a.impact ? ` — impact: ${a.impact}` : ''}${a.highlighted ? ' (the candidate highlighted this)' : ''}`)
  // A current employer is written in the present tense, a finished one in the past.
  const tense = emp.employer.end === null ? 'present tense (the candidate works here now)' : 'past tense throughout (the candidate has left)'
  return [
    '# Brief',
    briefText(ctx.brief),
    '# Job requirements\n\nFor emphasis only. They are not facts about the candidate.',
    data('job_requirements', requirementsBlock(ctx.strategy)),
    `# Evidence for this employer\n\nThese items are everything you may state. Best first.`,
    data('evidence', items.join('\n') || '(none: write from the projects below)'),
    ...(emp.projects.length > 0
      ? [
          '# Projects at this employer\n\nExtra evidence, equal to the items above. Each project must be reflected: as a bullet of its own, or merged into a bullet that states the same outcome. The project below is the only source for what you say about it.',
          data('projects', emp.projects.map((p) => `[${p.id}] project "${p.name}": ${p.text.replace(/\n+/g, ' — ')}`).join('\n')),
        ]
      : []),
    `# Limits\n\n- Summary: one sentence, at most ${SUMMARY_MAX_WORDS} words.\n- Bullets: at most ${max}, each at most ${BULLET_MAX_WORDS} words, outcome and business impact first. Merge items that state the same outcome into ONE bullet.\n- Never repeat a figure within this entry: each number appears once, in the one place it fits best.\n- Voice: no pronouns ("I", "my", "we"); an implied subject. Use ${tense}.\n- Plain text only: no Markdown, links, HTML or ":::". Code builds the list from your strings.\n- Numbers exactly as in the evidence, whether you write them as digits or words; no title, company or date that the evidence does not contain.`,
    'Return the summary and the bullets as one JSON object matching the schema, in a ```json code block.',
  ].join('\n\n')
}

type Analysis = CheckResult & {
  /** Projects of this employer that the cleaned text does not reflect. */
  projectsMissed: string[]
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
  const why: string[] = []
  const problem = (long: string, short: string) => { soft.push(long); why.push(short) }
  const summary = plainLine(out.summary)
  const bullets = out.bullets.map(plainLine).filter(Boolean)
  const texts = evidenceTexts(emp)
  const evidenceText = texts.join('\n')
  const max = maxBullets(emp)

  // Not plain (or first person): retried once with feedback like any soft problem; the kept text is cleaned either way.
  const fields: Array<[string, string]> = [['the summary', out.summary], ...out.bullets.map((b, i): [string, string] => [`bullet ${i + 1}`, b])]
  for (const [label, text] of fields) {
    const f = plainFeedback(label, text)
    if (f) problem(f, plainReasons(text).join(', '))
  }

  if (summary === '') problem('the summary is empty; write one sentence', 'empty summary')
  else if (wordCount(summary) > SUMMARY_MAX_WORDS) problem(`the summary is ${wordCount(summary)} words; it must be at most ${SUMMARY_MAX_WORDS}`, `summary over ${SUMMARY_MAX_WORDS} words`)
  if (bullets.length === 0) problem('there are no bullets; write one per evidence item you use', 'no bullets')
  if (bullets.length > max) problem(`there are ${bullets.length} bullets; at most ${max} are allowed (merge items that state the same outcome)`, `${bullets.length} bullets, limit ${max}`)
  bullets.forEach((b, i) => {
    if (wordCount(b) > BULLET_MAX_WORDS) problem(`bullet ${i + 1} is ${wordCount(b)} words; each must be at most ${BULLET_MAX_WORDS}`, `bullet ${i + 1} over ${BULLET_MAX_WORDS} words`)
  })

  const all = [summary, ...bullets].join('\n')
  const names = figureIgnoredNames(ctx.evidence)
  const unsupported = unsupportedFigures(all, texts, names)
  if (unsupported.length > 0) problem(`these figures are not in the evidence (digits or words), so remove them or use the evidence's exact figures: ${unsupported.join(', ')}`, `figure ${unsupported.join(', ')} not in evidence`)

  // One figure, one place: a figure that two bullets (or the summary and a bullet) both state is a repeat.
  const repeated = repeatedFigures([summary, ...bullets], names)
  if (repeated.length > 0) problem(`these figures appear more than once in this entry; state each figure once, in the single bullet where it fits best, and merge bullets that state the same outcome: ${repeated.join(', ')}`, `duplicate figure ${repeated.join(', ')}`)

  const claimed = claimedHits(all, ctx.evidence.claimedNames, { evidenceText, requirementText: ctx.requirementText })
  const unrequested = claimed.filter((c) => !c.requested).map((c) => c.name)
  if (unrequested.length > 0) problem(`these are listed in the profile without evidence and the job does not ask for them, so do not name them in the summary or bullets: ${unrequested.join(', ')}`, `unevidenced skill or tool ${unrequested.join(', ')}`)

  const intro = introducedNames(all, { titles: ctx.evidence.profileTitles, companies: ctx.evidence.profileCompanies }, evidenceText)
  if (intro.titles.length > 0) problem(`do not write job titles (code shows them): ${intro.titles.join(', ')}`, `job title ${intro.titles.join(', ')}`)
  if (intro.companies.length > 0) problem(`do not write company names that are not in the evidence: ${intro.companies.join(', ')}`, `company name ${intro.companies.join(', ')}`)

  const creds = credentialProblems(all, ctx.evidence.credentials, evidenceText)
  for (const c of creds) problem(c.problem, `credential ${c.name}`)

  // Selected projects are evidence too: the text must reflect each one (its name, or its own distinctive words).
  const projectsMissed = emp.projects.filter((p) => !projectReflected(all, p)).map((p) => p.name)
  if (projectsMissed.length > 0) problem(`these selected projects are not reflected: ${projectsMissed.map((n) => `"${n}"`).join(', ')}; give each a bullet of its own or merge it into a bullet that states the same outcome, using only the project text`, `project ${projectsMissed.join(', ')} not reflected`)

  return { hard: [], soft, why: [...new Set(why)], summary, bullets, unsupported, claimed, inProgressNamed: creds.filter((c) => c.inProgress).map((c) => c.name), projectsMissed }
}

/**
 * An entry written by code from the candidate's own activity text: no model.
 * Used when the answer has no usable bullets, or the run has no time left for
 * the call. It claims nothing the evidence does not say.
 */
export function fallbackExperience(emp: EmployerEvidence): { summary: string; bullets: string[]; markdown: string; notes: string[] } {
  const bullets = emp.activities.map((a) => plainLine(a.text)).filter(Boolean)
  // A project has no activity text to reuse as a bullet, so it is named in the log instead of vanishing.
  const notes = emp.projects.map((p) => `Project "${p.name}" is not on the CV: this entry was made without a model call, from your activity text only.`)
  return { summary: '', bullets, markdown: renderEmployerEntry(emp.employer, '', bullets), notes }
}

/** Writes one employer's entry. Throws LLMError (invalid_output, timeout, ...). */
export async function writeExperience(ctx: WriteContext, emp: EmployerEvidence, instructions: { rules: string; brief: string | null; prompt: string }): Promise<ExperienceOutcome> {
  const call = await completeChecked(ctx.profileId, experiencePrompt(ctx, emp), ExperienceOutputSchema, {
    role: 'default',
    system: composeSystem(instructions.rules, instructions.brief, instructions.prompt, EXPERIENCE_OUTPUT_FORMAT),
    maxOutputTokens: MAX_OUTPUT_TOKENS.writeExperience,
    retryMaxOutputTokens: MAX_OUTPUT_TOKENS.writeExperienceRetry,
    temperature: TEMPERATURE.writeExperience,
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
  let bullets = a.bullets.slice(0, maxBullets(emp))
  if (bullets.length === 0) {
    const fb = fallbackExperience(emp)
    bullets = fb.bullets
    notes.push('The answer had no usable bullets, so the bullets are your own activity text from the profile.', ...fb.notes)
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
    retryReasons: call.retryReasons,
    notes,
    checks,
    checkNotes: checks.map((c) => c.text),
  }
}
