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
import { attributionOf, completeChecked, softIssueNotes, type CheckResult } from '../call'
import { countOf } from '../text'
import { CV_GENERATION_FEATURES, MAX_OUTPUT_TOKENS, TEMPERATURE, TIME_BUDGET_MS } from '../schema'
import { COMPETENCY_LABEL_MAX_WORDS, COMPETENCY_LABEL_MIN_WORDS, COMPETENCY_MAX_LABELS, COMPETENCY_MIN_LABELS, HEADLINE_MAX_WORDS, PROFILE_MAX_FIGURES, PROFILE_MAX_WORDS, PROFILE_SENTENCES, PROFILE_TARGET_MIN_WORDS } from './limits'
import { yearsPhrase } from './years'
import { splitSentences } from './bullets'
import { claimedHits, competencyLabelProblem, contentStems, credentialProblems, distinctNotableFigures, headlineTitleProblem, introducedNames, labelGroundedIn, labelReflectsCompetency, selfDescriptions, sharedFigures, unsupportedFigures, wordCount } from './checks'
import { evidenceTexts, figureIgnoredNames, type CapabilityEvidence } from './evidence'
import { plainFeedback, plainLine, plainReasons, shortenToWords, type PlainOptions } from './plain'
import { briefText, data, requirementsBlock } from './prompt'
import { renderNameGroups } from './render'
import type { CheckNote, WriteContext, WriterOutcome } from './types'

export const ProfileOutputSchema = z.object({
  profile: z.string().describe(`The professional profile, one plain-text paragraph of ${PROFILE_SENTENCES} sentences, ${PROFILE_TARGET_MIN_WORDS} to ${PROFILE_MAX_WORDS} words, written in the first person ("I build ...")`),
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

/**
 * The fewest labels the call is asked for (and code tops up to):
 * COMPETENCY_MIN_LABELS when the profile has at least that many competencies
 * (the selection holds them: Select fills to its floor), else no minimum, so a
 * profile with few competencies is not padded. Never more than the allowed `max`.
 */
export function minCompetencyLabels(ctx: Pick<WriteContext, 'evidence'>, max: number): number {
  return ctx.evidence.competencies.length >= COMPETENCY_MIN_LABELS ? Math.min(max, COMPETENCY_MIN_LABELS) : 0
}

/** The experience as the profile writer reads it: no names, titles or dates, only the written text. */
export function experienceDigest(employers: ReadonlyArray<{ summary: string; bullets: readonly string[] }>): string {
  return employers
    .map((e, i) => `Employer ${i + 1}${i === 0 ? ' (most recent)' : ''}:\n${e.summary ? `${e.summary}\n` : ''}${e.bullets.map((b) => `- ${b}`).join('\n')}`)
    .join('\n\n')
}

/** A profile sentence is a copy of a bullet when at least this share of its content words (stems) are in one bullet. */
export const PROFILE_COPY_SHARE = 0.8
/** ... and it has at least this many content words (a short sentence cannot "copy" anything). */
export const PROFILE_COPY_MIN_WORDS = 5
/** A sentence that carries a figure (the profile's proof sentence) is a copy only at this higher share. */
export const PROFILE_COPY_SHARE_WITH_FIGURE = 0.95
/** Sentences the profile keeps at least, whatever it copies. */
export const PROFILE_MIN_SENTENCES = 3

/** Whether `sentence` restates a bullet nearly verbatim (like repeatsSummary, but figures count: the profile may carry them). Pure. */
export function copiesBullet(sentence: string, bullets: readonly string[]): boolean {
  const share = /\d/.test(sentence) ? PROFILE_COPY_SHARE_WITH_FIGURE : PROFILE_COPY_SHARE
  const s = [...contentStems(sentence, 3)]
  if (s.length < PROFILE_COPY_MIN_WORDS) return false
  return bullets.some((b) => {
    const have = contentStems(b, 3)
    return s.filter((w) => have.has(w)).length / s.length >= share
  })
}

/**
 * The profile freed of sentences that copy a bullet. The first sentence (the
 * role and domain opener) and the second (the strongest-result sentence) are never dropped and at least PROFILE_MIN_SENTENCES
 * stay: when dropping would go below that, nothing is dropped and the copies
 * are only reported. Pure.
 */
export function dropCopiedSentences(profile: string, bullets: readonly string[]): { profile: string; dropped: string[]; kept: string[] } {
  const sentences = splitSentences(profile)
  const copies = sentences.map((s, i) => i > 1 && copiesBullet(s, bullets))
  const drop = copies.filter(Boolean).length
  if (drop === 0) return { profile, dropped: [], kept: [] }
  if (sentences.length - drop < PROFILE_MIN_SENTENCES) return { profile, dropped: [], kept: sentences.filter((_, i) => copies[i]) }
  return { profile: sentences.filter((_, i) => !copies[i]).join(' '), dropped: sentences.filter((_, i) => copies[i]), kept: [] }
}

export function profilePrompt(
  ctx: Pick<WriteContext, 'brief' | 'strategy' | 'yearsOfExperience'>,
  digest: string,
  competencies: readonly CapabilityEvidence[],
  maxLabels: number,
  minLabels = 0,
): string {
  const used = distinctNotableFigures(digest)
  const years = ctx.yearsOfExperience
  const yearsRule = typeof years === 'number' && years > 0
    ? `\n- Years of experience: the first sentence states exactly "${yearsPhrase(years)}" (those words, in the first person: "I've spent ${yearsPhrase(years)} ..."), and no other number of years anywhere.`
    : '\n- Do not state a number of years of experience.'
  return [
    '# Brief',
    briefText(ctx.brief),
    '# Job requirements\n\nFor emphasis only. They are not facts about the candidate. Use their key terms (what the company or product is, the domain, the audience) to say who the candidate is FOR THIS ROLE.',
    data('job_requirements', requirementsBlock(ctx.strategy)),
    '# The experience section as written\n\nEverything you claim must be visible here.',
    data('experience', digest || '(no experience bullets)'),
    `# Competencies chosen for this CV\n\nThe candidate's own competencies for this role: use their wording where it fits. Claim nothing the experience section does not support.`,
    data('competencies', competencies.length > 0 ? competencies.map((c) => `- ${c.name}`).join('\n') : '(none: return an empty list)'),
    `# Limits\n\n- Profile: ${PROFILE_SENTENCES} sentences, ${PROFILE_TARGET_MIN_WORDS} to ${PROFILE_MAX_WORDS} words, in the first person ("I build ...", "I've designed ..."; here and nowhere else). The FIRST sentence names the target role or domain in the job ad's own terms (what kind of company or product it is, the audience) and the years of experience when one is given below. The second gives the strongest result with its figure. The rest say what the candidate does and what comes of it, plainly. No slogans, no storyteller phrases.\n- Figures: at most ${PROFILE_MAX_FIGURES} in the profile and headline together. The profile MAY repeat the strongest figure the experience section also states (it is the top of page 1: the best proof belongs there); the headline and competency labels may not repeat one${used.length > 0 ? ` (the experience section uses: ${used.join(', ')})` : ''}.${yearsRule}\n- Never restate a bullet's sentence: the profile frames the story and points at proof; it does not copy the bullets.\n- Never write unsupported working-style or personality claims ("I work best where ...", "I thrive ...", "passionate", "a team player"). Say what was done, not what the candidate is like.\n- Headline: at most ${HEADLINE_MAX_WORDS} words, a descriptor and never a job title or seniority level; no first person.\n- Competencies: ${maxLabels === 0 ? 'none: return an empty list' : `write ${minLabels > 0 ? `${Math.min(minLabels, maxLabels)} to ` : 'up to '}${maxLabels} labels (only as many as the experience supports, up to the limit), built from the chosen competencies above and the key terms of the job's requirements where the experience section shows them; each a short noun phrase of ${COMPETENCY_LABEL_MIN_WORDS} to ${COMPETENCY_LABEL_MAX_WORDS} words, with no numbers and no sentence`}.\n- Plain text only: no Markdown, links, HTML or ":::".\n- Numbers exactly as in the evidence, whether you write them as digits or words; no title, company or date.\n- The brief's lead-with and emphasise lines are direction, not evidence. Claim no outcome, programme, result or framing for a project or theme the experience section has no bullet about, even when the brief names it.`,
    'Return the profile, headline and competency labels as one JSON object matching the schema, in a ```json code block.',
  ].join('\n\n')
}

type Check = {
  /** The cleaned (plainLine) answer; `competencies` holds only the valid, de-duplicated labels, at most the allowed number. */
  profile: ProfileOutput
  /** Labels that were dropped (not a 2-5 word noun phrase, a repeat, over the limit), with why. */
  droppedLabels: string[]
  /** Kept labels that overlap neither a selected competency nor the employers' evidence text: they may name something the profile does not back. */
  ungroundedLabels: string[]
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
const sourcesOf = (ctx: Pick<WriteContext, 'evidence' | 'yearsOfExperience'>, digest: string) => [
  digest,
  ...ctx.evidence.employers.flatMap(evidenceTexts),
  // The pending years opener: the owner's own number is a supported figure.
  ...(typeof ctx.yearsOfExperience === 'number' && ctx.yearsOfExperience > 0 ? [`${ctx.yearsOfExperience} years of experience`] : []),
]

const LABEL_BOUNDS = { min: COMPETENCY_LABEL_MIN_WORDS, max: COMPETENCY_LABEL_MAX_WORDS }

/** All code checks on one answer. Pure. */
export function analyseProfile(
  out: ProfileOutput,
  ctx: Pick<WriteContext, 'evidence' | 'requirementText' | 'yearsOfExperience'>,
  allowed: { digest: string; competencies: readonly CapabilityEvidence[]; maxLabels: number },
): CheckResult & Check {
  const hard: string[] = []
  const soft: string[] = []
  const why: string[] = []
  const problem = (long: string, short: string) => { soft.push(long); why.push(short) }
  const profile = plainLine(out.profile)
  const headline = plainLine(out.headline)
  // Verbatim names from the candidate's own text ("Our World in Data") are not first person: the wave-1 digest is model output, so it is not used.
  const ownText = [...ctx.evidence.employers.flatMap(evidenceTexts), ...ctx.evidence.profileCompanies, ...ctx.evidence.profileTitles].join('\n')
  // First person is allowed in the profile paragraph only (the headline and the labels stay impersonal).
  const fields: Array<[string, string, PlainOptions]> = [['the profile', out.profile, { allowFirstPerson: true }], ['the headline', out.headline, {}], ...out.competencies.map((c): [string, string, PlainOptions] => [`the competency "${c}"`, c, {}])]
  for (const [label, text, opts] of fields) {
    const f = plainFeedback(label, text, ownText, opts)
    if (f) problem(f, plainReasons(text, ownText, opts).join(', '))
  }
  if (!profile) hard.push('the profile is empty; write the paragraph')
  // Over the word cap (profile or headline) is NOT a retry reason (a retry doubles the call's cost): writeProfile shortens it in code.
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

  // Free-text labels must stay grounded: each overlaps a selected competency or the evidence text of the employers.
  const groundTexts = [...allowed.competencies.map((c) => c.name), ...ctx.evidence.employers.flatMap(evidenceTexts)]
  const ungroundedLabels = labels.filter((l) => !labelGroundedIn(l, groundTexts))
  if (ungroundedLabels.length > 0) problem(`these competency labels match none of the selected competencies or the experience evidence, so use only what they support: ${ungroundedLabels.map((l) => `"${l}"`).join(', ')}`, `competency label ${ungroundedLabels.map((l) => `"${l}"`).join(', ')} not backed by the profile`)

  const text = [profile, headline, ...labels].join('\n')
  // Figures may come from the experience text or from any selected evidence.
  const unsupported = unsupportedFigures(text, sources, ignored)
  if (unsupported.length > 0) problem(`these figures are not in the experience section (digits or words), so remove them or use its exact figures: ${unsupported.join(', ')}`, `figure ${unsupported.join(', ')} not in evidence`)
  // The profile (only) may repeat a figure the bullets state; the headline and the competency labels may not. At most PROFILE_MAX_FIGURES in the profile and headline together.
  const shared = sharedFigures([headline, ...labels].join('\n'), [allowed.digest], ignored)
  if (shared.length > 0) problem(`these figures already appear in the experience bullets, so do not repeat them in the headline or competencies (say it without the number, or use a different fact): ${shared.join(', ')}`, `duplicate figure ${shared.join(', ')}`)
  const own = distinctNotableFigures([profile, headline].join('\n'), ignored)
  const excess = own.length > PROFILE_MAX_FIGURES ? own.slice(PROFILE_MAX_FIGURES) : []
  if (excess.length > 0) problem(`the profile and headline may use at most ${PROFILE_MAX_FIGURES} figures; keep the most important and drop: ${excess.join(', ')}`, `more than ${PROFILE_MAX_FIGURES} figures in the profile`)
  // The years phrase is exact: "10+ years", never "10 years" or another number.
  if (typeof ctx.yearsOfExperience === 'number' && ctx.yearsOfExperience > 0) {
    const phrase = yearsPhrase(ctx.yearsOfExperience)
    const wrong = [...profile.matchAll(/\b(\d{1,2})(\+?)\s*(?:years|yrs)\b/gi)].filter((m) => Number(m[1]) !== ctx.yearsOfExperience || m[2] !== '+').map((m) => m[0])
    if (wrong.length > 0) problem(`state the years of experience exactly as "${phrase}" (those words, no other number of years): found ${wrong.map((w) => `"${w}"`).join(', ')}`, 'years phrase not exact')
  }
  const selfDescribed = selfDescriptions(profile)
  if (selfDescribed.length > 0) problem(`the profile makes working-style or personality claims the evidence cannot back; say what was done instead: ${selfDescribed.map((p) => `"${p}"`).join(', ')}`, 'unsupported self-description')
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
    hard, soft, why: [...new Set(why)], profile: { profile, headline, competencies: labels }, droppedLabels, ungroundedLabels, headlineProblem, headlineUnsupported, unsupported,
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

/**
 * The selected competency names that already are short noun-phrase labels,
 * de-duplicated, at most `max`; with the ones that were not usable (`skipped`)
 * and the usable ones that did not fit (`overflow`).
 */
export function labelsFromSelected(competencies: readonly CapabilityEvidence[], max: number): { labels: string[]; skipped: string[]; overflow: string[] } {
  const labels: string[] = []
  const skipped: string[] = []
  for (const c of competencies) {
    const label = plainLine(c.name)
    if (competencyLabelProblem(label, LABEL_BOUNDS)) skipped.push(c.name)
    else if (!labels.some((l) => l.toLowerCase() === label.toLowerCase())) labels.push(label)
  }
  return { labels: labels.slice(0, max), skipped, overflow: labels.slice(max) }
}

/**
 * Log notes for selected, evidenced competencies that no Core Competencies
 * label reflects (matched on the full name or its words, not the first word),
 * so none vanishes silently. A brief budget of 0 drops them all: said once.
 */
export function competencyNotes(competencies: readonly CapabilityEvidence[], labels: readonly string[], maxLabels: number): string[] {
  if (competencies.length === 0) return []
  if (maxLabels === 0) return [`Core Competencies is empty because the brief's competency budget is 0, so these selected competencies are not on the CV: ${competencies.map((c) => c.name).join(', ')}.`]
  const missing = competencies.filter((c) => !labels.some((l) => labelReflectsCompetency(l, c.name))).map((c) => c.name)
  return missing.length > 0 ? [`Selected ${missing.length === 1 ? 'competency is' : 'competencies are'} not reflected in Core Competencies, so ${missing.length === 1 ? 'it is' : 'they are'} not on the CV: ${missing.join(', ')}.`] : []
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
  // The ones that fit no room (more than the allowed labels, or a budget of 0) are named too.
  notes.push(...competencyNotes(competencies.filter((c) => !picked.skipped.includes(c.name)), picked.labels, maxLabels))
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
  /** The experience bullets as written: a profile sentence that copies one is dropped. */
  bullets: readonly string[] = [],
): Promise<ProfileOutcome> {
  const competencies = writableCompetencies(ctx.evidence.competencies)
  const maxLabels = maxCompetencyLabels(ctx)
  const allowed = { digest, competencies, maxLabels }
  const minLabels = minCompetencyLabels(ctx, maxLabels)
  const call = await completeChecked(ctx.profileId, profilePrompt(ctx, digest, competencies, maxLabels, minLabels), ProfileOutputSchema, {
    role: 'default',
    system: composeSystem(instructions.rules, instructions.brief, instructions.prompt, PROFILE_OUTPUT_FORMAT),
    maxOutputTokens: MAX_OUTPUT_TOKENS.writeProfile,
    retryMaxOutputTokens: MAX_OUTPUT_TOKENS.writeProfileRetry,
    temperature: TEMPERATURE.writeProfile,
    timeoutMs: TIME_BUDGET_MS.write,
    deadline: ctx.deadline,
    feature: CV_GENERATION_FEATURES.writeProfile,
    attribution: attributionOf(ctx),
    label: 'professional profile',
    check: (v) => analyseProfile(v, ctx, allowed),
  })
  const a = analyseProfile(call.value, ctx, allowed)
  const notes = softIssueNotes(call)
  const checks: CheckNote[] = []

  // Over the word cap: shortened here, in code, at a clause boundary (a retry would double the cost); else kept and noted.
  const fit = (text: string, max: number, what: string): string => {
    const n = wordCount(text)
    if (n <= max) return text
    const cut = shortenToWords(text, max)
    if (cut) { notes.push(`Shortened ${what} from ${n} to ${wordCount(cut)} words at a clause boundary (limit ${max}); no retry was made.`); return cut }
    notes.push(`${what[0].toUpperCase()}${what.slice(1)} is ${n} words, over the limit of ${max}; kept as written because shortening it would cut its meaning (no retry was made).`)
    return text
  }
  const copied = dropCopiedSentences(a.profile.profile, bullets)
  if (copied.dropped.length > 0) notes.push(`Dropped ${countOf(copied.dropped.length, 'profile sentence')} that restated a bullet nearly word for word: ${copied.dropped.map((d) => `"${d}"`).join(' ')}`)
  if (copied.kept.length > 0) notes.push(`${countOf(copied.kept.length, 'profile sentence')} restate${copied.kept.length === 1 ? 's' : ''} a bullet, but dropping ${copied.kept.length === 1 ? 'it' : 'them'} would leave under ${PROFILE_MIN_SENTENCES} sentences, so ${copied.kept.length === 1 ? 'it stays' : 'they stay'}.`)
  const profileText = fit(copied.profile, PROFILE_MAX_WORDS, 'the profile')

  let headline: string | null = a.profile.headline ? fit(a.profile.headline, HEADLINE_MAX_WORDS, 'the headline') : null
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
  // Labels the profile does not back are dropped, except as many as it takes to reach the minimum (which the top-up below would otherwise fill from selected ones).
  if (a.ungroundedLabels.length > 0) {
    const grounded = labels.filter((l) => !a.ungroundedLabels.includes(l))
    const room = Math.max(0, minLabels - grounded.length)
    const allowed = new Set(a.ungroundedLabels.slice(0, room))
    const dropped = a.ungroundedLabels.filter((l) => !allowed.has(l))
    if (dropped.length > 0) {
      labels = labels.filter((l) => !dropped.includes(l))
      notes.push(`Dropped from Core Competencies because your profile does not back them: ${dropped.join(', ')}.`)
    }
  }
  if (a.droppedLabels.length > 0) notes.push(`Left out of Core Competencies: ${a.droppedLabels.join('; ')}.`)
  if (labels.length === 0 && maxLabels > 0) {
    const picked = labelsFromSelected(competencies, maxLabels)
    labels = picked.labels
    if (labels.length > 0) notes.push('The answer had no usable competency labels, so Core Competencies uses your selected competency names.')
  }
  // Fewer labels than the minimum: top up from the selected competencies that already read as labels (no retry, no new claims).
  if (maxLabels > 0 && labels.length < minLabels) {
    const have = labels.length
    for (const l of labelsFromSelected(competencies, COMPETENCY_MAX_LABELS).labels) {
      if (labels.length >= minLabels) break
      if (!labels.some((x) => labelReflectsCompetency(x, l))) labels = [...labels, l]
    }
    if (labels.length > have) notes.push(`The answer had ${have} competency ${have === 1 ? 'label' : 'labels'}; added ${labels.length - have} from your selected competencies to reach ${minLabels}.`)
  }
  notes.push(...competencyNotes(competencies, labels, maxLabels))
  const keptUngrounded = labels.filter((l) => a.ungroundedLabels.includes(l))
  if (keptUngrounded.length > 0) {
    notes.push(`These Core Competencies labels match none of your selected competencies or experience text: ${keptUngrounded.join(', ')}.`)
    checks.push({ kind: 'competency', text: `Core Competencies: ${keptUngrounded.map((l) => `"${l}"`).join(', ')} could not be matched to your profile. Worth a quick check.` })
  }
  const skippedClaimed = ctx.evidence.competencies.filter((c) => c.claimed).map((c) => c.name)
  if (skippedClaimed.length > 0) {
    notes.push(`Left out of Core Competencies because the profile lists ${skippedClaimed.length === 1 ? 'it' : 'them'} without evidence: ${skippedClaimed.join(', ')}. ${skippedClaimed.length === 1 ? 'It is' : 'They are'} allowed in the Skills and Tools lists only.`)
  }
  return {
    markdown: '',
    headline,
    profileMarkdown: profileText,
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
