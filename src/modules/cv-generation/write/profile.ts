/**
 * The profile writer (wave 2): the professional profile, a short headline and
 * the competency lines, written AFTER wave 1 and shown its text, so nothing
 * can be claimed that the experience section does not support.
 *
 * Code checks after the answer (soft: one retry with feedback, then accept and
 * log): plain text only (plain.ts: the kept text is always cleaned); word
 * limits; figures and number words must be in the evidence or the wave-1 text;
 * a claimed tool or skill is named only when the job's requirements name it;
 * no title or company the model introduced; no certification or education the
 * evidence does not mention (an in-progress one only with in-progress
 * wording). The headline must not read as an employment title and must not
 * carry a figure the evidence does not support: if it still does after the
 * retry it is dropped, not shipped. Claimed competencies are never given to the
 * writer (they may appear in the Skills and Tools lists only), so Core
 * Competencies shows evidenced ones.
 */

import * as z from 'zod'
import { composeSystem } from '@/modules/llm/prompt-context'
import { completeChecked, softIssueNotes, type CheckResult } from '../call'
import { CV_GENERATION_FEATURES, MAX_OUTPUT_TOKENS, TIME_BUDGET_MS } from '../schema'
import { COMPETENCY_MAX_WORDS, HEADLINE_MAX_WORDS, PROFILE_MAX_WORDS } from './limits'
import { claimedHits, credentialProblems, headlineTitleProblem, introducedNames, unsupportedFigures, wordCount } from './checks'
import { evidenceTexts, figureIgnoredNames, type CapabilityEvidence } from './evidence'
import { plainFeedback, plainLine } from './plain'
import { briefText, data, requirementsBlock } from './prompt'
import type { CheckNote, WriteContext, WriterOutcome } from './types'

export const ProfileOutputSchema = z.object({
  profile: z.string().describe(`The professional profile, one short plain-text paragraph, at most ${PROFILE_MAX_WORDS} words`),
  headline: z.string().describe(`A short plain-text descriptor under the name, at most ${HEADLINE_MAX_WORDS} words; never a job title`),
  competencies: z.array(z.object({
    name: z.string().describe('A competency from the given list, copied exactly'),
    line: z.string().describe(`The competency followed by a short outcome-led phrase, plain text, at most ${COMPETENCY_MAX_WORDS} words in all`),
  })).default([]).describe('One line per competency, up to the number allowed'),
})
export type ProfileOutput = z.infer<typeof ProfileOutputSchema>

export const PROFILE_OUTPUT_FORMAT = `Output: one JSON object in a \`\`\`json code block, nothing else. It must match this JSON Schema. Limits in the descriptions are hard limits.
\`\`\`json
${JSON.stringify(z.toJSONSchema(ProfileOutputSchema, { io: 'input' }))}
\`\`\``

/** The competencies the writer may write lines for: the selected ones with evidence behind them. */
export function writableCompetencies(items: readonly CapabilityEvidence[]): CapabilityEvidence[] {
  return items.filter((c) => !c.claimed)
}

/** The experience as the profile writer reads it: no names, titles or dates, only the written text. */
export function experienceDigest(employers: ReadonlyArray<{ summary: string; bullets: readonly string[] }>): string {
  return employers
    .map((e, i) => `Employer ${i + 1}${i === 0 ? ' (most recent)' : ''}:\n${e.summary ? `${e.summary}\n` : ''}${e.bullets.map((b) => `- ${b}`).join('\n')}`)
    .join('\n\n')
}

export function profilePrompt(
  ctx: Pick<WriteContext, 'brief' | 'strategy'>,
  digest: string,
  competencies: readonly CapabilityEvidence[],
): string {
  return [
    '# Brief',
    briefText(ctx.brief),
    '# Job requirements\n\nFor emphasis only. They are not facts about the candidate.',
    data('job_requirements', requirementsBlock(ctx.strategy)),
    '# The experience section as written\n\nEverything you claim must be visible here.',
    data('experience', digest || '(no experience bullets)'),
    '# Competencies to write lines for (copy names exactly)',
    data('competencies', competencies.length > 0 ? competencies.map((c) => `- ${c.name}`).join('\n') : '(none: return an empty list)'),
    `# Limits\n\n- Profile: at most ${PROFILE_MAX_WORDS} words.\n- Headline: at most ${HEADLINE_MAX_WORDS} words, a descriptor and never a job title or seniority level.\n- Competencies: at most ${competencies.length} lines, each at most ${COMPETENCY_MAX_WORDS} words, outcome-led, from the experience section only.\n- Plain text only: no Markdown, links, HTML or ":::".\n- Numbers exactly as written in the experience section, whether you write them as digits or words; no title, company or date.`,
    'Return the profile, headline and competency lines as one JSON object matching the schema, in a ```json code block.',
  ].join('\n\n')
}

type Check = {
  /** The cleaned (plainLine) answer. */
  profile: ProfileOutput
  /** The headline problem, or null when it is fine. */
  headlineProblem: string | null
  /** Figures in the headline that nothing supports. */
  headlineUnsupported: string[]
  unsupported: string[]
  claimed: Array<{ name: string; requested: boolean }>
  inProgressNamed: string[]
}

/** The text sources a profile figure or name may come from: the wave-1 text and every selected evidence item. */
const sourcesOf = (ctx: Pick<WriteContext, 'evidence'>, digest: string) => [digest, ...ctx.evidence.employers.flatMap(evidenceTexts)]

/** All code checks on one answer. Pure. */
export function analyseProfile(
  out: ProfileOutput,
  ctx: Pick<WriteContext, 'evidence' | 'requirementText'>,
  allowed: { digest: string; competencies: readonly CapabilityEvidence[] },
): CheckResult & Check {
  const hard: string[] = []
  const soft: string[] = []
  const profile = plainLine(out.profile)
  const headline = plainLine(out.headline)
  for (const f of [plainFeedback('the profile', out.profile), plainFeedback('the headline', out.headline), ...out.competencies.map((c) => plainFeedback(`the "${c.name}" line`, c.line))]) if (f) soft.push(f)
  if (!profile) hard.push('the profile is empty; write the paragraph')
  else if (wordCount(profile) > PROFILE_MAX_WORDS) soft.push(`the profile is ${wordCount(profile)} words; it must be at most ${PROFILE_MAX_WORDS}`)
  if (wordCount(headline) > HEADLINE_MAX_WORDS) soft.push(`the headline is ${wordCount(headline)} words; it must be at most ${HEADLINE_MAX_WORDS}`)
  const headlineProblem = headline ? headlineTitleProblem(headline, ctx.evidence.profileTitles) : null
  if (headlineProblem) soft.push(`the headline is not acceptable: ${headlineProblem}`)

  const names = new Set(allowed.competencies.map((c) => c.name.trim().toLowerCase()))
  const lines = out.competencies
    .filter((c) => names.has(c.name.trim().toLowerCase()))
    .map((c) => ({ name: c.name, line: plainLine(c.line) }))
  if (lines.length > allowed.competencies.length) soft.push(`there are ${lines.length} competency lines; at most ${allowed.competencies.length} are allowed`)
  lines.forEach((c) => {
    if (wordCount(c.line) > COMPETENCY_MAX_WORDS) soft.push(`the "${c.name}" line is ${wordCount(c.line)} words; each must be at most ${COMPETENCY_MAX_WORDS}`)
  })

  const text = [profile, headline, ...lines.map((c) => c.line)].join('\n')
  // Figures may come from the experience text or from any selected evidence.
  const sources = sourcesOf(ctx, allowed.digest)
  const ignored = figureIgnoredNames(ctx.evidence)
  const unsupported = unsupportedFigures(text, sources, ignored)
  if (unsupported.length > 0) soft.push(`these figures are not in the experience section (digits or words), so remove them or use its exact figures: ${unsupported.join(', ')}`)
  const headlineUnsupported = headline ? unsupportedFigures(headline, sources, ignored) : []
  const claimed = claimedHits(text, ctx.evidence.claimedNames, { evidenceText: sources.join('\n'), requirementText: ctx.requirementText })
  const unrequested = claimed.filter((c) => !c.requested).map((c) => c.name)
  if (unrequested.length > 0) soft.push(`these are listed in the profile without evidence and the job does not ask for them, so do not name them: ${unrequested.join(', ')}`)
  const intro = introducedNames(text, { titles: ctx.evidence.profileTitles, companies: ctx.evidence.profileCompanies }, sources.join('\n'))
  if (intro.titles.length > 0) soft.push(`do not write job titles (code shows them): ${intro.titles.join(', ')}`)
  if (intro.companies.length > 0) soft.push(`do not write company names: ${intro.companies.join(', ')}`)
  const creds = credentialProblems(text, ctx.evidence.credentials, sources.join('\n'))
  for (const c of creds) soft.push(c.problem)

  return {
    hard, soft, profile: { profile, headline, competencies: lines }, headlineProblem, headlineUnsupported, unsupported, claimed,
    inProgressNamed: creds.filter((c) => c.inProgress).map((c) => c.name),
  }
}

export type ProfileOutcome = WriterOutcome & {
  /** The headline to show under the name; null when it was dropped or not written. */
  headline: string | null
  profileMarkdown: string
  /** The competency lines in the selected order, as Markdown bullets; '' when none. */
  competenciesMarkdown: string
}

const competencyBlock = (lines: readonly string[]) => (lines.length > 0 ? `:::compact-list\n${lines.map((l) => `- ${l}`).join('\n')}\n:::` : '')

/**
 * The profile section by code, with no model call: used when the run has too
 * little time left for the wave-2 call. The profile paragraph is the Brief's
 * positioning (cut to the word limit) when it passes the same code checks as a
 * written one (nothing beyond the evidence); otherwise there is no profile
 * paragraph. The competency lines are just the evidenced competency names. No
 * headline. Pure.
 */
export function fallbackProfile(
  ctx: Pick<WriteContext, 'brief' | 'evidence' | 'requirementText'>,
  digest: string,
  why: string,
): ProfileOutcome {
  const competencies = writableCompetencies(ctx.evidence.competencies)
  const notes = [`${why} The profile section was made by code from the brief and the selection, without a model call.`]
  const words = plainLine(ctx.brief.positioning).split(/\s+/).filter(Boolean)
  const candidate = words.slice(0, PROFILE_MAX_WORDS).join(' ')
  let profile = candidate
  if (candidate) {
    const a = analyseProfile({ profile: candidate, headline: '', competencies: [] }, ctx, { digest, competencies })
    if (a.soft.length > 0 || a.hard.length > 0) {
      profile = ''
      notes.push('The brief\'s positioning was not used as the profile paragraph because it claims something the evidence does not support.')
    }
  }
  if (!profile) notes.push('There is no profile paragraph.')
  return {
    markdown: '',
    headline: null,
    profileMarkdown: profile,
    competenciesMarkdown: competencyBlock(competencies.map((c) => plainLine(c.name)).filter(Boolean)),
    model: null,
    usage: { input: 0, output: 0, costUsd: 0, calls: 0 },
    retries: 0,
    notes,
    checks: [],
    checkNotes: [],
  }
}

/** Writes the profile, headline and competencies. Throws LLMError (invalid_output, timeout, ...). */
export async function writeProfile(
  ctx: WriteContext,
  digest: string,
  instructions: { rules: string; brief: string | null; prompt: string },
): Promise<ProfileOutcome> {
  const competencies = writableCompetencies(ctx.evidence.competencies)
  const allowed = { digest, competencies }
  const call = await completeChecked(ctx.profileId, profilePrompt(ctx, digest, competencies), ProfileOutputSchema, {
    role: 'default',
    system: composeSystem(instructions.rules, instructions.brief, instructions.prompt, PROFILE_OUTPUT_FORMAT),
    maxOutputTokens: MAX_OUTPUT_TOKENS.writeProfile,
    retryMaxOutputTokens: MAX_OUTPUT_TOKENS.writeProfileRetry,
    temperature: 0.4,
    timeoutMs: TIME_BUDGET_MS.write,
    deadline: ctx.deadline,
    feature: CV_GENERATION_FEATURES.writeProfile,
    attribution: { jobApplicationId: ctx.jobApplicationId, runId: ctx.runId },
    label: 'professional profile',
    check: (v) => analyseProfile(v, ctx, allowed),
  })
  const a = analyseProfile(call.value, ctx, allowed)
  const notes = softIssueNotes(call)
  const checks: CheckNote[] = []

  let headline: string | null = a.profile.headline || null
  if (headline && (a.headlineProblem || wordCount(headline) > HEADLINE_MAX_WORDS || a.headlineUnsupported.length > 0)) {
    const why = a.headlineProblem ?? (a.headlineUnsupported.length > 0 ? `it has figures the evidence does not support (${a.headlineUnsupported.join(', ')})` : 'it broke a limit')
    notes.push(`The headline was left out: ${why}. A headline that reads as a title, or states an unsupported figure, would be a false claim.`)
    headline = null
  }
  if (a.unsupported.length > 0) checks.push({ kind: 'figure', text: `Profile: ${a.unsupported.map((f) => `"${f}"`).join(', ')} could not be matched to the experience text. Worth a quick check.` })
  for (const c of a.claimed.filter((c) => c.requested)) {
    notes.push(`"${c.name}" is a tool or skill you list without evidence; the job asks for it, so the profile names it.`)
    checks.push({ kind: 'claimed', text: `Profile: "${c.name}" is listed in your profile without evidence, and the summary names it because the job asks for it. Worth a quick check.` })
  }
  for (const name of a.inProgressNamed) {
    checks.push({ kind: 'credential', text: `Profile: "${name}" is still in progress in your profile, and the text may present it as finished. Worth a quick check.` })
  }

  // Lines in the selected order, one per competency, each under its canonical name.
  const lineOf = new Map(a.profile.competencies.map((c) => [c.name.trim().toLowerCase(), c.line]))
  const lines = competencies.flatMap((c) => {
    const line = lineOf.get(c.name.trim().toLowerCase())
    return line ? [line] : []
  })
  const skippedClaimed = ctx.evidence.competencies.filter((c) => c.claimed).map((c) => c.name)
  if (skippedClaimed.length > 0) {
    notes.push(`Left out of Core Competencies because the profile lists ${skippedClaimed.length === 1 ? 'it' : 'them'} without evidence: ${skippedClaimed.join(', ')}. ${skippedClaimed.length === 1 ? 'It is' : 'They are'} allowed in the Skills and Tools lists only.`)
  }
  return {
    markdown: '',
    headline,
    profileMarkdown: a.profile.profile,
    competenciesMarkdown: competencyBlock(lines),
    model: call.model,
    usage: call.usage,
    retries: call.retries,
    notes,
    checks,
    checkNotes: checks.map((c) => c.text),
  }
}
