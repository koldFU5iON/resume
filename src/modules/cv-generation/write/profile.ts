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
import { CV_GENERATION_FEATURES, MAX_OUTPUT_TOKENS, TEMPERATURE, TIME_BUDGET_MS } from '../schema'
import { COMPETENCY_LABEL_MAX_WORDS, COMPETENCY_LABEL_MIN_WORDS, COMPETENCY_MAX_LABELS, HEADLINE_MAX_WORDS, PROFILE_MAX_FIGURES, PROFILE_MAX_WORDS } from './limits'
import { claimedHits, competencyLabelProblem, credentialProblems, distinctNotableFigures, headlineTitleProblem, introducedNames, sharedFigures, unsupportedFigures, wordCount } from './checks'
import { evidenceTexts, figureIgnoredNames, type CapabilityEvidence } from './evidence'
import { plainFeedback, plainLine, plainReasons } from './plain'
import { briefText, data, requirementsBlock } from './prompt'
import { renderNameGroups } from './render'
import type { CheckNote, WriteContext, WriterOutcome } from './types'

export const ProfileOutputSchema = z.object({
  profile: z.string().describe(`The professional profile, one short plain-text paragraph, at most ${PROFILE_MAX_WORDS} words, with no first person`),
  headline: z.string().describe(`A short plain-text descriptor under the name, at most ${HEADLINE_MAX_WORDS} words; never a job title`),
  competencies: z.array(z.string()).default([]).describe(`Core competency labels: short noun phrases of ${COMPETENCY_LABEL_MIN_WORDS} to ${COMPETENCY_LABEL_MAX_WORDS} words, no numbers, no sentences (for example "Go-to-market strategy")`),
})
export type ProfileOutput = z.infer<typeof ProfileOutputSchema>

export const PROFILE_OUTPUT_FORMAT = `Output: one JSON object in a \`\`\`json code block, nothing else. It must match this JSON Schema. Limits in the descriptions are hard limits.
\`\`\`json
${JSON.stringify(z.toJSONSchema(ProfileOutputSchema, { io: 'input' }))}
\`\`\``

/** The selected competencies with evidence behind them: what the labels may draw on (a claimed one is never given to the writer). */
export function writableCompetencies(items: readonly CapabilityEvidence[]): CapabilityEvidence[] {
  return items.filter((c) => !c.claimed)
}

/** How many competency labels the CV shows: none when no evidenced competency was selected or the brief budgets none, else the budget up to COMPETENCY_MAX_LABELS. */
export function maxCompetencyLabels(ctx: Pick<WriteContext, 'brief' | 'evidence'>): number {
  if (writableCompetencies(ctx.evidence.competencies).length === 0) return 0
  return Math.max(0, Math.min(COMPETENCY_MAX_LABELS, ctx.brief.budgets.competencies))
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
  maxLabels: number,
): string {
  const used = distinctNotableFigures(digest)
  return [
    '# Brief',
    briefText(ctx.brief),
    '# Job requirements\n\nFor emphasis only. They are not facts about the candidate. Use their key terms (what the company or product is, the domain, the audience) to say who the candidate is FOR THIS ROLE.',
    data('job_requirements', requirementsBlock(ctx.strategy)),
    '# The experience section as written\n\nEverything you claim must be visible here.',
    data('experience', digest || '(no experience bullets)'),
    `# Competencies chosen for this CV\n\nThe candidate's own competencies for this role: use their wording where it fits. Claim nothing the experience section does not support.`,
    data('competencies', competencies.length > 0 ? competencies.map((c) => `- ${c.name}`).join('\n') : '(none: return an empty list)'),
    `# Limits\n\n- Profile: at most ${PROFILE_MAX_WORDS} words. Open with the positioning for THIS role, in the brief's positioning and hidden-question language and the job's key terms; then what the candidate has done. No first person ("I", "my", "we"): an implied subject, present tense.\n- Figures: at most ${PROFILE_MAX_FIGURES} in the profile and headline together, and never one that already appears in the experience section${used.length > 0 ? ` (those are: ${used.join(', ')})` : ''}. The experience section carries the numbers; do not restate them.\n- Headline: at most ${HEADLINE_MAX_WORDS} words, a descriptor and never a job title or seniority level.\n- Competencies: ${maxLabels === 0 ? 'none: return an empty list' : `up to ${maxLabels} labels, each a short noun phrase of ${COMPETENCY_LABEL_MIN_WORDS} to ${COMPETENCY_LABEL_MAX_WORDS} words, with no numbers and no sentence`}.\n- Plain text only: no Markdown, links, HTML or ":::".\n- Numbers exactly as in the evidence, whether you write them as digits or words; no title, company or date.`,
    'Return the profile, headline and competency labels as one JSON object matching the schema, in a ```json code block.',
  ].join('\n\n')
}

type Check = {
  /** The cleaned (plainLine) answer; `competencies` holds only the valid, de-duplicated labels, at most the allowed number. */
  profile: ProfileOutput
  /** Labels that were dropped (not a 2-5 word noun phrase, a repeat, over the limit), with why. */
  droppedLabels: string[]
  /** The headline problem, or null when it is fine. */
  headlineProblem: string | null
  /** Figures in the headline that nothing supports. */
  headlineUnsupported: string[]
  unsupported: string[]
  /** Figures the profile or headline shares with the experience text, or states in excess of PROFILE_MAX_FIGURES. */
  repeatedFigures: string[]
  claimed: Array<{ name: string; requested: boolean }>
  inProgressNamed: string[]
}

/** The text sources a profile figure or name may come from: the wave-1 text and every selected evidence item. */
const sourcesOf = (ctx: Pick<WriteContext, 'evidence'>, digest: string) => [digest, ...ctx.evidence.employers.flatMap(evidenceTexts)]

const LABEL_BOUNDS = { min: COMPETENCY_LABEL_MIN_WORDS, max: COMPETENCY_LABEL_MAX_WORDS }

/** All code checks on one answer. Pure. */
export function analyseProfile(
  out: ProfileOutput,
  ctx: Pick<WriteContext, 'evidence' | 'requirementText'>,
  allowed: { digest: string; competencies: readonly CapabilityEvidence[]; maxLabels: number },
): CheckResult & Check {
  const hard: string[] = []
  const soft: string[] = []
  const why: string[] = []
  const problem = (long: string, short: string) => { soft.push(long); why.push(short) }
  const profile = plainLine(out.profile)
  const headline = plainLine(out.headline)
  const fields: Array<[string, string]> = [['the profile', out.profile], ['the headline', out.headline], ...out.competencies.map((c): [string, string] => [`the competency "${c}"`, c])]
  for (const [label, text] of fields) {
    const f = plainFeedback(label, text)
    if (f) problem(f, plainReasons(text).join(', '))
  }
  if (!profile) hard.push('the profile is empty; write the paragraph')
  else if (wordCount(profile) > PROFILE_MAX_WORDS) problem(`the profile is ${wordCount(profile)} words; it must be at most ${PROFILE_MAX_WORDS}`, `profile over ${PROFILE_MAX_WORDS} words`)
  if (wordCount(headline) > HEADLINE_MAX_WORDS) problem(`the headline is ${wordCount(headline)} words; it must be at most ${HEADLINE_MAX_WORDS}`, `headline over ${HEADLINE_MAX_WORDS} words`)
  const headlineProblem = headline ? headlineTitleProblem(headline, ctx.evidence.profileTitles) : null
  if (headlineProblem) problem(`the headline is not acceptable: ${headlineProblem}`, 'headline reads as a title')

  const sources = sourcesOf(ctx, allowed.digest)
  const ignored = figureIgnoredNames(ctx.evidence)
  const claimedCompetencies = new Set(ctx.evidence.competencies.filter((c) => c.claimed).map((c) => c.name.trim().toLowerCase()))

  // Competency labels: short noun phrases, de-duplicated, at most the allowed number.
  const labels: string[] = []
  const droppedLabels: string[] = []
  const badLabels: string[] = []
  for (const raw of out.competencies) {
    const label = plainLine(raw)
    const bad = competencyLabelProblem(label, LABEL_BOUNDS)
    if (bad) { badLabels.push(bad); droppedLabels.push(bad); continue }
    if (labels.some((l) => l.toLowerCase() === label.toLowerCase())) { droppedLabels.push(`"${label}" appears twice`); continue }
    // A claimed competency is never written into Core Competencies (decision 5); nor is any other unevidenced name the job does not ask for.
    const claimedIn = claimedHits(label, ctx.evidence.claimedNames, { evidenceText: sources.join('\n'), requirementText: ctx.requirementText })
      .filter((h) => !h.requested || claimedCompetencies.has(h.name.toLowerCase()))
    if (claimedIn.length > 0) { droppedLabels.push(`"${label}" names ${claimedIn.map((h) => h.name).join(', ')}, which your profile lists without evidence`); continue }
    labels.push(label)
  }
  if (badLabels.length > 0) problem(`competency labels must be short noun phrases of ${COMPETENCY_LABEL_MIN_WORDS} to ${COMPETENCY_LABEL_MAX_WORDS} words with no numbers and no sentences: ${badLabels.join('; ')}`, 'competency label format')
  if (labels.length > allowed.maxLabels) {
    problem(`there are ${labels.length} competency labels; at most ${allowed.maxLabels} are allowed`, `${labels.length} competency labels, limit ${allowed.maxLabels}`)
    droppedLabels.push(...labels.slice(allowed.maxLabels).map((l) => `"${l}" is over the limit of ${allowed.maxLabels}`))
    labels.length = allowed.maxLabels
  }

  const text = [profile, headline, ...labels].join('\n')
  // Figures may come from the experience text or from any selected evidence.
  const unsupported = unsupportedFigures(text, sources, ignored)
  if (unsupported.length > 0) problem(`these figures are not in the experience section (digits or words), so remove them or use its exact figures: ${unsupported.join(', ')}`, `figure ${unsupported.join(', ')} not in evidence`)
  // The experience section carries the numbers: the profile and competencies may not restate them, and use at most one of their own.
  const shared = sharedFigures(text, [allowed.digest], ignored)
  if (shared.length > 0) problem(`these figures already appear in the experience bullets, so do not repeat them in the profile, headline or competencies (say it without the number, or use a different fact): ${shared.join(', ')}`, `duplicate figure ${shared.join(', ')}`)
  const own = distinctNotableFigures([profile, headline].join('\n'), ignored).filter((f) => !shared.includes(f))
  const excess = own.length + shared.length > PROFILE_MAX_FIGURES ? own.slice(Math.max(0, PROFILE_MAX_FIGURES - shared.length)) : []
  if (excess.length > 0) problem(`the profile and headline may use at most ${PROFILE_MAX_FIGURES} figure; keep the most important and drop: ${excess.join(', ')}`, `more than ${PROFILE_MAX_FIGURES} figure in the profile`)
  const headlineUnsupported = headline ? unsupportedFigures(headline, sources, ignored) : []
  const claimed = claimedHits(text, ctx.evidence.claimedNames, { evidenceText: sources.join('\n'), requirementText: ctx.requirementText })
  const unrequested = claimed.filter((c) => !c.requested).map((c) => c.name)
  if (unrequested.length > 0) problem(`these are listed in the profile without evidence and the job does not ask for them, so do not name them: ${unrequested.join(', ')}`, `unevidenced skill or tool ${unrequested.join(', ')}`)
  const intro = introducedNames(text, { titles: ctx.evidence.profileTitles, companies: ctx.evidence.profileCompanies }, sources.join('\n'))
  if (intro.titles.length > 0) problem(`do not write job titles (code shows them): ${intro.titles.join(', ')}`, `job title ${intro.titles.join(', ')}`)
  if (intro.companies.length > 0) problem(`do not write company names: ${intro.companies.join(', ')}`, `company name ${intro.companies.join(', ')}`)
  const creds = credentialProblems(text, ctx.evidence.credentials, sources.join('\n'))
  for (const c of creds) problem(c.problem, `credential ${c.name}`)

  return {
    hard, soft, why: [...new Set(why)], profile: { profile, headline, competencies: labels }, droppedLabels, headlineProblem, headlineUnsupported, unsupported,
    repeatedFigures: [...shared, ...excess], claimed, inProgressNamed: creds.filter((c) => c.inProgress).map((c) => c.name),
  }
}

export type ProfileOutcome = WriterOutcome & {
  /** The headline to show under the name; null when it was dropped or not written. */
  headline: string | null
  profileMarkdown: string
  /** The competency lines in the selected order, as Markdown bullets; '' when none. */
  competenciesMarkdown: string
}

/** Core Competencies as an inline `:::skills` list of short labels (like the regression fixture); '' when there are none. */
export const competencyBlock = (labels: readonly string[]) => renderNameGroups([{ label: null, names: [...labels] }], 'skills')

/** The selected competency names that already are short noun-phrase labels, de-duplicated, at most `max`; with the ones that were not usable. */
export function labelsFromSelected(competencies: readonly CapabilityEvidence[], max: number): { labels: string[]; skipped: string[] } {
  const labels: string[] = []
  const skipped: string[] = []
  for (const c of competencies) {
    const label = plainLine(c.name)
    if (competencyLabelProblem(label, LABEL_BOUNDS)) skipped.push(c.name)
    else if (!labels.some((l) => l.toLowerCase() === label.toLowerCase())) labels.push(label)
  }
  return { labels: labels.slice(0, max), skipped }
}

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
  const maxLabels = maxCompetencyLabels(ctx)
  const picked = labelsFromSelected(competencies, maxLabels)
  const notes = [`${why} The profile section was made by code from the brief and the selection, without a model call.`]
  if (picked.skipped.length > 0) notes.push(`Left out of Core Competencies because they are not a short noun phrase of ${COMPETENCY_LABEL_MIN_WORDS} to ${COMPETENCY_LABEL_MAX_WORDS} words: ${picked.skipped.join(', ')}.`)
  const words = plainLine(ctx.brief.positioning).split(/\s+/).filter(Boolean)
  const candidate = words.slice(0, PROFILE_MAX_WORDS).join(' ')
  let profile = candidate
  if (candidate) {
    const a = analyseProfile({ profile: candidate, headline: '', competencies: [] }, ctx, { digest, competencies, maxLabels })
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
    competenciesMarkdown: competencyBlock(picked.labels),
    model: null,
    usage: { input: 0, output: 0, costUsd: 0, calls: 0 },
    retries: 0,
    retryReasons: [],
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
  const maxLabels = maxCompetencyLabels(ctx)
  const allowed = { digest, competencies, maxLabels }
  const call = await completeChecked(ctx.profileId, profilePrompt(ctx, digest, competencies, maxLabels), ProfileOutputSchema, {
    role: 'default',
    system: composeSystem(instructions.rules, instructions.brief, instructions.prompt, PROFILE_OUTPUT_FORMAT),
    maxOutputTokens: MAX_OUTPUT_TOKENS.writeProfile,
    retryMaxOutputTokens: MAX_OUTPUT_TOKENS.writeProfileRetry,
    temperature: TEMPERATURE.writeProfile,
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

  // Core Competencies: the writer's valid labels; when it gave none usable, the selected names that already are labels.
  let labels = a.profile.competencies
  if (a.droppedLabels.length > 0) notes.push(`Left out of Core Competencies: ${a.droppedLabels.join('; ')}.`)
  if (labels.length === 0 && maxLabels > 0) {
    const picked = labelsFromSelected(competencies, maxLabels)
    labels = picked.labels
    if (labels.length > 0) notes.push('The answer had no usable competency labels, so Core Competencies uses your selected competency names.')
  }
  const skippedClaimed = ctx.evidence.competencies.filter((c) => c.claimed).map((c) => c.name)
  if (skippedClaimed.length > 0) {
    notes.push(`Left out of Core Competencies because the profile lists ${skippedClaimed.length === 1 ? 'it' : 'them'} without evidence: ${skippedClaimed.join(', ')}. ${skippedClaimed.length === 1 ? 'It is' : 'They are'} allowed in the Skills and Tools lists only.`)
  }
  return {
    markdown: '',
    headline,
    profileMarkdown: a.profile.profile,
    competenciesMarkdown: competencyBlock(labels),
    model: call.model,
    usage: call.usage,
    retries: call.retries,
    retryReasons: call.retryReasons,
    notes,
    checks,
    checkNotes: checks.map((c) => c.text),
  }
}
