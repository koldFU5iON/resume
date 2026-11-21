/**
 * Stage 5, Review (docs/cv-generation.md, Phase 4a): ONE call, role 'analysis',
 * after Assemble. The reviewer reads the assembled text with section and
 * bullet ids, the evidence each bullet came from (snippets), the brief, the
 * job's requirements and a few lists, and returns edits plus concerns for the
 * coach.
 *
 * Nothing the model says is trusted:
 * - it may only target an experience bullet, an experience summary or the
 *   profile paragraph; every other section (header, titles, companies, dates,
 *   projects, certifications, education, languages, the {{contact}} placeholder and the
 *   skills, tools and competencies lists) is rendered by code and read-only;
 * - CODE applies an edit only after re-running the writers' own checks on the
 *   new text (plain text and first person, figures verbatim against the
 *   employer's evidence, the claimed-tool rule, introduced titles and
 *   companies, in-progress credentials, play-down, tense, length, a figure
 *   repeated within the entry); a failing edit is discarded and logged with
 *   the reason;
 * - a `remove` may not leave an employer with no bullets;
 * - the stage never fails the run: a failed or out-of-time review is skipped
 *   with its reason and the unreviewed CV lands. Concerns are kept even when
 *   edits were discarded.
 *
 * The input is lean: no contact details, no name, no whole profile.
 * Pure parts are exported for tests; `runReview` is the only part that calls
 * the model.
 */

import * as z from 'zod'
import { composeSystem, loadCVReviewPrompt, loadWritingContext } from '@/modules/llm/prompt-context'
import { LLMError } from '@/modules/llm/errors'
import { yearsPhrase } from './years'
import { completeValidated, shortReason, usageOfError, NO_USAGE, type CallUsage } from '../call'
import {
  CV_GENERATION_FEATURES, MAX_OUTPUT_TOKENS, REVIEW_LIMITS, REVIEW_MIN_START_MS, ReviewOutputContract, ReviewOutputSchema, TEMPERATURE, TIME_BUDGET_MS,
  type AppliedEdit, type BulletProvenance, type BulletSource, type ConcernRecord, type CvAssembled, type CvBrief, type CvReview, type CvSelection,
  type DiscardedEdit, type ReviewOutput,
} from '../schema'
import { nearDuplicate, projectAtomText } from '../project-evidence'
import type { Strategy } from '../strategy'
import { isThin } from './thin'
import { leadWithProjects, leadWithStanding, playDownBullets, shortened, wrongTenseLines } from './bullets'
import {
  claimedHits, credentialProblems, distinctNotableFigures, figuresIn, introducedNames, normalised, repeatedFigures, selfDescriptions,
  unsupportedFigures, unsupportedProperNouns, unsupportedQualitative, wordCount,
} from './checks'
import { activityPromptText, employerProjectNames, employerProjectPeers, evidenceTexts, figureIgnoredNames, summaryEvidenceTexts, projectPromptText, type EmployerEvidence, type Evidence } from './evidence'
import { negationDrift, scopeDrift } from './fidelity'
import { BULLET_MAX_WORDS, PROFILE_MAX_FIGURES, PROFILE_MAX_WORDS, SUMMARY_MAX_WORDS } from './limits'
import { plainLine, plainProblems, plainReasons } from './plain'
import { evidenceRefs, snippetOf } from './provenance'
import { conflictingProjectEdition, namesProject, projectDisplayName, projectFigureNames, selectedProjectReflected } from './project-names'
import { claimText, possibleRepeat, sameCitedClaim } from './repetition'
import { briefText, data, requirementsBlock, requirementText } from './prompt'

// ── The reviewable document ────────────────────────────────────────────────

type BulletState = { id: string; text: string; sources: BulletSource[]; removed: boolean; /** Reworded by the Review stage. */ edited?: boolean }

/** An experience entry broken into the parts the reviewer may touch. */
export type ExperienceState = {
  kind: 'experience'
  sectionId: string
  employerKey: string
  /** Everything before the summary: the "## Professional Experience" heading (first entry only), company, title, dates, progression. Code-rendered, never edited. */
  head: string
  summary: string
  bullets: BulletState[]
  /** The same employer in the evidence (the authority for the checks); the entry is read-only without it. */
  emp: EmployerEvidence | undefined
  current: boolean
  /** The "Title at Company" line shown to the reviewer as context. */
  label: string
}

export type ProfileState = { kind: 'profile'; sectionId: 'profile'; head: string; paragraph: string }

export type ReviewDoc = { experience: Map<string, ExperienceState>; profile: ProfileState | null }

const HEADER_LINE = /^(?:#{2,3}\s|\*\*|_.+_$)/

/** Splits an experience entry's Markdown (renderEmployerEntry, with the section heading on the first). Null when it has no bullet block. */
export function splitExperience(markdown: string): { head: string; summary: string; bullets: string[] } | null {
  const lines = markdown.split('\n')
  const open = lines.findIndex((l) => l.trim() === ':::compact-list')
  if (open < 0) return null
  const close = lines.findIndex((l, i) => i > open && l.trim() === ':::')
  if (close < 0) return null
  let i = 0
  while (i < open && (lines[i].trim() === '' || HEADER_LINE.test(lines[i].trim()))) i++
  const head = lines.slice(0, i).join('\n').trimEnd()
  const summary = lines.slice(i, open).join(' ').replace(/\s+/g, ' ').trim()
  const bullets = lines.slice(open + 1, close).map((l) => l.replace(/^\s*-\s+/, '').trim()).filter(Boolean)
  return { head, summary, bullets }
}

/** The inverse of splitExperience for an unchanged or edited entry. */
export function renderExperience(s: Pick<ExperienceState, 'head' | 'summary' | 'bullets'>): string {
  const list = s.bullets.filter((b) => !b.removed).map((b) => `- ${b.text}`).join('\n')
  return [s.head, s.summary, `:::compact-list\n${list}\n:::`].filter((p) => p !== '').join('\n\n')
}

function splitProfile(markdown: string): { head: string; paragraph: string } | null {
  const lines = markdown.split('\n')
  const i = lines.findIndex((l) => /^##\s/.test(l))
  if (i < 0) return null
  return { head: lines.slice(0, i + 1).join('\n'), paragraph: lines.slice(i + 1).join(' ').replace(/\s+/g, ' ').trim() }
}

const renderProfile = (p: ProfileState) => (p.paragraph ? `${p.head}\n\n${p.paragraph}` : p.head)

/** Reads the assembled CV into the parts a reviewer may edit. Pure. */
export function reviewDoc(assembled: CvAssembled, selection: Pick<CvSelection, 'employers'>, evidence: Pick<Evidence, 'employers'>): ReviewDoc {
  const doc: ReviewDoc = { experience: new Map(), profile: null }
  for (const s of assembled.sections) {
    if (s.kind === 'experience' && s.employerKey) {
      const split = splitExperience(s.markdown)
      if (!split) continue
      const emp = evidence.employers.find((e) => e.employer.key === s.employerKey)
      const sel = selection.employers.find((e) => e.key === s.employerKey)
      const prov = s.bullets && s.bullets.length === split.bullets.length ? s.bullets : []
      doc.experience.set(s.id, {
        kind: 'experience', sectionId: s.id, employerKey: s.employerKey, head: split.head, summary: split.summary,
        bullets: split.bullets.map((text, i) => ({ id: `b${i + 1}`, text, sources: prov[i]?.sources ?? [], removed: false })),
        emp, current: (emp ? emp.employer.end : sel?.end) === null,
        label: sel ? `${sel.latestTitle} at ${sel.company}` : s.employerKey,
      })
    } else if (s.kind === 'profile') {
      const p = splitProfile(s.markdown)
      if (p) doc.profile = { kind: 'profile', sectionId: 'profile', ...p }
    }
  }
  return doc
}

// ── The prompt ──────────────────────────────────────────────────────────────

export type ReviewPromptInput = {
  assembled: CvAssembled
  selection: Pick<CvSelection, 'employers' | 'uncovered'>
  brief: CvBrief
  strategy: Pick<Strategy, 'mustHave' | 'niceToHave'>
  evidence: Evidence
  /** The years the profile opener states (years.ts: computed in code, already floored); null/unset when the career is too short to state one. */
  yearsOfExperience?: number | null
}

/** One distinct piece of evidence shown to the reviewer, by label (S1, S2...). `snippet` is the full text the writer saw (activities whole, projects capped like the writer's), not a short display snippet. */
export type ReviewLabel = { label: string; id: string; kind: BulletSource['kind']; snippet: string }

function sourceText(evidence: Pick<Evidence, 'employers'> & Partial<Pick<Evidence, 'independentProjects'>>, id: string): string | null {
  for (const e of evidence.employers) {
    const a = e.activities.find((x) => x.id === id)
    if (a) return `${a.fromProject ? `Recorded project “${projectDisplayName(a.fromProject.name)}”: ` : ''}${activityPromptText(a)}`
    const p = e.projects.find((x) => x.id === id)
    if (p) return `${projectDisplayName(p.name)}: ${projectPromptText(p)}`
  }
  for (const p of evidence.independentProjects ?? []) {
    if (p.id === id) return `${p.name}: ${p.text}`
    const atom = p.atoms.find((a) => a.id === id)
    if (atom) return projectAtomText(atom)
  }
  return null
}

/** Most selected activities (not cited by a bullet) listed per employer as evidence for its summary. */
export const REVIEW_SUMMARY_EVIDENCE_MAX = 8

/** Read-only sections whose text helps judge repetition; the rest (header, certifications, education, languages, earlier experience) are not sent. */
const CONTEXT_KINDS = new Set(['competencies', 'tools', 'skills'])

/** The user message of a review call and the labels it uses. Pure; carries no name, no contact detail and no whole profile. */
export function reviewPrompt(input: ReviewPromptInput, doc: ReviewDoc): { prompt: string; labels: ReviewLabel[] } {
  const labels = new Map<string, ReviewLabel>()
  const labelFor = (src: BulletSource): ReviewLabel => {
    const key = `${src.kind}:${src.id}`
    let l = labels.get(key)
    if (!l) {
      const full = sourceText(input.evidence, src.id) ?? src.snippet
      l = { label: `S${labels.size + 1}`, id: src.id, kind: src.kind, snippet: full }
      labels.set(key, l)
    }
    return l
  }

  const cv: string[] = []
  for (const s of input.assembled.sections) {
    const ex = doc.experience.get(s.id)
    if (ex) {
      const lines = [`## ${ex.sectionId} — ${ex.label} (${ex.current ? 'current role' : 'finished role'})${ex.emp ? '' : ' [read-only]'}`]
      lines.push(`summary: ${ex.summary || '(none)'}`)
      for (const b of ex.bullets) {
        lines.push(`${b.id}: ${b.text}`)
        const refs = b.sources.map((src) => labelFor(src))
        if (refs.length === 0) lines.push('  evidence: (none cited)')
        for (const r of refs) lines.push(`  ${r.label} (${r.kind}): ${r.snippet}`)
      }
      if (ex.emp) {
        const refs = evidenceRefs(ex.emp)
        const bullets = ex.bullets.map((b) => ({ ...b, sources: refs.filter((r) => b.sources.some((s) => s.id === r.id && s.kind === r.kind)) }))
        const pairs = bullets.flatMap((b, i) => bullets.slice(0, i)
          .filter((a) => possibleRepeat(a, b))
          .map((a) => `${a.id}/${b.id}`))
        if (pairs.length > 0) lines.push(`Check these overlapping citations for possible repeats: ${pairs.slice(0, 4).join(', ')}. Compare the claims and their full evidence before editing.`)
      }
      // The summary's evidence is the employer's selected activities, including the ones no bullet cites (the writer saw them all).
      const cited = new Set(ex.bullets.flatMap((b) => b.sources.map((x) => x.id)))
      const spare = (ex.emp?.activities ?? []).filter((a) => !cited.has(a.id)).slice(0, REVIEW_SUMMARY_EVIDENCE_MAX)
      if (spare.length > 0) {
        lines.push('summary evidence (selected for this employer, not cited by a bullet; a summary claim may rest on these):')
        for (const a of spare) {
          const r = labelFor({ id: a.id, kind: 'activity', snippet: '' })
          lines.push(`  ${r.label} (${r.kind}): ${r.snippet}`)
        }
      }
      // The role overview (capped, as the writer saw it) is evidence for the summary's scope facts and figures.
      if (ex.emp?.overview?.trim()) lines.push(`summary scope source (the role overview; a summary figure or scope claim may rest on it, a bullet may not): ${ex.emp.overview.trim()}`)
      cv.push(lines.join('\n'))
    } else if (s.kind === 'profile' && doc.profile) {
      cv.push(`## profile\n${doc.profile.paragraph || '(none)'}`)
    } else if (s.kind === 'projects' && s.projectSource) {
      const project = labelFor(s.projectSource)
      const lines = [`## ${s.id} [read-only]`, `${project.label} (${project.kind}): ${project.snippet}`]
      for (const [i, b] of (s.bullets ?? []).entries()) {
        lines.push(`b${i + 1}: ${b.text}`)
        const cited = new Set<string>()
        for (const src of b.sources) {
          const actual = sourceText(input.evidence, src.id) ?? src.snippet
          if (cited.has(actual)) continue
          cited.add(actual)
          const ref = labelFor(src)
          lines.push(`  ${ref.label} (${ref.kind}): ${ref.snippet}`)
        }
      }
      cv.push(lines.join('\n'))
    } else if (CONTEXT_KINDS.has(s.kind)) {
      cv.push(`## ${s.id} [read-only]\n${s.markdown.split('\n').filter((l) => /^\s*-\s/.test(l)).map((l) => l.replace(/^\s*-\s+/, '')).join('; ')}`)
    }
  }

  const claimed = input.evidence.claimedNames.slice(0, REVIEW_LIMITS.maxClaimedNames)
  const inProgress = input.evidence.credentials.filter((c) => c.inProgress).map((c) => c.name)
  const list = (items: readonly string[]) => (items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : '(none)')
  const prompt = [
    '# Brief',
    briefText(input.brief),
    `Lead with:\n${list(input.brief.leadWith.map((l) => l.framing))}`,
    '# Job requirements\n\nFor judging coverage only. They are not facts about the candidate.',
    data('job_requirements', requirementsBlock(input.strategy)),
    '# Listed in the profile without evidence\n\nA bullet may name one only when the job asks for it.',
    data('claimed', list(claimed)),
    '# Still in progress\n\nNever presented as finished or held.',
    data('in_progress', list(inProgress)),
    ...(typeof input.yearsOfExperience === 'number' && input.yearsOfExperience > 0
      ? [`# Years of experience\n\nYears of experience (computed from the profile, supported): ${yearsPhrase(input.yearsOfExperience)}\n\nSupported evidence for the profile paragraph only. Keep that exact phrase in the profile; never remove or change it, and never raise a concern about the length of the career.`]
      : []),
    '# Emphasise items no evidence covers',
    data('uncovered', list(input.selection.uncovered)),
    '# The CV\n\nSection ids, bullet ids (b1, b2...) and, under each bullet, the evidence it was written from (S1, S2...). When editing a bullet, keep the recorded project name wherever it identifies the work. Keep each claim with its cited project and edition. Within an employer, remove a repeated bullet only when the other bullet already states the same complete claim. Check cited evidence even when labels differ, and preserve separate outcomes, numbers, periods, scope, responsibility, mechanisms and negations. Shared wording, project names, labels or figures are insufficient on their own.',
    data('cv', cv.join('\n\n')),
    `Return the edits (at most ${REVIEW_LIMITS.maxEdits}) and the concerns (at most ${REVIEW_LIMITS.maxConcerns}) as one JSON object matching the schema, in a \`\`\`json code block. Empty lists are fine.`,
  ].join('\n\n')
  return { prompt, labels: [...labels.values()] }
}

// ── Applying edits ──────────────────────────────────────────────────────────

/** Sections code renders from the profile: read-only, with the reason shown when an edit targets one. */
const CODE_RENDERED = new Set(['header', 'earlier-experience', 'certification', 'education', 'languages', 'competencies', 'tools', 'skills'])

export type ApplyContext = {
  brief: CvBrief
  strategy: Pick<Strategy, 'mustHave' | 'niceToHave'>
  evidence: Evidence
  /** The code-supplied years phrase a profile edit may keep (exactly) and may not change. */
  yearsOfExperience?: number | null
}

/** What a re-check needs to know about where the new text goes. */
export type RecheckScope = {
  emp?: EmployerEvidence
  current: boolean
  /** The other text it must not repeat a figure of: the entry's other lines and the profile paragraph (experience), or the experience text (profile). */
  others: readonly string[]
  /** The text being replaced: its names are allowed in the new text. */
  old: string
  /** The full text of the evidence the replaced bullet cited (empty when it cited none). */
  cited: readonly string[]
}

/** Why `text` may not replace an entry's text, or null (and the cleaned text, plus notes for the log). All the writers' checks, re-run on the new text, plus the proper-noun and qualitative-claim checks. */
export function recheckText(
  kind: 'bullet' | 'summary' | 'profile',
  raw: string,
  ctx: ApplyContext,
  scope: RecheckScope,
): { text: string; notes: string[] } | { why: string } {
  const emp = scope.emp
  const texts = emp ? evidenceTexts(emp) : ctx.evidence.employers.flatMap(evidenceTexts)
  const evidenceText = texts.join('\n')
  const ownText = [evidenceText, ...ctx.evidence.profileCompanies, ...ctx.evidence.profileTitles].join('\n')

  // The profile paragraph is written in first person; bullets and summaries are not.
  const voice = { allowFirstPerson: kind === 'profile' }
  const plain = plainProblems(raw, ownText, voice)
  if (plain.length > 0) return { why: `the new text is not plain text (${plainReasons(raw, ownText, voice).join(', ')})` }
  const text = plainLine(raw)
  if (!text) return { why: 'the new text is empty' }
  const max = kind === 'bullet' ? BULLET_MAX_WORDS : kind === 'summary' ? SUMMARY_MAX_WORDS : PROFILE_MAX_WORDS
  if (wordCount(text) > max) return { why: `the new text is ${wordCount(text)} words; the limit is ${max}` }

  const names = [...figureIgnoredNames(ctx.evidence), ...(emp ? employerProjectNames(emp).flatMap(projectFigureNames) : [])]
  const years = kind === 'profile' && typeof ctx.yearsOfExperience === 'number' && ctx.yearsOfExperience > 0 ? ctx.yearsOfExperience : null
  if (kind === 'profile') {
    // The one years phrase is code-supplied: exactly that phrase is allowed, any other number of years is not.
    const wrong = [...text.matchAll(/\b(\d{1,2})(\+?)\s*(?:years|yrs)\b/gi)].filter((m) => years === null || Number(m[1]) !== years || m[2] !== '+').map((m) => m[0])
    if (wrong.length > 0) return { why: years === null ? `states a number of years of experience (${wrong.join(', ')}), which is not supported` : `changes the years of experience: state exactly "${yearsPhrase(years)}" or no number of years (found ${wrong.join(', ')})` }
  }
  const figureTexts = kind === 'summary' && emp ? summaryEvidenceTexts(emp) : texts
  const unsupported = unsupportedFigures(text, years === null ? figureTexts : [...figureTexts, `${years} years of experience`], names)
  if (unsupported.length > 0) return { why: `figures not in the employer's evidence: ${unsupported.join(', ')}` }
  if (emp) {
    const projectClaims = ctx.evidence.independentProjects.flatMap((p) =>
      p.atoms.length ? p.atoms.flatMap((a) => [a.text, ...(a.impact ?? '').split(/(?<=[.!?])\s+|;\s*/)]) : p.thin ? [] : p.text.split(' — '))
    const includesClaim = (haystack: string, claim: string) =>
      ` ${normalised(haystack).join(' ')} `.includes(` ${normalised(claim).join(' ')} `)
    if (projectClaims.some((rawClaim) => {
      const claim = rawClaim.replace(/^I\s+/i, '')
      return wordCount(claim) >= 4 && (includesClaim(text, claim) || nearDuplicate(text, claim)) &&
        ![scope.old, ...figureTexts].some((own) => includesClaim(own, claim) || nearDuplicate(own, claim))
    })) {
      return { why: 'attributes independent project evidence to this employer' }
    }
  }
  const notes: string[] = []
  // A bullet states what ITS evidence states: a figure only in the employer's other evidence is rejected.
  // A summary (or profile) may use any selected evidence of the employer, including activities no bullet cites.
  if (kind === 'bullet' && scope.cited.length > 0) {
    const off = unsupportedFigures(text, scope.cited, names)
    if (off.length > 0) return { why: `${off.join(', ')} ${off.length === 1 ? 'is' : 'are'} not in the evidence this bullet cited (${off.length === 1 ? 'it is' : 'they are'} in the employer's other evidence)` }
  }
  // Meaning must not drift: no negation the evidence lacks, no superlative that loses its scope qualifier.
  if (kind === 'bullet') {
    const source = scope.cited.length > 0 ? scope.cited : texts
    const neg = negationDrift(text, source.join('\n'))
    if (neg.length > 0) return { why: `adds ${neg.map((n) => `"${n}"`).join(', ')}, which the evidence does not say (a rewording must not change the meaning)` }
    const drift = scopeDrift(text, source)[0]
    if (drift) return { why: `keeps "${drift.claim}" but drops "${drift.qualifier}", which the evidence attaches to it` }
  }

  const unrequested = claimedHits(text, ctx.evidence.claimedNames, { evidenceText, requirementText: requirementText(ctx.strategy) }).filter((c) => !c.requested).map((c) => c.name)
  if (unrequested.length > 0) return { why: `names a tool or skill the profile lists without evidence and the job does not ask for: ${unrequested.join(', ')}` }

  const intro = introducedNames(text, { titles: ctx.evidence.profileTitles, companies: ctx.evidence.profileCompanies }, evidenceText)
  if (intro.titles.length > 0) return { why: `introduces a job title: ${intro.titles.join(', ')}` }
  if (intro.companies.length > 0) return { why: `introduces a company name: ${intro.companies.join(', ')}` }
  const creds = credentialProblems(text, ctx.evidence.credentials, evidenceText)
  if (creds.length > 0) return { why: creds[0].problem }

  // A name, tool or acronym that is not in the old text, the evidence or the profile's own names. The job's requirement
  // text is deliberately NOT allowed: job keywords cannot be stuffed in. (The claimed-tool rule above is the one way a
  // job-named tool gets in, and only a tool the profile lists.)
  const allowed = [
    scope.old, ...texts, ...(kind === 'profile' ? scope.others : []),
    ...figureIgnoredNames(ctx.evidence), ...ctx.evidence.claimedNames, ...ctx.evidence.profileTitles, ...ctx.evidence.profileCompanies,
    ...ctx.evidence.credentials.map((c) => c.name), ...(emp ? [emp.employer.company, emp.employer.latestTitle] : []),
  ]
  const newNames = unsupportedProperNouns(text, allowed)
  if (newNames.length > 0) return { why: `introduces a name, tool or acronym that is not in the old text, the evidence or your profile: ${newNames.join(', ')}` }
  const claims = unsupportedQualitative(text, allowed)
  if (claims.length > 0) return { why: `adds a claim the evidence does not make: ${claims.join(', ')}` }

  if (kind !== 'profile') {
    const hit = playDownBullets([text], ctx.brief)[0]
    if (hit) return { why: `is about the play-down item "${hit.item}"` }
    const wrongTense = wrongTenseLines({ summary: kind === 'summary' ? text : '', bullets: kind === 'bullet' ? [text] : [] }, scope.current)
    if (wrongTense.length > 0) return { why: 'is in the present tense for a completed result' }
    const before = new Set(repeatedFigures([...scope.others, scope.old], names))
    const added = repeatedFigures([...scope.others, text], names).filter((f) => !before.has(f))
    if (added.length > 0) return { why: `repeats a figure already stated in this entry or the profile: ${added.join(', ')}` }
  } else {
    // The profile may repeat a figure a bullet states (the top of page 1 carries the best proof); it may not use more than PROFILE_MAX_FIGURES or make working-style claims.
    if (distinctNotableFigures(text, names).length > PROFILE_MAX_FIGURES) return { why: `uses more than ${PROFILE_MAX_FIGURES} notable figures` }
    const selfDescribed = selfDescriptions(text)
    if (selfDescribed.length > 0) return { why: `makes a working-style or personality claim the evidence cannot back: ${selfDescribed.join(', ')}` }
  }
  return { text, notes }
}

/**
 * The writers' lead-with and project rules, re-run on an entry AFTER an edit:
 * a lead-with project that had its own bullet must still have one, and a
 * selected project the entry reflected must still be reflected. Null when the
 * edit keeps both (or they were already broken before it).
 */
export function entryRuleProblem(
  emp: EmployerEvidence,
  ctx: Pick<ApplyContext, 'brief'>,
  before: { summary: string; bullets: readonly string[] },
  after: { summary: string; bullets: readonly string[] },
): string | null {
  const projectNames = employerProjectPeers(emp)
  for (const l of leadWithProjects(emp.projects, ctx.brief.leadWith, projectNames)) {
    if (leadWithStanding(before.bullets, l, projectNames) === 'own' && leadWithStanding(after.bullets, l, projectNames) !== 'own') {
      return `it takes away the own bullet of the lead-with project "${l.name}", which the brief asks the CV to lead with`
    }
  }
  for (const p of emp.projects) {
    if (isThin(p)) continue // a project with no text may always go: it has no evidence to protect
    const reflected = (e: typeof before) => selectedProjectReflected([e.summary, ...e.bullets], p, projectNames)
    if (reflected(before) && !reflected(after)) return `it leaves the selected project "${p.name}" out of the entry`
  }
  const recorded = evidenceRefs(emp).flatMap((s) => s.project ? [s.project.name] : [])
  for (const name of new Set(recorded)) {
    if (before.bullets.some((b) => namesProject(b, name, projectNames)) && !after.bullets.some((b) => namesProject(b, name, projectNames))) {
      return `it removes the last bullet naming the recorded project “${name}”`
    }
  }
  return null
}

export type ApplyResult = { applied: AppliedEdit[]; discarded: DiscardedEdit[] }

/** Applies the model's edits to `doc` (mutated) one by one, after re-checking each. Pure given its inputs. */
export function applyEdits(doc: ReviewDoc, edits: ReviewOutput['edits'], ctx: ApplyContext): ApplyResult {
  const applied: AppliedEdit[] = []
  const discarded: DiscardedEdit[] = []
  for (const e of edits.slice(0, REVIEW_LIMITS.maxEdits)) {
    const { sectionId } = e.target
    const bulletId = e.target.bulletId?.trim() || null
    const base = { sectionId, bulletId, action: e.action }
    const discard = (why: string) => { discarded.push({ ...base, proposed: e.newText ?? null, why, reason: e.reason }) }
    const proposed = e.action === 'replace' ? (e.newText ?? '') : ''
    if (e.action === 'replace' && !proposed.trim()) { discard('a replace needs the new text'); continue }

    const ex = doc.experience.get(sectionId)
    if (ex) {
      if (!ex.emp) { discard('this entry has no evidence to check an edit against'); continue }
      const emp = ex.emp
      if (!bulletId) { discard('name a bullet ("b1"...) or "summary" to edit in an experience entry'); continue }
      const active = () => ex.bullets.filter((b) => !b.removed)
      const activeTexts = () => active().map((b) => b.text)
      if (bulletId.toLowerCase() === 'summary') {
        if (!ex.summary) { discard('the entry has no summary'); continue }
        if (e.action === 'remove') { discard('the summary cannot be removed (every entry keeps one): reword it instead'); continue }
        const ok = recheckText('summary', proposed, ctx, { emp, current: ex.current, others: activeTexts().filter(Boolean), old: ex.summary, cited: [] })
        if ('why' in ok) { discard(ok.why); continue }
        if (ok.text === ex.summary) { discard('the new text is the same as the old'); continue }
        const rule = entryRuleProblem(emp, ctx, { summary: ex.summary, bullets: activeTexts() }, { summary: ok.text, bullets: activeTexts() })
        if (rule) { discard(rule); continue }
        applied.push({ ...base, before: shortened(ex.summary, 160), after: shortened(ok.text, 160), reason: e.reason, note: ok.notes.join(' ') })
        ex.summary = ok.text
        continue
      }
      const bullet = ex.bullets.find((b) => b.id === bulletId)
      if (!bullet) { discard(`there is no bullet "${bulletId}" in this entry`); continue }
      if (bullet.removed) { discard('that bullet was already removed'); continue }
      const siblings = active().filter((b) => b !== bullet)
      const without = siblings.map((b) => b.text)
      const refs = evidenceRefs(emp)
      const resolve = (b: typeof bullet) => refs.filter((ref) => b.sources.some((s) => s.id === ref.id && s.kind === ref.kind))
      const cited = resolve(bullet)
      if (e.action === 'remove') {
        if (active().length <= 1) { discard('it is the entry\'s last bullet, and an employer keeps at least one'); continue }
        const rule = entryRuleProblem(emp, ctx, { summary: ex.summary, bullets: activeTexts() }, { summary: ex.summary, bullets: without })
        if (rule) { discard(rule); continue }
        const duplicate = siblings.find((b) => sameCitedClaim({ text: b.text, sources: resolve(b) }, { text: bullet.text, sources: cited }))
        if (!duplicate && siblings.some((b) => claimText(b.text) === claimText(bullet.text))) {
          discard('identical wording cites distinct evidence; preserve its separate scope or clarify the wording')
          continue
        }
        const transferred = duplicate ? bullet.sources.filter((s) => !duplicate.sources.some((d) => d.id === s.id && d.kind === s.kind)) : []
        if (duplicate) duplicate.sources = [...duplicate.sources, ...transferred]
        const note = transferred.length > 0 ? 'Kept the removed duplicate’s citations on the remaining copy.' : ''
        applied.push({ ...base, before: shortened(bullet.text, 160), after: null, reason: e.reason, note })
        bullet.removed = true
        continue
      }
      const ok = recheckText('bullet', proposed, ctx, {
        emp, current: ex.current, others: [ex.summary, ...without].filter(Boolean), old: bullet.text, cited: cited.map((s) => s.text),
      })
      if ('why' in ok) { discard(ok.why); continue }
      if (ok.text === bullet.text) { discard('the new text is the same as the old'); continue }
      if (claimText(ok.text) !== claimText(bullet.text) && without.some((text) => claimText(text) === claimText(ok.text))) {
        discard('it repeats a claim already stated in another bullet of this entry')
        continue
      }
      const projectNames = employerProjectPeers(emp)
      const mismatched = cited.find((s) => s.project &&
        conflictingProjectEdition(ok.text, s.project.name, projectNames) &&
        !conflictingProjectEdition(bullet.text, s.project.name, projectNames))
      if (mismatched?.project) { discard(`the rewording names a different edition of “${mismatched.project.name}”`); continue }
      const citedNames = [...new Set(cited.flatMap((s) => s.project ? [s.project.name] : []))]
      const lost = cited.find((s) => s.project &&
        namesProject(bullet.text, s.project.name, projectNames) && !namesProject(ok.text, s.project.name, projectNames))
      if (lost?.kind === 'activity' && lost.project) { discard(`the rewording loses the recorded project “${lost.project.name}” from this bullet`); continue }
      const borrowed = projectNames.find((name) =>
        !citedNames.includes(name) && !namesProject(bullet.text, name, projectNames) && namesProject(ok.text, name, projectNames) &&
        !cited.some((s) => namesProject(s.text, name, projectNames)),
      )
      if (borrowed) { discard(`the rewording adds the project “${borrowed}” without support from the cited evidence`); continue }
      const after = active().map((b) => (b === bullet ? ok.text : b.text))
      const rule = entryRuleProblem(emp, ctx, { summary: ex.summary, bullets: activeTexts() }, { summary: ex.summary, bullets: after })
      if (rule) { discard(rule); continue }
      if (lost?.project) { discard(`the rewording loses the recorded project “${lost.project.name}” from this bullet`); continue }
      // Provenance: the text is no longer the writer's. Keep the sources while the new text still states the figures the old
      // text took from them (or neither states any); otherwise clear them. Either way it is marked as edited by review.
      const names = [...figureIgnoredNames(ctx.evidence), ...employerProjectNames(emp).flatMap(projectFigureNames)]
      const oldFigures = figuresIn(bullet.text, { names }).map((f) => f.key)
      const newFigures = figuresIn(ok.text, { names }).map((f) => f.key)
      const keep = oldFigures.length === 0 || newFigures.some((k) => oldFigures.includes(k))
      const notes = [...ok.notes]
      if (!keep && bullet.sources.length > 0) notes.push('The new text no longer states the figures of the evidence it cited, so its sources were cleared: edited by review.')
      applied.push({ ...base, before: shortened(bullet.text, 160), after: shortened(ok.text, 160), reason: e.reason, note: notes.join(' ') })
      bullet.text = ok.text
      bullet.edited = true
      if (!keep) bullet.sources = []
      continue
    }

    if (sectionId === 'profile' && doc.profile) {
      if (bulletId) { discard('the profile has no bullets: leave bulletId out to reword its paragraph'); continue }
      if (e.action === 'remove') { discard('the profile paragraph can only be reworded, not removed'); continue }
      const experienceText = [...doc.experience.values()].flatMap((x) => [x.summary, ...x.bullets.filter((b) => !b.removed).map((b) => b.text)])
      const ok = recheckText('profile', proposed, ctx, { current: false, others: experienceText, old: doc.profile.paragraph, cited: [] })
      if ('why' in ok) { discard(ok.why); continue }
      if (ok.text === doc.profile.paragraph) { discard('the new text is the same as the old'); continue }
      applied.push({ ...base, before: shortened(doc.profile.paragraph, 160), after: shortened(ok.text, 160), reason: e.reason, note: ok.notes.join(' ') })
      doc.profile.paragraph = ok.text
      continue
    }

    discard(CODE_RENDERED.has(sectionId) || sectionId === 'profile' || sectionId.startsWith('projects:')
      ? 'that section is rendered by code from your profile and is read-only'
      : `there is no editable section "${sectionId}"`)
  }
  return { applied, discarded }
}

/** The assembled CV with the doc's edits written back (sections and the joined Markdown). The input is not modified. */
export function writeBack(assembled: CvAssembled, doc: ReviewDoc): CvAssembled {
  const sections = assembled.sections.map((s) => {
    const ex = doc.experience.get(s.id)
    if (ex) {
      const bullets: BulletProvenance[] | undefined = s.bullets
        ? ex.bullets.filter((b) => !b.removed).map((b): BulletProvenance => ({ text: b.text, sources: b.sources, ...(b.edited ? { editedByReview: true } : {}) }))
        : undefined
      return { ...s, markdown: renderExperience(ex), ...(bullets ? { bullets } : {}) }
    }
    if (s.id === 'profile' && doc.profile) return { ...s, markdown: renderProfile(doc.profile) }
    return s
  })
  return { ...assembled, sections, markdown: `${sections.map((s) => s.markdown).join('\n\n')}\n` }
}

// ── Concerns ────────────────────────────────────────────────────────────────

/** The model's concerns as stored: evidence labels resolved to snippets (unknown labels dropped), empty and repeated ones removed, capped. */
export function toConcernRecords(concerns: ReviewOutput['concerns'], labels: readonly ReviewLabel[]): ConcernRecord[] {
  const byLabel = new Map(labels.map((l) => [l.label, l]))
  const seen = new Set<string>()
  const out: ConcernRecord[] = []
  for (const c of concerns) {
    const title = plainLine(c.title)
    const question = plainLine(c.question)
    if (!title || !question || seen.has(title.toLowerCase())) continue
    seen.add(title.toLowerCase())
    const refs = [...new Set(c.refs.map((r) => r.replace(/[[\]\s]/g, '').toUpperCase()))]
      .flatMap((r) => { const l = byLabel.get(r); return l ? [{ label: l.label, snippet: snippetOf(l.snippet, 160) }] : [] })
    out.push({ kind: c.kind, title, why: plainLine(c.why), question, refs })
    if (out.length >= REVIEW_LIMITS.maxConcerns) break
  }
  return out
}

// ── The stage ───────────────────────────────────────────────────────────────

export type ReviewOptions = {
  profileId: string
  jobApplicationId: string
  runId: string
  /** The desk document the draft will land in, when it already exists (usage attribution). */
  writingDeskDocumentId?: string | null
  /** Epoch ms the stage must finish by (the run's deadline less the Land reserve). */
  deadline: number
}

export type ReviewOutcome = {
  /** What is stored on the run. */
  review: CvReview
  /** The CV after the applied edits (the input object itself when none were applied). */
  assembled: CvAssembled
  usage: CallUsage
  /** Log notes for the Review row. */
  notes: string[]
}

const skipped = (reason: string, over: Partial<CvReview> = {}): CvReview => ({
  skipped: true, skipReason: reason, model: null, tokens: { input: 0, output: 0 }, costUsd: null, applied: [], discarded: [], concerns: [], ...over,
})

const OUTPUT_FORMAT = `Output: one JSON object in a \`\`\`json code block, nothing else. It must match this JSON Schema. Limits in the descriptions are hard limits.
\`\`\`json
${JSON.stringify(z.toJSONSchema(ReviewOutputContract, { io: 'input' }))}
\`\`\``

/**
 * Runs the review. NEVER throws and never fails the run: a model that
 * cannot answer (timeout, unusable output after the one retry, any error) or a
 * run with no time left gives a skipped review with its reason, and the CV is
 * returned unchanged. `validate` is the Assemble validator for the edited
 * Markdown: an edited CV it rejects is dropped in favour of the unreviewed one.
 */
export async function runReview(
  input: ReviewPromptInput & { validate: (markdown: string) => string[] },
  opts: ReviewOptions,
): Promise<ReviewOutcome> {
  const unchanged = (review: CvReview, usage: CallUsage = NO_USAGE, notes: string[] = []): ReviewOutcome => ({ review, assembled: input.assembled, usage, notes })
  if (opts.deadline - Date.now() < REVIEW_MIN_START_MS) {
    const reason = 'There was not enough time left for the review, so the CV landed unreviewed.'
    return unchanged(skipped(reason), NO_USAGE, [reason])
  }
  let usage: CallUsage = NO_USAGE
  try {
    const doc = reviewDoc(input.assembled, input.selection, input.evidence)
    const { prompt, labels } = reviewPrompt(input, doc)
    const [instructions, writing] = await Promise.all([loadCVReviewPrompt(opts.profileId), loadWritingContext(opts.profileId)])
    const call = await completeValidated(opts.profileId, prompt, ReviewOutputSchema, {
      role: 'analysis',
      system: composeSystem(writing.rules, instructions, OUTPUT_FORMAT),
      maxOutputTokens: MAX_OUTPUT_TOKENS.review,
      retryMaxOutputTokens: MAX_OUTPUT_TOKENS.reviewRetry,
      temperature: TEMPERATURE.review,
      timeoutMs: TIME_BUDGET_MS.review,
      deadline: opts.deadline,
      feature: CV_GENERATION_FEATURES.review,
      attribution: { jobApplicationId: opts.jobApplicationId, runId: opts.runId, ...(opts.writingDeskDocumentId ? { writingDeskDocumentId: opts.writingDeskDocumentId } : {}) },
      label: 'review',
    })
    usage = call.usage
    const concerns = toConcernRecords(call.value.concerns, labels)
    const { applied, discarded } = applyEdits(doc, call.value.edits, input)
    const notes: string[] = []
    const unreadable = call.value.unreadable
    if (unreadable.edits > 0) notes.push(`${unreadable.edits === 1 ? '1 edit' : `${unreadable.edits} edits`} in the answer could not be read and ${unreadable.edits === 1 ? 'was' : 'were'} dropped.`)
    if (unreadable.concerns > 0) notes.push(`${unreadable.concerns === 1 ? '1 concern' : `${unreadable.concerns} concerns`} in the answer could not be read and ${unreadable.concerns === 1 ? 'was' : 'were'} dropped.`)
    let assembled = input.assembled
    let finalApplied = applied
    if (applied.length > 0) {
      const edited = writeBack(input.assembled, doc)
      const problems = input.validate(edited.markdown)
      if (problems.length > 0) {
        // The edited CV is not a valid document: keep the unreviewed one, and say every edit was dropped.
        discarded.push(...applied.map((a): DiscardedEdit => ({ sectionId: a.sectionId, bulletId: a.bulletId, action: a.action, proposed: a.after, why: `the edited CV did not validate (${problems[0]})`, reason: a.reason })))
        finalApplied = []
        notes.push('The edited CV failed block validation, so none of the edits were applied.')
      } else {
        assembled = edited
      }
    }
    const review: CvReview = {
      skipped: false, skipReason: null, model: call.model,
      tokens: { input: call.usage.input, output: call.usage.output }, costUsd: call.usage.calls > 0 ? call.usage.costUsd : null,
      applied: finalApplied, discarded, concerns,
    }
    return { review, assembled, usage: call.usage, notes }
  } catch (err) {
    usage = usageOfError(err).calls > 0 ? usageOfError(err) : usage
    const why = err instanceof LLMError
      ? (err.kind === 'timeout' ? 'The review timed out' : `The review could not be used (${err.kind})`)
      : 'The review failed'
    const reason = `${why}, so the CV landed unreviewed. ${err instanceof LLMError ? shortReason(err.message) : ''}`.trim()
    if (!(err instanceof LLMError)) console.error('[cv-generation] review failed', { runId: opts.runId, err })
    return unchanged(skipped(reason, { tokens: { input: usage.input, output: usage.output }, costUsd: usage.calls > 0 ? usage.costUsd : null }), usage, [reason])
  }
}
