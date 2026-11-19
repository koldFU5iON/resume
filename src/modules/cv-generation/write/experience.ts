/**
 * The experience writer: ONE call per employer that shows bullets (wave 1).
 * It writes a one-sentence summary and the bullets from only that employer's
 * selected evidence, each bullet with the labels (E1.., P1..) of the evidence
 * items it comes from (provenance.ts); code builds the `:::compact-list`
 * block and renders the heading (company, latest title, dates, progression)
 * around it, so a malformed block cannot fail the run.
 *
 * Bullet rules (bullets.ts): at most the Select allocation, +1 for each
 * lead-with project (which must have a bullet of its own); a play-down item is
 * never a bullet of its own; completed results are past tense. The cap is also
 * ENFORCED in code after the last attempt by a deterministic trim, which is
 * logged and never fails the run.
 *
 * After the answer, code checks (checks.ts), all soft: plain text only
 * (plain.ts), word and bullet limits, figures and number words the evidence
 * does not support, claimed tools, certifications and education that are not
 * in the evidence (or in progress but written as held), and titles / companies
 * the model introduced. One retry with feedback, then clean, accept and log.
 * At most TWO calls.
 */

import { negationDrift, scopeDrift } from './fidelity'
import * as z from 'zod'
import { composeSystem } from '@/modules/llm/prompt-context'
import { attributionOf, completeChecked, softIssueNotes, type CheckResult } from '../call'
import { CV_GENERATION_FEATURES, TEMPERATURE, TIME_BUDGET_MS, type BulletProvenance } from '../schema'
import { bulletAllowance, leadWithProjects, leadWithStanding, dedupeSummary, playDownBullets, shortened, trimBullets, wrongTenseLines } from './bullets'
import { BULLET_MAX_WORDS, SUMMARY_MAX_WORDS, experienceTokenCaps } from './limits'
import { claimedHits, credentialProblems, introducedNames, projectReflected, repeatedFigures, unsupportedFigures, wordCount } from './checks'
import { activityPromptText, evidenceTexts, figureIgnoredNames, projectPromptText, type EmployerEvidence } from './evidence'
import { plainFeedback, plainLine, plainReasons, shortenToWords } from './plain'
import { isThin, thinProjectNote } from './thin'
import { evidenceRefs, mixedSourceNote, resolveSources, toProvenance, type EvidenceRef } from './provenance'
import { briefText, data, requirementsBlock } from './prompt'
import { renderEmployerEntry } from './render'
import type { CheckNote, WriteContext, WriterOutcome } from './types'

export type ExperienceOutcome = WriterOutcome & {
  summary: string
  bullets: string[]
  /** Each shown bullet with the evidence it came from, in display order (same length as `bullets`). */
  provenance: BulletProvenance[]
}

export const ExperienceOutputSchema = z.object({
  summary: z.string().describe(`One plain sentence on what the candidate was responsible for, at most ${SUMMARY_MAX_WORDS} words`),
  bullets: z.array(z.object({
    text: z.string().describe(`The bullet as plain text, without "- " or any Markdown, at most ${BULLET_MAX_WORDS} words`),
    sources: z.array(z.string()).default([]).describe('The labels of the evidence items this bullet comes from, e.g. ["E1"] or ["E2", "P1"]. At least one, only labels from the evidence list'),
  })).default([]).describe('The bullets, best first'),
})
export type ExperienceOutput = z.infer<typeof ExperienceOutputSchema>

export const EXPERIENCE_OUTPUT_FORMAT = `Output: one JSON object in a \`\`\`json code block, nothing else. It must match this JSON Schema. Limits in the descriptions are hard limits.
\`\`\`json
${JSON.stringify(z.toJSONSchema(ExperienceOutputSchema, { io: 'input' }))}
\`\`\``

/** The user message of an experience call. Pure; carries no name, employer, title or contact detail. */
export function experiencePrompt(ctx: Pick<WriteContext, 'brief' | 'strategy'>, emp: EmployerEvidence): string {
  const max = bulletAllowance(emp, ctx.brief)
  const leads = new Map(leadWithProjects(emp.projects, ctx.brief.leadWith).map((l) => [l.name, l]))
  // Short stable labels (E1.., P1..), never the real ids: the writer cites them per bullet and code maps them back (provenance.ts).
  const items = emp.activities.map((a, i) => `[E${i + 1}] ${activityPromptText(a)}${a.highlighted ? ' (the candidate highlighted this)' : ''}`)
  // A current employer: the summary and ongoing duties may be present tense, but a completed result is past tense. A finished one is past throughout.
  const tense = emp.employer.end === null
    ? 'The summary line and ongoing responsibilities may be in the present tense (the candidate works here now), but every completed achievement and every measured result is in the PAST tense ("Drove 14,000+ voters", never "Drives 14,000+ voters").'
    : 'Past tense throughout (the candidate has left).'
  const projectLine = (p: EmployerEvidence['projects'][number], i: number) => {
    if (isThin(p)) return `[P${i + 1}] project "${p.name}": NO EVIDENCE. The profile gives only the title, no description. Do not write a bullet about it, do not say what it achieved, and do not describe it from the brief. Name it only inside a bullet that an evidence item above already states.`
    const lead = leads.get(p.name)
    return `[P${i + 1}] project "${p.name}": ${projectPromptText(p)}${lead ? `\n  LEAD WITH: the brief names this project and frames it as "${lead.line}". Give it an own bullet, framed that way, that starts with the project.` : ''}`
  }
  const extra = max - emp.activities.length
  return [
    '# Brief',
    briefText(ctx.brief),
    '# Job requirements\n\nFor emphasis only. They are not facts about the candidate.',
    data('job_requirements', requirementsBlock(ctx.strategy)),
    `# Hard limit\n\nThis entry may have at most ${max} bullets in total${extra > 0 ? ` (the ${emp.activities.length} evidence item${emp.activities.length === 1 ? '' : 's'} plus ${extra} own bullet${extra === 1 ? '' : 's'} for the LEAD WITH project${extra === 1 ? '' : 's'})` : ''}. Code counts them and cuts any beyond ${max}. Decide which items to merge before you write, and count your bullets before you answer.`,
    `# Evidence for this employer\n\nThese items are everything you may state. Best first.`,
    data('evidence', items.join('\n') || '(none: write from the projects below)'),
    ...(emp.projects.length > 0
      ? [
          `# Projects at this employer\n\nExtra evidence, equal to the items above. Each project must be reflected, except one marked NO EVIDENCE (it has no text: skip it). A project marked LEAD WITH gets an own bullet (it is the one thing allowed beyond the evidence items' count); any other project is merged into a bullet that states the same outcome and never gets a bullet of its own. The project below is the only source for what you say about it.`,
          data('projects', emp.projects.map((p, i) => projectLine(p, i)).join('\n')),
        ]
      : []),
    `# Limits\n\n- Summary: one sentence, at most ${SUMMARY_MAX_WORDS} words.\n- Bullets: at most ${max}${extra > 0 ? ` (the ${emp.activities.length} evidence item${emp.activities.length === 1 ? '' : 's'} plus ${extra} own bullet${extra === 1 ? '' : 's'} for the LEAD WITH project${extra === 1 ? '' : 's'})` : ''}, each at most ${BULLET_MAX_WORDS} words, outcome and business impact first. Merge items only when they state the same measured result with the same figures; related items with different figures or mechanisms stay separate bullets.\n- Sources: every bullet is an object {"text", "sources"}; "sources" lists the labels ([E1], [P1]...) of the evidence item(s) it comes from, at least one. A figure comes only from the item that states it.\n- Never repeat a figure within this entry: each number appears once, in the one place it fits best.\n- Play down: ${ctx.brief.playDown.length > 0 ? 'the "Play down" items in the brief may appear at most as a clause inside another bullet, never as a bullet of their own.' : 'nothing to play down.'}\n- Voice: no pronouns ("I", "my", "we"); an implied subject. Tense: ${tense}\n- Plain text only: no Markdown, links, HTML or ":::". Code builds the list from your strings.\n- Numbers exactly as in the evidence, whether you write them as digits or words; no title, company or date that the evidence does not contain.`,
    'Return the summary and the bullets (each with its source labels) as one JSON object matching the schema, in a ```json code block.',
  ].join('\n\n')
}

type Analysis = CheckResult & {
  /** Projects of this employer that the cleaned text does not reflect. */
  projectsMissed: string[]
  /** Lead-with projects that have no bullet of their own (not named, or only as a trailing clause). */
  leadWithNotOwn: string[]
  /** Cleaned (plainLine). */
  summary: string
  /** Cleaned (plainLine), empty ones dropped. */
  bullets: string[]
  /** The valid evidence items each of `bullets` cites (same length and order); empty when the writer cited none that exist. */
  bulletSources: EvidenceRef[][]
  /** Labels the writer cited that are not evidence items of this employer (dropped). */
  unknownSources: number
  /** Figures that no evidence item supports, after the checks. */
  unsupported: string[]
  /** Claimed names mentioned, with whether the job's requirements name them. */
  claimed: Array<{ name: string; requested: boolean }>
  /** In-progress certifications or education the text names without in-progress wording. */
  inProgressNamed: string[]
}

/** All code checks on one answer. Pure. The summary and bullets in the result are already cleaned. */
export function analyseExperience(out: ExperienceOutput, ctx: Pick<WriteContext, 'evidence' | 'requirementText' | 'brief'>, emp: EmployerEvidence): Analysis {
  const soft: string[] = []
  const why: string[] = []
  const problem = (long: string, short: string) => { soft.push(long); why.push(short) }
  const summary = plainLine(out.summary)
  const kept = out.bullets.map((b) => ({ text: plainLine(b.text), cited: b.sources })).filter((b) => b.text)
  const refs = evidenceRefs(emp)
  const resolved = kept.map((b) => resolveSources(b.cited, refs))
  const bullets = kept.map((b) => b.text)
  const bulletSources = resolved.map((r) => r.sources)
  const unknownSources = resolved.reduce((n, r) => n + r.unknown, 0)
  const texts = evidenceTexts(emp)
  const evidenceText = texts.join('\n')
  const max = bulletAllowance(emp, ctx.brief)

  // Not plain (or first person): retried once with feedback like any soft problem; the kept text is cleaned either way.
  // Verbatim names from the candidate's own text ("My Talking Tom launch") are not first person.
  const ownText = [evidenceText, ...ctx.evidence.profileCompanies, ...ctx.evidence.profileTitles].join('\n')
  const fields: Array<[string, string]> = [['the summary', out.summary], ...out.bullets.map((b, i): [string, string] => [`bullet ${i + 1}`, b.text])]
  for (const [label, text] of fields) {
    const f = plainFeedback(label, text, ownText)
    if (f) problem(f, plainReasons(text, ownText).join(', '))
  }

  if (summary === '') problem('the summary is empty; write one sentence', 'empty summary')
  // Over the word cap is NOT a retry reason (a retry doubles the call's cost): writeExperience shortens it in code.
  if (bullets.length === 0) problem('there are no bullets; write one per evidence item you use', 'no bullets')
  if (bullets.length > max) problem(`there are ${bullets.length} bullets; at most ${max} are allowed (merge items that state the same outcome; a project that is not marked LEAD WITH is merged into a bullet, never its own)`, `${bullets.length} bullets, limit ${max}`)

  // Provenance: every bullet cites at least one evidence item that exists. Unknown labels are dropped; a bullet left with none is retried once.
  const unsourced = bulletSources.flatMap((s, i) => (s.length === 0 ? [i + 1] : []))
  if (unsourced.length > 0) problem(`${unsourced.length === 1 ? `bullet ${unsourced[0]} cites` : `bullets ${unsourced.join(', ')} cite`} no evidence item that exists: cite the evidence item(s) this bullet comes from, by their labels (${refs.map((r) => r.label).join(', ') || 'none'}), in "sources"`, `no source for bullet ${unsourced.join(', ')}`)

  const all = [summary, ...bullets].join('\n')
  const names = [...figureIgnoredNames(ctx.evidence), ...emp.projects.map((p) => p.name)]
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

  // Selected projects are evidence too: each must be reflected (its name, or one of its figures, in the text).
  const projectsMissed = emp.projects.filter((p) => !isThin(p) && !projectReflected(all, p)).map((p) => p.name)
  const leads = leadWithProjects(emp.projects, ctx.brief.leadWith)
  const leadNames = new Set(leads.map((l) => l.name))
  const otherMissed = projectsMissed.filter((n) => !leadNames.has(n))
  if (otherMissed.length > 0) problem(`these selected projects are not reflected: ${otherMissed.map((n) => `"${n}"`).join(', ')}; merge each into a bullet that states the same outcome, naming it, using only the project text`, `project ${otherMissed.join(', ')} not reflected`)
  // A lead-with project needs an own bullet that is about it, framed as the Brief frames it: not a trailing clause of another bullet.
  const leadWithNotOwn: string[] = []
  for (const l of leads) {
    const standing = leadWithStanding(bullets, l)
    if (standing === 'own') continue
    leadWithNotOwn.push(l.name)
    problem(`the lead-with project "${l.name}" needs an own bullet that starts with it and is framed as the brief frames it ("${l.line}"); ${standing === 'trailing' ? 'it only appears as a trailing clause or shares a bullet with other topics' : 'no bullet names it'}`, `project ${l.name} needs its own bullet`)
  }

  // Play down: only ever a clause inside another bullet.
  for (const hit of playDownBullets(bullets, ctx.brief)) {
    problem(`bullet ${hit.index + 1} is about the play-down item "${hit.item}"; a play-down item may appear at most as a clause inside another bullet, never as a bullet of its own`, `play-down item ${hit.item} is a bullet`)
  }

  // Paraphrase fidelity: each bullet is checked against the evidence it cites (the whole entry's evidence when it cites none that exists).
  bullets.forEach((b, i) => {
    const cited = bulletSources[i].length > 0 ? bulletSources[i].map((r) => r.text) : texts
    const neg = negationDrift(b, cited.join('\n'))
    if (neg.length > 0) problem(`bullet ${i + 1} says ${neg.map((n) => `"${n}"`).join(', ')}, which its evidence does not: reword for brevity only, never changing who did what, whether it was voluntary or required, or adding or removing a negation`, `meaning drift: negation in bullet ${i + 1}`)
    for (const d of scopeDrift(b, cited)) problem(`bullet ${i + 1} keeps "${d.claim}" but drops "${d.qualifier}", which its evidence attaches to it: keep the qualifier or drop the claim`, `scope qualifier dropped in bullet ${i + 1}`)
  })

  // Tense: a completed result is past tense even in the current role; a finished role is past throughout.
  const present = wrongTenseLines({ summary, bullets }, emp.employer.end === null)
  if (present.length > 0) {
    problem(`these are in the present tense; ${emp.employer.end === null ? 'completed achievements and measured results are past tense even in the current role' : 'a finished role is past tense throughout'}: ${present.slice(0, 3).map((l) => `"${shortened(l, 50)}"`).join(', ')}`, emp.employer.end === null ? 'present tense on a result' : 'present tense in a finished role')
  }

  return { hard: [], soft, why: [...new Set(why)], summary, bullets, bulletSources, unknownSources, unsupported, claimed, inProgressNamed: creds.filter((c) => c.inProgress).map((c) => c.name), projectsMissed, leadWithNotOwn }
}

/**
 * An entry written by code from the candidate's own activity text: no model.
 * Used when the answer has no usable bullets, or the run has no time left for
 * the call. It claims nothing the evidence does not say.
 */
export function fallbackExperience(emp: EmployerEvidence): { summary: string; bullets: string[]; provenance: BulletProvenance[]; markdown: string; notes: string[] } {
  // Each bullet IS one activity's text, so its source is exact.
  const refs = evidenceRefs(emp)
  const pairs = emp.activities.map((a, i) => ({ text: plainLine(a.text), ref: refs[i] })).filter((b) => b.text)
  const bullets = pairs.map((b) => b.text)
  // A project has no activity text to reuse as a bullet, so it is named in the log instead of vanishing.
  const notes = emp.projects.map((p) => `Project "${p.name}" is not on the CV: this entry was made without a model call, from your activity text only.`)
  return { summary: '', bullets, provenance: pairs.map((b) => toProvenance(b.text, [b.ref])), markdown: renderEmployerEntry(emp.employer, '', bullets), notes }
}

/** Writes one employer's entry. Throws LLMError (invalid_output, timeout, ...). */
export async function writeExperience(ctx: WriteContext, emp: EmployerEvidence, instructions: { rules: string; brief: string | null; prompt: string }): Promise<ExperienceOutcome> {
  const allowance = bulletAllowance(emp, ctx.brief)
  const caps = experienceTokenCaps(allowance, emp.projects.length > 0)
  const call = await completeChecked(ctx.profileId, experiencePrompt(ctx, emp), ExperienceOutputSchema, {
    role: 'default',
    system: composeSystem(instructions.rules, instructions.brief, instructions.prompt, EXPERIENCE_OUTPUT_FORMAT),
    maxOutputTokens: caps.first,
    retryMaxOutputTokens: caps.retry,
    temperature: TEMPERATURE.writeExperience,
    timeoutMs: TIME_BUDGET_MS.write,
    deadline: ctx.deadline,
    feature: CV_GENERATION_FEATURES.writeExperience,
    attribution: attributionOf(ctx),
    label: 'experience section',
    check: (v) => analyseExperience(v, ctx, emp),
  })
  const analysed = analyseExperience(call.value, ctx, emp)
  const notes = softIssueNotes(call)
  // Over the word cap: shortened here, in code, at a clause boundary (a retry would double the cost); else kept and noted.
  const fit = (text: string, max: number, what: string): string => {
    const n = wordCount(text)
    if (n <= max) return text
    const cut = shortenToWords(text, max)
    if (cut) { notes.push(`Shortened ${what} from ${n} to ${wordCount(cut)} words at a clause boundary (limit ${max}); no retry was made.`); return cut }
    notes.push(`${what[0].toUpperCase()}${what.slice(1)} is ${n} words, over the limit of ${max}; kept as written because shortening it would cut its meaning (no retry was made).`)
    return text
  }
  // A bullet whose only sources are thin projects (title only) is invented from the brief's framing: dropped, unless nothing else is left.
  const thinIds = new Set(emp.projects.filter(isThin).map((p) => p.id))
  const keepAt = analysed.bullets.map((_, i) => !(thinIds.size > 0 && analysed.bulletSources[i].length > 0 && analysed.bulletSources[i].every((r) => thinIds.has(r.id))))
  const dropThin = keepAt.some((k) => !k) && keepAt.some(Boolean)
  // A bullet that repeats the summary is KEPT (Select allotted it): the summary loses the repeated sentence or clause instead, when something else of it is left.
  const dedup = dedupeSummary(analysed.summary, analysed.bullets.filter((_, i) => !dropThin || keepAt[i]))
  const bulletIdx = analysed.bullets.map((_, i) => i).filter((i) => !dropThin || keepAt[i])
  if (dropThin) analysed.bullets.forEach((b, i) => { if (!keepAt[i]) notes.push(`Dropped a bullet that was written from a project with no text, not from evidence: “${shortened(b)}”.`) })
  for (const r of dedup.removed) notes.push(`Removed “${shortened(r)}” from the summary: a bullet already says it (the summary states scope and context only).`)
  for (const u of dedup.unresolved) notes.push(`The summary and a bullet say nearly the same thing: “${shortened(u)}”. Kept both, because the summary has nothing else it could lose safely.`)
  for (const u of dedup.partial) notes.push(`The summary still overlaps a bullet after a clause was removed: “${shortened(u)}”. Kept what is left of both.`)
  const a = {
    ...analysed,
    summary: fit(dedup.summary, SUMMARY_MAX_WORDS, 'the summary'),
    bullets: bulletIdx.map((i) => fit(analysed.bullets[i], BULLET_MAX_WORDS, `bullet ${i + 1}`)),
    bulletSources: bulletIdx.map((i) => analysed.bulletSources[i]),
  }
  for (const p of emp.projects.filter(isThin)) notes.push(thinProjectNote(p.name))
  const checks: CheckNote[] = []
  const who = emp.employer.company
  // The allowance is a hard cap: whatever the last answer held, trim to it (lead-with project and brief-matching bullets first, then the writer's order).
  const trimmed = trimBullets(a.bullets, ctx.brief, emp.projects, allowance)
  let bullets = trimmed.bullets
  // trimBullets keeps the writer's order, so the kept texts line up with their sources.
  let provenance: BulletProvenance[] = []
  {
    let k = 0
    a.bullets.forEach((b, i) => {
      if (k < bullets.length && bullets[k] === b) { provenance.push(toProvenance(b, a.bulletSources[i])); k++ }
    })
  }
  for (const t of trimmed.trimmed) notes.push(`Cut a bullet over this employer's limit of ${allowance}: “${shortened(t)}”.`)
  // A bullet that carried a selected project may be the one that was cut: say so, so the project is never lost silently.
  for (const p of emp.projects) {
    if (trimmed.trimmed.length > 0 && projectReflected([a.summary, ...a.bullets].join('\n'), p) && !projectReflected([a.summary, ...bullets].join('\n'), p)) {
      notes.push(`Selected project "${p.name}" is no longer on the CV: the bullet that carried it was cut over this employer's limit.`)
    }
  }
  if (bullets.length === 0) {
    const fb = fallbackExperience(emp)
    bullets = fb.bullets
    provenance = fb.provenance
    notes.push('The answer had no usable bullets, so the bullets are your own activity text from the profile.', ...fb.notes)
  }
  if (a.unknownSources > 0) notes.push(`${a.unknownSources === 1 ? '1 source label' : `${a.unknownSources} source labels`} the writer cited ${a.unknownSources === 1 ? 'is' : 'are'} not evidence items of this employer and ${a.unknownSources === 1 ? 'was' : 'were'} dropped.`)
  // Conflation made visible: a bullet whose figures come from two different activities. Informational only (no retry, not a check note).
  const figureNames = [...figureIgnoredNames(ctx.evidence), ...emp.projects.map((p) => p.name)]
  a.bullets.forEach((b, i) => {
    if (!provenance.some((p) => p.text === b)) return // cut by the limit
    const mixed = mixedSourceNote(b, a.bulletSources[i], figureNames)
    if (mixed) notes.push(mixed)
  })
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
    provenance,
    model: call.model,
    usage: call.usage,
    retries: call.retries,
    retryReasons: call.retryReasons,
    notes,
    checks,
    checkNotes: checks.map((c) => c.text),
  }
}
