/**
 * The three model stages of a cover letter run (issue #471):
 *
 * - Angles (`analysis`): 3 distinct angles and 2-3 personal questions, before
 *   anything is written. Each angle's company fact is checked in code
 *   against the research and the job description (`whyThemVerified`).
 * - Write (default role): the letter from the chosen angle, answers, tone and
 *   length. Code checks length, generic phrases and figures (one retry, then
 *   accepted with notes) and builds the desk Markdown (header, {{contact}},
 *   name).
 * - Review (`analysis`): a fresh recruiter read. Its edits are applied only
 *   when the quoted text is found exactly once and the edited paragraph adds
 *   no unsupported figure or generic phrase; concerns go to the coach. Review
 *   never fails the run.
 *
 * Feature code names a role, never a model id. Calls go through the CV
 * generator's validated-call helpers (one retry, usage from the results).
 */

import * as z from 'zod'
import { composeSystem, loadWritingContext } from '@/modules/llm/prompt-context'
import { loadPromptText } from '@/modules/prompts/loader'
import { attributionOf, completeChecked, completeValidated, type CallUsage } from '@/modules/cv-generation/call'
import { checkLetter, findCliches, isFactSupported, letterMarkdown, unsupportedFigures, wordCount } from './checks'
import { contextPrompt, type Gathered } from './gather'
import {
  AnglesOutputSchema,
  COVER_LETTER_FEATURES,
  LENGTH_WORDS,
  MAX_OUTPUT_TOKENS,
  ReviewOutputSchema,
  TIME_BUDGET_MS,
  TONE_LABELS,
  WriteOutputSchema,
  type CoverLetterChoice,
  type CoverLetterReview,
  type CoverLetterWritten,
  type StoredAngles,
  type WriteOutput,
} from './schema'

export type StageContext = { profileId: string; jobApplicationId: string; runId: string; deadline: number; writingDeskDocumentId?: string | null }

const outputFormat = (schema: z.ZodType) =>
  `## Output format\n\nReturn ONE JSON object matching this JSON Schema, in a \`\`\`json code block, and nothing else:\n\n${JSON.stringify(z.toJSONSchema(schema, { io: 'input' }))}`

/** The texts a "why them" fact may come from. */
function companySources(g: Gathered): string[] {
  return [...g.companyFacts, g.job.description, g.job.company ?? '', g.job.title]
}

// ── Angles ────────────────────────────────────────────────────────────────

export async function runAngles(g: Gathered, ctx: StageContext): Promise<{ value: StoredAngles; model: string; retries: number; usage: CallUsage; notes: string[] }> {
  const instructions = await loadPromptText(ctx.profileId, 'cl-gen-angles')
  const result = await completeValidated(ctx.profileId, `${contextPrompt(g)}\n\nSuggest the angles and questions now.`, AnglesOutputSchema, {
    role: 'analysis',
    system: composeSystem(instructions, outputFormat(AnglesOutputSchema)),
    maxOutputTokens: MAX_OUTPUT_TOKENS.angles,
    retryMaxOutputTokens: MAX_OUTPUT_TOKENS.anglesRetry,
    temperature: 0.6,
    timeoutMs: TIME_BUDGET_MS.angles,
    deadline: ctx.deadline,
    feature: COVER_LETTER_FEATURES.angles,
    attribution: attributionOf(ctx),
    label: 'angles',
  })
  const sources = companySources(g)
  const angles = result.value.angles.map((a) => ({ ...a, whyThemVerified: isFactSupported(a.whyThem.fact, sources) }))
  const unverified = angles.filter((a) => !a.whyThemVerified)
  const notes = [
    `Suggested ${angles.length} angles and ${result.value.questions.length} personal questions; suggested tone ${result.value.suggestedTone}.`,
    ...unverified.map((a) => `The company fact in "${a.name}" wasn't found in the research or the job description; it is marked to check.`),
  ]
  return { value: { ...result.value, angles }, model: result.model, retries: result.retries, usage: result.usage, notes }
}

// ── Write ─────────────────────────────────────────────────────────────────

function chosenAnglePrompt(angles: StoredAngles | null, choice: CoverLetterChoice): string {
  if ('custom' in choice.angle) return `# Chosen angle (written by the candidate)\n\n${choice.angle.custom}`
  const a = angles?.angles[choice.angle.index]
  if (!a) return '# Chosen angle\n\n(none: write the strongest honest letter for this job)'
  return [
    `# Chosen angle: ${a.name}`,
    `Pitch: ${a.pitch}`,
    `Opening hook: ${a.hook}`,
    `Proof points:\n${a.proofPoints.map((p) => `- ${p.evidence} (${p.why})`).join('\n')}`,
    `Why them: ${a.whyThem.fact}${a.whyThemVerified ? '' : ' (NOT found in the research or job description: use it only if you can confirm it there, otherwise pick another true detail)'}`,
    a.playsDown ? `Plays down: ${a.playsDown}` : '',
  ].filter(Boolean).join('\n')
}

function answersPrompt(choice: CoverLetterChoice): string {
  const given = choice.answers.filter((a) => a.answer.trim())
  if (given.length === 0) return "# The candidate's own words\n\n(none given: keep the letter professional and invent nothing personal)"
  return `# The candidate's own words (the only source for personal statements)\n\n${given.map((a) => `Q: ${a.question}\nA: ${a.answer.trim()}`).join('\n\n')}`
}

/** Texts every figure in the letter must come from. */
export function figureSources(g: Gathered, choice: CoverLetterChoice): string[] {
  return [g.profileText, g.job.description, ...g.companyFacts, ...g.practicalities, ...choice.answers.map((a) => a.answer)]
}

export async function runWrite(
  g: Gathered,
  angles: StoredAngles | null,
  choice: CoverLetterChoice,
  ctx: StageContext,
): Promise<{ written: CoverLetterWritten; model: string; retries: number; usage: CallUsage; notes: string[] }> {
  const [instructions, writing] = await Promise.all([loadPromptText(ctx.profileId, 'cl-gen-write'), loadWritingContext(ctx.profileId)])
  const words = LENGTH_WORDS[choice.length]
  const tone = TONE_LABELS[choice.tone]
  const prompt = [
    contextPrompt(g),
    g.practicalities.length > 0 ? `# Practicalities (from research)\n\n${g.practicalities.map((p) => `- ${p}`).join('\n')}` : '',
    chosenAnglePrompt(angles, choice),
    answersPrompt(choice),
    `# Tone\n\n${tone.label}: ${tone.description}`,
    `# Length\n\nAbout ${words.target} words in the paragraphs (between ${words.min} and ${words.max}).`,
    'Write the letter now.',
  ].filter(Boolean).join('\n\n')
  const sources = figureSources(g, choice)
  const call = await completeChecked(ctx.profileId, prompt, WriteOutputSchema, {
    role: 'default',
    system: composeSystem(writing.rules, writing.brief, writing.searchProfileSummary, instructions, outputFormat(WriteOutputSchema)),
    maxOutputTokens: MAX_OUTPUT_TOKENS.write,
    retryMaxOutputTokens: MAX_OUTPUT_TOKENS.writeRetry,
    temperature: 0.7,
    timeoutMs: TIME_BUDGET_MS.write,
    deadline: ctx.deadline,
    feature: COVER_LETTER_FEATURES.write,
    attribution: attributionOf(ctx),
    label: 'cover letter',
    check: (out) => checkLetter(g.candidateName, out, { length: choice.length, sources }),
  })
  const out = call.value
  const written: CoverLetterWritten = {
    ...out,
    markdown: letterMarkdown(g.candidateName, out),
    wordCount: wordCount(out.paragraphs),
    checkNotes: call.softIssues,
  }
  const notes = [
    `Wrote ${out.paragraphs.length} paragraphs, ${written.wordCount} words (${choice.length}: ${words.min}-${words.max}), ${tone.label.toLowerCase()} tone.`,
    ...(call.retries > 0 ? [`Retried once: ${call.retryReasons.join('; ')}.`] : []),
    ...call.softIssues.map((s) => `Accepted with a problem: ${s}.`),
  ]
  return { written, model: call.model, retries: call.retries, usage: call.usage, notes }
}

// ── Review ────────────────────────────────────────────────────────────────

/**
 * Applies review edits in code. An edit is kept only when its quoted text is
 * found exactly once in that paragraph, it doesn't empty the paragraph, and
 * the edited paragraph adds no figure missing from the sources and no new
 * generic phrase. Pure.
 */
export function applyReviewEdits(
  out: WriteOutput,
  edits: z.infer<typeof ReviewOutputSchema>['edits'],
  sources: readonly string[],
): { out: WriteOutput; applied: CoverLetterReview['applied']; discarded: CoverLetterReview['discarded'] } {
  const paragraphs = [...out.paragraphs]
  const applied: CoverLetterReview['applied'] = []
  const discarded: CoverLetterReview['discarded'] = []
  for (const e of edits) {
    const p = paragraphs[e.paragraph]
    const reject = (why: string) => discarded.push({ paragraph: e.paragraph, before: e.before, why })
    if (p === undefined) { reject('no such paragraph'); continue }
    const at = p.indexOf(e.before)
    if (at === -1 || p.indexOf(e.before, at + 1) !== -1) { reject(at === -1 ? 'the quoted text is not in the paragraph' : 'the quoted text appears more than once'); continue }
    const next = (p.slice(0, at) + e.after + p.slice(at + e.before.length)).replace(/ {2,}/g, ' ').trim()
    if (!next) { reject('it would empty the paragraph'); continue }
    const newFigures = unsupportedFigures(next, sources).filter((f) => !unsupportedFigures(p, sources).includes(f))
    if (newFigures.length > 0) { reject(`it adds figures not in the sources: ${newFigures.join(', ')}`); continue }
    const newCliches = findCliches(next).filter((c) => !findCliches(p).includes(c))
    if (newCliches.length > 0) { reject(`it adds generic phrases: ${newCliches.join(', ')}`); continue }
    paragraphs[e.paragraph] = next
    applied.push({ paragraph: e.paragraph, before: e.before, after: e.after, reason: e.reason })
  }
  return { out: { ...out, paragraphs }, applied, discarded }
}

export async function runReview(
  g: Gathered,
  angles: StoredAngles | null,
  choice: CoverLetterChoice,
  written: CoverLetterWritten,
  ctx: StageContext,
): Promise<{ written: CoverLetterWritten; review: CoverLetterReview; usage: CallUsage | null; notes: string[] }> {
  const skip = (reason: string) => ({
    written,
    review: { skipped: true, skipReason: reason, model: null, applied: [], discarded: [], concerns: [] } satisfies CoverLetterReview,
    usage: null,
    notes: [reason],
  })
  if (ctx.deadline - Date.now() < 20_000) return skip('Not enough time was left for the review, so the letter lands unreviewed.')
  try {
    const instructions = await loadPromptText(ctx.profileId, 'cl-gen-review')
    const letter = written.paragraphs.map((p, i) => `[paragraph ${i}]\n${p}`).join('\n\n')
    const prompt = [
      contextPrompt(g),
      chosenAnglePrompt(angles, choice),
      answersPrompt(choice),
      `# The letter\n\nSalutation: ${written.salutation}\n\n${letter}\n\nClosing: ${written.closing}`,
      'Review it now.',
    ].join('\n\n')
    const result = await completeValidated(ctx.profileId, prompt, ReviewOutputSchema, {
      role: 'analysis',
      system: composeSystem(instructions, outputFormat(ReviewOutputSchema)),
      maxOutputTokens: MAX_OUTPUT_TOKENS.review,
      retryMaxOutputTokens: MAX_OUTPUT_TOKENS.reviewRetry,
      temperature: 0.2,
      timeoutMs: TIME_BUDGET_MS.review,
      deadline: ctx.deadline,
      feature: COVER_LETTER_FEATURES.review,
      attribution: attributionOf(ctx),
      label: 'review',
    })
    const { out, applied, discarded } = applyReviewEdits(written, result.value.edits, figureSources(g, choice))
    const next: CoverLetterWritten = applied.length === 0 ? written : {
      ...written,
      paragraphs: out.paragraphs,
      markdown: letterMarkdown(g.candidateName, out),
      wordCount: wordCount(out.paragraphs),
    }
    return {
      written: next,
      review: { skipped: false, skipReason: null, model: result.model, applied, discarded, concerns: result.value.concerns },
      usage: result.usage,
      notes: [
        `Applied ${applied.length} edit${applied.length === 1 ? '' : 's'}, discarded ${discarded.length}; ${result.value.concerns.length} concern${result.value.concerns.length === 1 ? '' : 's'} for the coach.`,
        ...discarded.map((d) => `Discarded an edit to paragraph ${d.paragraph}: ${d.why}.`),
      ],
    }
  } catch (err) {
    console.error('[cover-letter-generation] review failed', { runId: ctx.runId, err: err instanceof Error ? err.message : err })
    return skip('The review call failed, so the letter lands unreviewed.')
  }
}
