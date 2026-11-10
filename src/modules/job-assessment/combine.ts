/**
 * Combines Jev's judge answers with the user's eligibility into the early
 * assessment result (spec §5). Pure code: every decision is here, visible and
 * testable; Jev only supplies the judgments.
 *
 * Blockers (spec §5 table):
 * | Kind                      | Hard (→ Blocked)            | Amber                                    | Major gap (red, penalty) |
 * |---------------------------|-----------------------------|------------------------------------------|--------------------------|
 * | Credential must-have      | p < 0.3                     | —                                        | —                        |
 * | Years must-have           | years rule = block          | warn / stretch (both count to penalty)   | —                        |
 * | Other experience/skill    | —                           | —                                        | p < 0.3                  |
 * | Work rights               | not covered + not_offered / right_to_work_required | not covered + not_mentioned | —            |
 * | Relocation                | —                           | must be based in a country the user neither lives in nor targets | — |
 * | Pay                       | stated max < floor          | min < floor ≤ max                        | —                        |
 * | Dealbreaker               | p > 0.7                     | 0.3 ≤ p ≤ 0.7                            | —                        |
 *
 * Score:
 *   coverage  = Σ w·p / Σ w   (w: must 2, nice 1; years p = min(1, est/required); parts p = mean)
 *   composite = weighted skills / seniority / domain / coverage (+ direction when asked) − 0.05 if max pay < target
 *   score     = clamp(round(1 + 9·composite − min(2, 0.5·(major gaps + years warns + stretches))), 1, 10)
 */

import type { BoxResponse, ChoiceResponse, NoulResponse, ScoreResponse } from '@typesafe-ai/sdk'
import type { Eligibility, SearchProfile } from '@/modules/search-profile/schema'
import type { RoleTimelineEntry } from './candidate-state'
import { checkPay, checkRelocation, checkWorkRights, countryName, type Sponsorship } from './eligibility'
import { questionIds, requirementMode, type SeniorityOption } from './questions'
import {
  ASSESSMENT_CONFIG,
  CREDENTIAL_KINDS,
  PIPELINE_VERSION,
  type AssessmentLevel,
  type AssessmentResult,
  type Blocker,
  type JobFacts,
  type ScoreBreakdown,
  type YearsRequirementResult,
} from './schema'
import { computeYears, formatYearsSummary, yearsStatus, type ShareAnswerPair, type ShareProbabilities } from './years'

/** One Jev answer, as returned by askJev or read back from stored signals. */
export type JevAnswer = NoulResponse | ChoiceResponse | ScoreResponse | BoxResponse

/** Judge answers keyed by question id (see questions.ts). */
export type JudgeAnswers = Readonly<Record<string, JevAnswer | undefined>>

export interface CombineInput {
  facts: JobFacts
  answers: JudgeAnswers
  /** From buildCandidateState; must be the timeline the judge questions were built from. */
  timeline: readonly RoleTimelineEntry[]
  eligibility: Eligibility
  /** `countries` = the user's target countries (relocation check). */
  searchProfile: Pick<SearchProfile, 'countries'>
  today: Date
}

/** Thrown when an answer for a question that must have been asked is missing or the wrong type. */
export class MissingAnswerError extends Error {
  constructor(public readonly questionId: string) {
    super(`Missing or malformed Jev answer: ${questionId}`)
    this.name = 'MissingAnswerError'
  }
}

// ── Answer accessors ────────────────────────────────────────────────────────

function noul(answers: JudgeAnswers, id: string): number {
  const a = answers[id]
  if (a?.type !== 'noul' || typeof a.noul !== 'number') throw new MissingAnswerError(id)
  return a.noul
}

function optionalNoul(answers: JudgeAnswers, id: string): number | null {
  const a = answers[id]
  return a?.type === 'noul' && typeof a.noul === 'number' ? a.noul : null
}

function choice(answers: JudgeAnswers, id: string): ChoiceResponse {
  const a = answers[id]
  if (a?.type !== 'choice' || !a.probabilities) throw new MissingAnswerError(id)
  return a
}

function scoreValue(answers: JudgeAnswers, id: string): number {
  const a = answers[id]
  if (a?.type !== 'score' || typeof a.score !== 'number') throw new MissingAnswerError(id)
  return a.score
}

/** Both orders of every role's share question for requirement `i`. */
export function shareAnswersFor(
  answers: JudgeAnswers,
  i: number,
  timeline: readonly RoleTimelineEntry[],
): Record<string, ShareAnswerPair> {
  const out: Record<string, ShareAnswerPair> = {}
  for (const { key } of timeline) {
    const pick = (order: 'a' | 'b'): ShareProbabilities | undefined => {
      const a = answers[questionIds.share(i, key, order)]
      return a?.type === 'choice' ? (a.probabilities as ShareProbabilities) : undefined
    }
    const pair = { a: pick('a'), b: pick('b') }
    if (!pair.a && !pair.b) throw new MissingAnswerError(questionIds.share(i, key, 'a'))
    out[key] = pair
  }
  return out
}

// ── Pieces exported for tests and the UI ────────────────────────────────────

export function levelForScore(score: number): AssessmentLevel {
  for (const step of ASSESSMENT_CONFIG.ladder) if (score >= step.min) return step.level
  return 'weak'
}

/** Σ p(option) · value over the seniority_fit options. */
export function senioritySignal(probabilities: Partial<Record<SeniorityOption, number>>): number {
  let s = 0
  for (const [option, value] of Object.entries(ASSESSMENT_CONFIG.seniorityValues)) {
    s += (probabilities[option as SeniorityOption] ?? 0) * value
  }
  return s
}

/**
 * The composite → score arithmetic. When `coverage` is null (no scorable
 * requirements) its weight is spread proportionally over the other signals.
 */
export function computeScore(signals: {
  coverage: number | null
  skills: number
  seniority: number
  domain: number
  direction: number | null
  belowTargetPay: boolean
  penaltyItems: number
}): ScoreBreakdown & { score: number } {
  const { scoreWeights, penalty: pen, belowTargetPayPenalty } = ASSESSMENT_CONFIG
  const weights: Record<string, number> =
    signals.direction === null ? { ...scoreWeights.base } : { ...scoreWeights.withDirection }
  const values: Record<string, number | null> = {
    coverage: signals.coverage,
    skills: signals.skills,
    seniority: signals.seniority,
    domain: signals.domain,
    direction: signals.direction,
  }
  let weighted = 0
  let totalWeight = 0
  for (const [k, w] of Object.entries(weights)) {
    const v = values[k]
    if (v === null || v === undefined) continue
    weighted += w * v
    totalWeight += w
  }
  const composite = (totalWeight > 0 ? weighted / totalWeight : 0) - (signals.belowTargetPay ? belowTargetPayPenalty : 0)
  const raw = 1 + 9 * composite
  const penalty = Math.min(pen.cap, pen.perItem * signals.penaltyItems)
  const score = Math.min(10, Math.max(1, Math.round(raw - penalty)))
  return { ...signals, composite, raw, penalty, score }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function fmt1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1)
}

function countryList(codes: readonly string[]): string {
  const names = codes.map((c) => countryName(c) || c)
  return names.length > 4 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ')
}

const SEVERITY_ORDER: Record<Blocker['severity'], number> = { hard: 0, unconfirmed: 1, stretch: 2, warn: 3 }

// ── Combine ─────────────────────────────────────────────────────────────────

/**
 * Builds the assessment result from the facts, the judge answers and the
 * user's eligibility. Throws MissingAnswerError when an answer the question
 * set must have produced is missing — a failed call is never read as a "no".
 */
export function combineAssessment(input: CombineInput): AssessmentResult {
  const { facts, answers, timeline, eligibility, searchProfile, today } = input
  const { requirement: band, coverageWeights, dealbreaker: dbBand, maxStrengths } = ASSESSMENT_CONFIG

  const blockers: Blocker[] = []
  const gaps: string[] = []
  const unsettled: string[] = []
  const notes: string[] = []
  const years: YearsRequirementResult[] = []
  const strengthCandidates: { text: string; p: number; i: number }[] = []
  const yearsStrengths: string[] = []
  let penaltyItems = 0
  let coverageNum = 0
  let coverageDen = 0

  // ── Requirements ──
  facts.requirements.forEach((req, i) => {
    const mode = requirementMode(req)
    if (mode === 'skip') return
    const isMust = req.importance === 'must'
    const w = coverageWeights[req.importance]

    if (mode === 'years') {
      const { min: required, area } = req.years!
      const estimate = computeYears(shareAnswersFor(answers, i, timeline), timeline, today)
      const capability = optionalNoul(answers, questionIds.capability(i))
      const status = yearsStatus(estimate.years, required, capability)
      const summary = formatYearsSummary(estimate)
      years.push({
        requirementIndex: i, text: req.text, area, importance: req.importance, required,
        estimate: estimate.years, capability, status, summary, roles: estimate.roles,
      })
      coverageNum += w * clamp01(estimate.years / required)
      coverageDen += w
      if (!isMust) return

      const short = `~${fmt1(estimate.years)} of ${required}`
      if (status === 'met') {
        yearsStrengths.push(`${req.text} (~${fmt1(estimate.years)} yrs)`)
      } else if (status === 'warn') {
        penaltyItems += 1
        blockers.push({ kind: 'years', severity: 'warn', label: `Short on years (${short}): ${area}`, detail: summary })
      } else if (status === 'stretch') {
        penaltyItems += 1
        blockers.push({
          kind: 'years', severity: 'stretch',
          label: `Short on years (${short}) — strong transferable experience across your CV`,
          detail: `${area}. ${summary}`,
        })
      } else {
        blockers.push({ kind: 'years', severity: 'hard', label: `Not enough years (${short}): ${area}`, detail: summary })
      }
      return
    }

    let p: number
    let weakParts: string[] = []
    if (mode === 'parts') {
      const ps = req.parts!.map((_, n) => noul(answers, questionIds.part(i, n)))
      p = ps.reduce((s, x) => s + x, 0) / ps.length
      weakParts = req.parts!.filter((_, n) => ps[n] < band.gap)
    } else {
      p = noul(answers, questionIds.requirement(i))
    }
    coverageNum += w * p
    coverageDen += w
    if (!isMust) return

    if (p < band.gap) {
      if (CREDENTIAL_KINDS.has(req.kind)) {
        blockers.push({ kind: 'credential', severity: 'hard', label: `Missing requirement: ${req.text}` })
      } else {
        penaltyItems += 1
        gaps.push(weakParts.length > 0 && weakParts.length < req.parts!.length
          ? `${req.text} (not shown: ${weakParts.join(', ')})`
          : req.text)
      }
    } else if (p < band.met) {
      unsettled.push(req.text)
    } else {
      strengthCandidates.push({ text: req.text, p, i })
    }
  })

  // ── Work rights ──
  const sponsorship = choice(answers, questionIds.sponsorship).choice as Sponsorship
  const location = facts.location
  const workRights = checkWorkRights(eligibility, location, sponsorship, today)
  if (workRights.status === 'blocked') {
    blockers.push({
      kind: 'work_rights', severity: 'hard',
      label: `Needs sponsorship for ${countryList(workRights.countries)}`,
      detail: sponsorship === 'not_offered'
        ? 'The description says visa sponsorship is not available.'
        : 'The description says candidates must already have the right to work there.',
    })
  } else if (workRights.status === 'unconfirmed') {
    blockers.push({
      kind: 'work_rights', severity: 'unconfirmed',
      label: `Needs sponsorship for ${countryList(workRights.countries)} — not confirmed`,
      detail: 'The description says nothing about sponsorship or the right to work.',
    })
  }

  const locationKnown = location.mode === 'remote_anywhere' || location.countries.length > 0 ||
    (location.mode === 'remote_region' && location.remoteRegions.length > 0)
  if (!locationKnown) notes.push('Location unknown: work rights and relocation not checked')
  else if (workRights.status === 'unknown' && eligibility.citizenships.length === 0 && eligibility.visas.length === 0) {
    notes.push('Add your citizenships or visas to check work rights')
  }

  // ── Relocation ──
  if (checkRelocation(eligibility, location, searchProfile.countries) === 'unconfirmed') {
    blockers.push({
      kind: 'relocation', severity: 'unconfirmed',
      label: `Must be based in ${countryList(location.mode === 'remote_region' && location.remoteRegions.length ? location.remoteRegions : location.countries)}`,
      // checkRelocation only returns 'unconfirmed' when currentCountry is set.
      detail: `You live in ${countryName(eligibility.currentCountry ?? '')}, and it isn't one of your target countries.`,
    })
  }

  // ── Pay ──
  const pay = checkPay(eligibility, facts.salary)
  if (facts.salary && pay.floor !== undefined) {
    const cur = facts.salary.currency.toUpperCase()
    const range = [facts.salary.min, facts.salary.max].filter((n) => n !== null).map((n) => n!.toLocaleString('en-US')).join('–')
    if (pay.status === 'below_floor') {
      blockers.push({ kind: 'pay', severity: 'hard', label: 'Pay is below your floor', detail: `${cur} ${range} vs your floor of ${cur} ${pay.floor.toLocaleString('en-US')}.` })
    } else if (pay.status === 'straddles_floor') {
      blockers.push({ kind: 'pay', severity: 'unconfirmed', label: 'Pay range straddles your floor', detail: `${cur} ${range} vs your floor of ${cur} ${pay.floor.toLocaleString('en-US')}.` })
    }
  }

  // ── Dealbreakers ──
  eligibility.dealbreakers.forEach((d, i) => {
    const p = noul(answers, questionIds.dealbreaker(i))
    if (p > dbBand.hard) blockers.push({ kind: 'dealbreaker', severity: 'hard', label: `Dealbreaker: ${d}` })
    else if (p >= dbBand.unconfirmed) blockers.push({ kind: 'dealbreaker', severity: 'unconfirmed', label: `Possible dealbreaker: ${d}` })
  })

  // ── Informational ──
  if (facts.employmentType === 'contract') notes.push('Contract role')
  else if (facts.employmentType === 'fixed_term') notes.push('Fixed-term role')
  const remote = optionalNoul(answers, questionIds.remoteMatch)
  if (remote !== null && remote < band.gap) notes.push("Working pattern doesn't fit your remote preference")

  // ── Score ──
  const { rubricMax } = ASSESSMENT_CONFIG
  const directionAnswer = answers[questionIds.directionFit]
  const breakdown = computeScore({
    coverage: coverageDen > 0 ? coverageNum / coverageDen : null,
    skills: clamp01(scoreValue(answers, questionIds.skillsMatch) / rubricMax.skills),
    seniority: senioritySignal(choice(answers, questionIds.seniorityFit).probabilities as Partial<Record<SeniorityOption, number>>),
    domain: clamp01(scoreValue(answers, questionIds.domainFit) / rubricMax.domain),
    direction: directionAnswer ? clamp01(scoreValue(answers, questionIds.directionFit) / rubricMax.direction) : null,
    belowTargetPay: pay.belowTarget,
    penaltyItems,
  })
  const { score, ...scoreBreakdown } = breakdown

  const strengths = [
    ...strengthCandidates.sort((a, b) => b.p - a.p || a.i - b.i).slice(0, maxStrengths).map((s) => s.text),
    ...yearsStrengths,
  ]

  blockers.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  return {
    pipelineVersion: PIPELINE_VERSION,
    score,
    level: levelForScore(score),
    blocked: blockers.some((b) => b.severity === 'hard'),
    blockers,
    strengths,
    gaps,
    unsettled,
    notes,
    years,
    breakdown: scoreBreakdown,
  }
}

/** "Blocked · 7/10" when blocked, else e.g. "pursue · 7/10" (spec §5 display). */
export function displayLabel(result: Pick<AssessmentResult, 'blocked' | 'score' | 'level'>): string {
  return result.blocked ? `Blocked · ${result.score}/10` : `${result.level} · ${result.score}/10`
}
