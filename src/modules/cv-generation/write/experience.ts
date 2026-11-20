/**
 * The experience writer: ONE call per employer that shows bullets (wave 1).
 * It writes a one-sentence summary and the bullets from only that employer's
 * selected evidence, each bullet with the labels (E1.., P1..) of the evidence
 * items it comes from (provenance.ts); code builds the `:::compact-list`
 * block and renders the heading (company, latest title, dates, progression)
 * around it, so a malformed block cannot fail the run.
 *
 * Bullet rules (bullets.ts): at most the Select allocation, +1 for each
 * substantive selected project (which gets a bullet of its own, never merged into an unrelated activity); a play-down item is
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
import { claimedHits, contentStems, credentialProblems, introducedNames, normalised, projectReflected, repeatedFigures, unsupportedFigures, wordCount } from './checks'
import { activityPromptText, employerProjectNames, evidenceTexts, figureIgnoredNames, summaryEvidenceTexts, projectPromptText, type EmployerEvidence } from './evidence'
import { plainFeedback, plainLine, plainReasons, shortenToWords } from './plain'
import { isThin, thinProjectNote } from './thin'
import { evidenceRefs, mixedSourceNote, namesProject, resolveSources, toProvenance, type EvidenceRef } from './provenance'
import { briefText, data, requirementsBlock } from './prompt'
import { renderEmployerEntry } from './render'
import type { CheckNote, WriteContext, WriterOutcome } from './types'

export type ExperienceOutcome = WriterOutcome & {
  summary: string
  bullets: string[]
  /** Each shown bullet with the evidence it came from, in display order (same length as `bullets`). */
  provenance: BulletProvenance[]
}

/** A bullet may cite a project and an activity together only when the activity text shares this many content words with the project text. */
export const PROJECT_ACTIVITY_MIN_SHARED_WORDS = 2

export const ExperienceOutputSchema = z.object({
  summary: z.string().describe(`One plain sentence of concrete scope (what the employer is, team or region or portfolio size, remit) taken from the role overview, at most ${SUMMARY_MAX_WORDS} words; an EMPTY string when the overview states no concrete scope fact`),
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
  const max = bulletAllowance(emp)
  const leads = new Map(leadWithProjects(emp.projects, ctx.brief.leadWith).map((l) => [l.name, l]))
  // Short stable labels (E1.., P1..), never the real ids: the writer cites them per bullet and code maps them back (provenance.ts).
  const items = emp.activities.map((a, i) => `[E${i + 1}] ${activityPromptText(a)}${a.highlighted ? ' (the candidate highlighted this)' : ''}`)
  const projectLabels = new Map<string, { name: string; labels: string[] }>()
  for (const ref of evidenceRefs(emp)) {
    if (ref.kind !== 'activity' || !ref.project) continue
    const group = projectLabels.get(ref.project.id) ?? { name: ref.project.name, labels: [] }
    group.labels.push(ref.label)
    projectLabels.set(ref.project.id, group)
  }
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
  const ownBullets = `${extra} own bullet${extra === 1 ? '' : 's'} for the project${extra === 1 ? '' : 's'}`
  return [
    '# Brief',
    briefText(ctx.brief),
    '# Job requirements\n\nFor emphasis only. They are not facts about the candidate.',
    data('job_requirements', requirementsBlock(ctx.strategy)),
    `# Hard limit\n\nThis entry may have at most ${max} bullets in total${extra > 0 ? ` (the ${emp.activities.length} evidence item${emp.activities.length === 1 ? '' : 's'} plus ${ownBullets})` : ''}. Code counts them and cuts any beyond ${max}. Decide which items to merge before you write, and count your bullets before you answer.`,
    ...(emp.overview?.trim() ? ['# Role overview\n\nThe only source for the summary (scope facts: what the employer is, team, region, portfolio, remit). Not for bullets.', data('overview', emp.overview.trim())] : ['# Role overview\n\n(none: the profile gives no overview for this employer, so the summary is an empty string)']),
    `# Evidence for this employer\n\nThese items are everything you may state. Best first.`,
    data('evidence', items.join('\n') || '(none: write from the projects below)'),
    ...(projectLabels.size > 0 ? [
      '# Recorded project labels for activities',
      data('activity_projects', [...projectLabels.values()].map(({ name, labels }) => `${labels.join(', ')}: ${name}`).join('\n')),
    ] : []),
    ...(emp.projects.length > 0
      ? [
          `# Projects at this employer\n\nExtra evidence, equal to the items above. Every project must be reflected, except one marked NO EVIDENCE (it has no text: skip it). Each project with text gets a bullet of its own (the one thing allowed beyond the evidence items' count); one marked LEAD WITH is framed as the brief frames it. Never merge a project into a bullet about an unrelated activity: a bullet cites a project together with an activity only when both are about the same subject. The project below is the only source for what you say about it.`,
          data('projects', emp.projects.map((p, i) => projectLine(p, i)).join('\n')),
        ]
      : []),
    `# Limits\n\n- Summary: one sentence, at most ${SUMMARY_MAX_WORDS} words, stating CONCRETE scope facts from the role overview (what the employer is, team, region or portfolio size, remit). Never filler such as \"role covering how launches reached their audiences\". When the overview carries no concrete scope fact, return an EMPTY summary (\"\"). It is scope and context only, never drawn from the activities listed above (every listed activity is for a bullet; two may share a bullet only when they describe the same achievement, and then the bullet cites both).\n- Bullets: at most ${max}${extra > 0 ? ` (the ${emp.activities.length} evidence item${emp.activities.length === 1 ? '' : 's'} plus ${ownBullets})` : ''}, each at most ${BULLET_MAX_WORDS} words, outcome and business impact first. Merge items only when they state the same measured result with the same figures; related items with different figures or mechanisms stay separate bullets.\n- Sources: every bullet is an object {"text", "sources"}; "sources" lists the labels ([E1], [P1]...) of the evidence item(s) it comes from, at least one. A figure comes only from the item that states it.\n- Never repeat a figure within this entry: each number appears once, in the one place it fits best.\n- Play down: ${ctx.brief.playDown.length > 0 ? 'the "Play down" items in the brief may appear at most as a clause inside another bullet, never as a bullet of their own.' : 'nothing to play down.'}\n- Project context: name the recorded project or campaign within a bullet when the work would otherwise read as detached or ambiguous. Use the saved name, naturally in the sentence. Keep distinct projects in separate bullets and keep figures and scope with the source that states them. Do not invent a product, programme or campaign name.\n- Role verbs: when the evidence is a project or a project-labelled activity, the candidate's ROLE verbs come from the evidence (\"led communications\", \"planned\", \"ran\"). Never promote the candidate to the product's creator or launcher (\"launched the demo\", \"built the game\") unless the evidence says they did.\n- Voice: no pronouns ("I", "my", "we"); an implied subject. Tense: ${tense}\n- Plain text only: no Markdown, links, HTML or ":::". Code builds the list from your strings.\n- Numbers exactly as in the evidence, whether you write them as digits or words; no title, company or date that the evidence does not contain.`,
    'Return the summary and the bullets (each with its source labels) as one JSON object matching the schema, in a ```json code block.',
  ].join('\n\n')
}

/** Selected activities (label and text) that none of `bulletSources` cites. */
export function uncitedActivities(emp: Pick<EmployerEvidence, 'activities' | 'projects'>, bulletSources: ReadonlyArray<ReadonlyArray<{ id: string }>>): Array<{ label: string; text: string }> {
  const cited = new Set(bulletSources.flatMap((s) => s.map((r) => r.id)))
  return evidenceRefs(emp).filter((r) => r.kind === 'activity' && !cited.has(r.id)).map((r) => ({ label: r.label, text: r.text }))
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
  unknownPerBullet: number[]
  /** Figures that no evidence item supports, after the checks. */
  unsupported: string[]
  /** Claimed names mentioned, with whether the job's requirements name them. */
  claimed: Array<{ name: string; requested: boolean }>
  /** In-progress certifications or education the text names without in-progress wording. */
  inProgressNamed: string[]
}

/**
 * Whether a summary is only generic words: no number, no proper noun (a capitalised
 * word inside the sentence, other than the employer's own name) and no word of the
 * role overview. Such a line is filler written because the overview was thin. Pure.
 */
export function isGenericSummary(summary: string, emp: Pick<EmployerEvidence, 'employer' | 'overview'>): boolean {
  const text = summary.trim()
  if (!text) return false
  if (/\d/.test(text)) return false
  const company = new Set(normalised(emp.employer.company))
  const inner = text.split(/\s+/).slice(1).map((w) => w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')).filter((w) => /^\p{Lu}/u.test(w) && !company.has(w.toLowerCase()))
  if (inner.length > 0) return false
  const own = contentStems(emp.overview ?? '')
  return ![...contentStems(text)].some((w) => own.has(w))
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
  const max = bulletAllowance(emp)

  // Not plain (or first person): retried once with feedback like any soft problem; the kept text is cleaned either way.
  // Verbatim names from the candidate's own text ("My Talking Tom launch") are not first person.
  const ownText = [evidenceText, ...ctx.evidence.profileCompanies, ...ctx.evidence.profileTitles].join('\n')
  const fields: Array<[string, string]> = [['the summary', out.summary], ...out.bullets.map((b, i): [string, string] => [`bullet ${i + 1}`, b.text])]
  for (const [label, text] of fields) {
    const f = plainFeedback(label, text, ownText)
    if (f) problem(f, plainReasons(text, ownText).join(', '))
  }

  // An empty summary is allowed: the overview may carry no concrete scope fact, and then the entry has no summary line.
  // Over the word cap is NOT a retry reason (a retry doubles the call's cost): writeExperience shortens it in code.
  if (bullets.length === 0) problem('there are no bullets; write one per evidence item you use', 'no bullets')
  if (bullets.length > max) problem(`there are ${bullets.length} bullets; at most ${max} are allowed (merge items that state the same outcome; each project with text keeps its own bullet)`, `${bullets.length} bullets, limit ${max}`)

  // Selected activities no bullet cites, while the entry has fewer bullets than allowed: usually one the writer spent on the summary. Merged ones are cited elsewhere, so they never count.
  const uncited = uncitedActivities(emp, bulletSources)
  if (uncited.length > 0 && bullets.length > 0 && bullets.length < max) {
    problem(`these selected activities have no bullet and are not cited by any: ${uncited.map((u) => `${u.label} "${shortened(u.text, 80)}"`).join('; ')}. The summary is scope and context only, never drawn from the activities; write a bullet for each (merge two only when they describe the same achievement, citing both labels), up to the limit of ${max}`, `${uncited.length === 1 ? 'activity' : 'activities'} ${uncited.map((u) => u.label).join(', ')} without a bullet`)
  }

  // Provenance: every bullet cites at least one evidence item that exists. Unknown labels are dropped; a bullet left with none is retried once.
  const unsourced = bulletSources.flatMap((s, i) => (s.length === 0 ? [i + 1] : []))
  if (unsourced.length > 0) problem(`${unsourced.length === 1 ? `bullet ${unsourced[0]} cites` : `bullets ${unsourced.join(', ')} cite`} no evidence item that exists: cite the evidence item(s) this bullet comes from, by their labels (${refs.map((r) => r.label).join(', ') || 'none'}), in "sources"`, `no source for bullet ${unsourced.join(', ')}`)

  const all = [summary, ...bullets].join('\n')
  const names = [...figureIgnoredNames(ctx.evidence), ...employerProjectNames(emp)]
  // The role overview (what the writer was shown, capped) backs a SUMMARY's figures only, never a bullet's.
  const unsupported = [...new Set([...unsupportedFigures(summary, summaryEvidenceTexts(emp), names), ...unsupportedFigures(bullets.join('\n'), texts, names)])]
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
  if (otherMissed.length > 0) problem(`these selected projects are not reflected: ${otherMissed.map((n) => `"${n}"`).join(', ')}; give each its own bullet, naming it, using only the project text (do not merge it into a bullet about another activity)`, `project ${otherMissed.join(', ')} not reflected`)
  // A bullet that cites a project AND an activity must be about one subject: the activity shares at least 2 content words with the project.
  const projectTexts = new Map(refs.filter((r) => r.kind === 'project').map((r) => [r.id, contentStems(r.text)]))
  const unrelated: number[] = []
  bulletSources.forEach((srcs, i) => {
    const proj = srcs.filter((r) => r.kind === 'project')
    const acts = srcs.filter((r) => r.kind === 'activity')
    if (proj.length === 0 || acts.length === 0) return
    const related = acts.every((a) => proj.some((p) => { const mine = projectTexts.get(p.id)!; let n = 0; for (const w of contentStems(a.text)) if (mine.has(w)) n++; return n >= PROJECT_ACTIVITY_MIN_SHARED_WORDS }))
    if (!related) unrelated.push(i + 1)
  })
  if (unrelated.length > 0) problem(`${unrelated.length === 1 ? `bullet ${unrelated[0]} cites` : `bullets ${unrelated.join(', ')} cite`} a project together with an unrelated activity; a project gets its own bullet and is never merged into a bullet about something else: write it as a separate bullet and cite only its own label`, `project merged into an unrelated bullet ${unrelated.join(', ')}`)
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

  return { hard: [], soft, why: [...new Set(why)], summary, bullets, bulletSources, unknownSources, unknownPerBullet: resolved.map((r) => r.unknown), unsupported, claimed, inProgressNamed: creds.filter((c) => c.inProgress).map((c) => c.name), projectsMissed, leadWithNotOwn }
}

/** Restore only a name supported by every source, without cutting or rewriting the claim. */
function withProjectContext(text: string, sources: readonly EvidenceRef[], projectNames: readonly string[], notes: string[], unknown = 0): string {
  const project = sources.find((s) => s.project)?.project
  if (!project) return text
  if (unknown > 0 || sources.some((s) => s.project?.id !== project.id)) {
    notes.push(`Project attribution needs a look: the bullet cites mixed or unknown sources. “${shortened(text)}”.`)
    return text
  }
  const name = plainLine(project.name)
  if (!name || namesProject(text, name)) return text
  const other = projectNames.find((n) => n !== project.name && namesProject(text, n))
  if (other) {
    notes.push(`Project attribution needs a look: the bullet names “${other}” but cites “${project.name}”.`)
    return text
  }
  const end = text.match(/[.!?]$/)?.[0] ?? ''
  const body = end ? text.slice(0, -1) : text
  const named = `${body} (${name})${end}`
  if (wordCount(named) <= BULLET_MAX_WORDS) return named
  notes.push(`Could not add the recorded project name “${name}” within the bullet limit without rewriting the claim: “${shortened(text)}”.`)
  return text
}

/**
 * An entry written by code from the candidate's own activity text: no model.
 * Used when the answer has no usable bullets, or the run has no time left for
 * the call. It claims nothing the evidence does not say.
 */
export function fallbackExperience(emp: EmployerEvidence): { summary: string; bullets: string[]; provenance: BulletProvenance[]; markdown: string; notes: string[] } {
  // Each bullet IS one activity's text, so its source is exact.
  const refs = evidenceRefs(emp)
  const notes: string[] = []
  const projectNames = employerProjectNames(emp)
  const pairs = emp.activities.flatMap((a, i) => {
    const text = plainLine(a.text)
    if (!text) return []
    const ref = refs[i]
    const impact = a.fromProject && a.impact ? plainLine(a.impact) : ''
    const full = impact && !text.includes(impact) ? `${text} — ${impact}` : text
    const scoped = wordCount(full) <= BULLET_MAX_WORDS ? full : text
    if (scoped !== full) notes.push(`The recorded impact did not fit the fallback bullet for “${a.fromProject?.name}”: “${shortened(impact)}”.`)
    return [{ ref, text: withProjectContext(scoped, [ref], projectNames, notes) }]
  })
  const bullets = pairs.map((b) => b.text)
  for (const p of emp.projects) {
    notes.push(bullets.some((b) => namesProject(b, p.name))
      ? `Project "${p.name}" is named in an activity bullet; the separate project context was left out of the fallback.`
      : `Project "${p.name}" is not on the CV: this entry was made without a model call, from your activity text only.`)
  }
  return { summary: '', bullets, provenance: pairs.map((b) => toProvenance(b.text, [b.ref])), markdown: renderEmployerEntry(emp.employer, '', bullets), notes }
}

/** Writes one employer's entry. Throws LLMError (invalid_output, timeout, ...). */
export async function writeExperience(ctx: WriteContext, emp: EmployerEvidence, instructions: { rules: string; brief: string | null; prompt: string }): Promise<ExperienceOutcome> {
  const allowance = bulletAllowance(emp)
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
  // Filler: a summary of generic words only is dropped, with a pointer to what the profile is missing.
  const filler = isGenericSummary(dedup.summary, emp)
  if (filler) notes.push(`${emp.employer.company} has too little overview text for a summary: add a role overview in your profile (what the employer is and your remit). Dropped “${shortened(dedup.summary)}”.`)
  const a = {
    ...analysed,
    summary: filler ? '' : fit(dedup.summary, SUMMARY_MAX_WORDS, 'the summary'),
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
  const projectNames = employerProjectNames(emp)
  const figureNames = [...figureIgnoredNames(ctx.evidence), ...projectNames]
  let provenance: BulletProvenance[] = []
  {
    let k = 0
    a.bullets.forEach((b, i) => {
      if (k < bullets.length && bullets[k] === b) {
        const text = withProjectContext(b, a.bulletSources[i], projectNames, notes, a.unknownPerBullet[bulletIdx[i]])
        provenance.push(toProvenance(text, a.bulletSources[i]))
        const mixed = mixedSourceNote(text, a.bulletSources[i], figureNames)
        if (mixed) notes.push(mixed)
        k++
      }
    })
  }
  const left = bullets.length < allowance ? uncitedActivities(emp, provenance.map((p) => p.sources)) : []
  if (left.length > 0) notes.push(`${left.length === 1 ? '1 selected activity was' : `${left.length} selected activities were`} left without a bullet (${bullets.length} of ${allowance} allowed): ${left.map((u) => `${u.label} “${shortened(u.text, 70)}”`).join('; ')}.`)
  for (const t of trimmed.trimmed) notes.push(`Cut a bullet over this employer's limit of ${allowance}: “${shortened(t)}”.`)
  // A bullet that carried a selected project may be the one that was cut: say so, so the project is never lost silently.
  for (const p of emp.projects) {
    if (trimmed.trimmed.length > 0 && projectReflected([a.summary, ...a.bullets].join('\n'), p) && !projectReflected([a.summary, ...bullets].join('\n'), p)) {
      notes.push(`Selected project "${p.name}" is no longer on the CV: the bullet that carried it was cut over this employer's limit.`)
    }
  }
  bullets = provenance.map((p) => p.text)
  if (bullets.length === 0) {
    const fb = fallbackExperience(emp)
    bullets = fb.bullets
    provenance = fb.provenance
    notes.push('The answer had no usable bullets, so the bullets are your own activity text from the profile.', ...fb.notes)
  }
  if (a.unknownSources > 0) notes.push(`${a.unknownSources === 1 ? '1 source label' : `${a.unknownSources} source labels`} the writer cited ${a.unknownSources === 1 ? 'is' : 'are'} not evidence items of this employer and ${a.unknownSources === 1 ? 'was' : 'were'} dropped.`)
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
