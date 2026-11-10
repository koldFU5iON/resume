/**
 * ALL Jev question wording for the early job assessment, and the state
 * builders the questions refer to. Wording is verbatim from the design spec
 * (docs/superpowers/specs/2026-11-10-jev-early-assessment-design.md §4); edit
 * it here only, and bump PIPELINE_VERSION when you do.
 *
 * Question ids are not sent to the model (only instructions, criteria and
 * option names are), so they're chosen for code: indices are 0-based positions
 * in `facts.requirements` / `parts` / `eligibility.dealbreakers`.
 *
 *   req_<i>                   requirement noul (no years, no parts)
 *   req_<i>_part_<n>          one noul per part of an "all of these" requirement
 *   req_<i>_<roleKey>_a / _b  years share per role, options in spec order / reversed
 *   req_<i>_capability        years capability over the whole CV
 *   skills_match, seniority_fit, domain_fit, sponsorship
 *   direction_fit             only with direction preferences
 *   remote_match              only with a remote preference
 *   dealbreaker_<i>           one per eligibility dealbreaker
 *
 * Requirements of kind `availability` are never asked. A requirement with
 * `years` gets the years questions (and no req_<i>), even when it also has parts.
 *
 * Pure module.
 */

import type { ChoiceQuestion, NoulQuestion, Questions, ScoreQuestion } from '@typesafe-ai/sdk'
import type { SearchProfile } from '@/modules/search-profile/schema'
import type { CandidateState } from './candidate-state'
import type { JobFacts, JobRequirement } from './schema'

// ── Ids ─────────────────────────────────────────────────────────────────────

export type ShareOrder = 'a' | 'b'

export const questionIds = {
  requirement: (i: number) => `req_${i}`,
  part: (i: number, n: number) => `req_${i}_part_${n}`,
  share: (i: number, roleKey: string, order: ShareOrder) => `req_${i}_${roleKey}_${order}`,
  capability: (i: number) => `req_${i}_capability`,
  dealbreaker: (i: number) => `dealbreaker_${i}`,
  skillsMatch: 'skills_match',
  seniorityFit: 'seniority_fit',
  domainFit: 'domain_fit',
  sponsorship: 'sponsorship',
  directionFit: 'direction_fit',
  remoteMatch: 'remote_match',
} as const

/** How a requirement is asked. `skip` = availability (never asked). */
export type RequirementMode = 'skip' | 'years' | 'parts' | 'single'

export function requirementMode(req: JobRequirement): RequirementMode {
  if (req.kind === 'availability') return 'skip'
  if (req.years) return 'years'
  if (req.parts && req.parts.length > 0) return 'parts'
  return 'single'
}

// ── Verify (spec §4.1) — state `{ description }` ────────────────────────────

export interface VerifyState {
  description: string
}

export function buildVerifyState(job: { description: string }): VerifyState {
  return { description: job.description.trim() }
}

export function buildVerifyQuestions() {
  return {
    is_full_description: {
      type: 'noul',
      instructions: '`description` is a complete job posting for a single role.',
      criteria: {
        true: 'It describes what the role involves and what is expected of candidates, in enough detail to judge fit.',
        false: 'It is a teaser, a truncated preview, a list of several jobs, a login/cookie/error page, or too short to judge fit.',
      },
    },
    has_requirements: {
      type: 'noul',
      instructions: '`description` lists requirements, qualifications or experience expected of candidates.',
    },
    has_responsibilities: {
      type: 'noul',
      instructions: '`description` describes the responsibilities or day-to-day work of the role.',
    },
  } satisfies Record<string, NoulQuestion>
}

export type VerifyQuestions = ReturnType<typeof buildVerifyQuestions>

// ── Judge state (spec §4.2) ─────────────────────────────────────────────────

export interface JudgeJob {
  title: string
  company: string
  description: string
}

/**
 * Preferences sent to Jev. Only fields that a conditional question needs are
 * present, and empty ones are left out (an empty list can read as a signal).
 */
export interface JudgePreferences {
  targetRoles?: string[]
  careerGoals?: string
  careerChangeContext?: string
  remotePreference?: string
}

/**
 * How `remotePreference` is written in the state: a short description rather
 * than a bare enum value, so "hybrid" isn't read as "hybrid only".
 * `flexible` is absent on purpose: any pattern fits, so remote_match isn't asked.
 */
const REMOTE_PREFERENCE_TEXT: Record<string, string> = {
  remote: 'Fully remote',
  hybrid: 'Hybrid: some days in an office, some remote',
  onsite: 'On-site in an office',
}

/**
 * Picks the preferences the conditional questions need from a search profile.
 * Null when neither direction_fit nor remote_match would be asked.
 */
export function buildJudgePreferences(profile: Pick<SearchProfile, 'roles' | 'careerGoals' | 'pivotContext' | 'remotePreference'>): JudgePreferences | null {
  const prefs: JudgePreferences = {}
  const roles = profile.roles.map((r) => r.trim()).filter(Boolean)
  if (roles.length > 0) prefs.targetRoles = roles
  if (profile.careerGoals.trim()) prefs.careerGoals = profile.careerGoals.trim()
  if (profile.pivotContext.trim()) prefs.careerChangeContext = profile.pivotContext.trim()
  const remote = REMOTE_PREFERENCE_TEXT[profile.remotePreference]
  if (remote) prefs.remotePreference = remote
  return Object.keys(prefs).length > 0 ? prefs : null
}

export function asksDirection(prefs: JudgePreferences | null): boolean {
  return Boolean(prefs && (prefs.targetRoles?.length || prefs.careerGoals || prefs.careerChangeContext))
}

export function asksRemote(prefs: JudgePreferences | null): boolean {
  return Boolean(prefs?.remotePreference)
}

export interface JudgeState {
  candidate: CandidateState
  job: JudgeJob
  preferences?: JudgePreferences
}

/** `preferences` is included only when direction_fit or remote_match is asked (spec §4.2). */
export function buildJudgeState(input: {
  candidate: CandidateState
  job: JudgeJob
  preferences?: JudgePreferences | null
}): JudgeState {
  const { title, company, description } = input.job
  const state: JudgeState = {
    candidate: input.candidate,
    job: { title: title.trim(), company: company.trim(), description: description.trim() },
  }
  const prefs = input.preferences ?? null
  if (asksDirection(prefs) || asksRemote(prefs)) state.preferences = prefs!
  return state
}

// ── Judge questions (spec §4.2) ─────────────────────────────────────────────

export function requirementQuestion(text: string): NoulQuestion {
  return {
    type: 'noul',
    instructions: `The candidate described in \`candidate\` meets this job requirement: "${text}"`,
    criteria: {
      true: 'The profile shows the requirement is met, directly or through an alternative the requirement itself allows (e.g. "or equivalent experience", "or related field", "or similar").',
      false: 'The profile does not show it, shows only a lower level (e.g. a diploma where a degree is required, fewer years than stated), or shows it only partially.',
    },
  }
}

export function partQuestion(part: string): NoulQuestion {
  return {
    type: 'noul',
    instructions: `The candidate described in \`candidate\` has hands-on experience with ${part}.`,
    criteria: {
      true: `The profile shows the candidate doing ${part} themselves as part of a role.`,
      false: `The profile does not show the candidate doing ${part}, or only mentions it in passing.`,
    },
  }
}

const SHARE_CRITERIA = {
  most_of_the_role: 'This work was the main focus of the role, most of the time.',
  about_half: 'This work was a regular, major part of the role, roughly half of it.',
  small_part: 'This work came up occasionally or was a minor part of the role.',
  none: 'The role did not involve this work.',
} as const

type ShareCriteria = Record<keyof typeof SHARE_CRITERIA, string>

/** Order `a` lists the options as in the spec; `b` reverses them (Jev leans to the first option). */
export function shareQuestion(roleKey: string, area: string, order: ShareOrder): ChoiceQuestion<ShareCriteria> {
  const entries = Object.entries(SHARE_CRITERIA)
  const ordered = order === 'a' ? entries : [...entries].reverse()
  return {
    type: 'choice',
    instructions: `How much of the role \`candidate.roles.${roleKey}\` was spent doing this kind of work: ${area}?`,
    criteria: Object.fromEntries(ordered) as ShareCriteria,
  }
}

export function capabilityQuestion(area: string): NoulQuestion {
  return {
    type: 'noul',
    instructions: `The person in \`candidate\` has done the core work of ${area}, in any of their roles and under any job title.`,
    criteria: {
      true: `The CV shows them regularly doing the main tasks of ${area} themselves, even if it was part of a role with a different title.`,
      false: `The CV shows only related or adjacent work, or mentions ${area} only in passing.`,
    },
  }
}

export const skillsMatchQuestion = {
  type: 'score',
  instructions: 'How closely does the experience in `candidate` match the work the role in `job.description` actually involves day to day?',
  criteria: [
    "Little overlap: the core work of the role is outside the candidate's experience.",
    'Some overlap: a few relevant skills, but most of the core work would be new to the candidate.',
    'Partial: about half of the core work matches work the candidate has done.',
    'Strong: most of the core work matches work the candidate has done, with minor gaps.',
    'Near-complete: the candidate has done essentially this job before.',
  ],
} as const satisfies ScoreQuestion

const SENIORITY_CRITERIA = {
  well_below: "The role is two or more levels below the candidate's current level.",
  below: 'The role is one level below.',
  match: 'The role is at about the same level.',
  above: 'The role is one level above.',
  well_above: 'The role is two or more levels above.',
} as const

export type SeniorityOption = keyof typeof SENIORITY_CRITERIA

/** Spec order by default; `reversed` exists for the order-bias check (spec §4.2 "Before launch"). */
export function seniorityFitQuestion(reversed = false): ChoiceQuestion<Record<SeniorityOption, string>> {
  const entries = Object.entries(SENIORITY_CRITERIA)
  return {
    type: 'choice',
    instructions: 'How does the seniority of the role in `job` compare with the most recent level shown in `candidate`?',
    criteria: Object.fromEntries(reversed ? [...entries].reverse() : entries) as Record<SeniorityOption, string>,
  }
}

export const domainFitQuestion = {
  type: 'score',
  instructions: 'How familiar is `candidate` with the industry and domain of the role in `job` (the company\'s market, products and customers)?',
  criteria: [
    'Unfamiliar industry and domain.',
    'Adjacent: a related industry or transferable domain.',
    'Same broad industry, different segment.',
    'Same industry and domain.',
  ],
} as const satisfies ScoreQuestion

export const sponsorshipQuestion = {
  type: 'choice',
  instructions: 'What does `job.description` say about visa sponsorship or the right to work?',
  criteria: {
    offered: 'The description says visa sponsorship or work-permit support is available.',
    not_offered: 'The description says visa sponsorship is not available.',
    right_to_work_required: 'The description says candidates must already have the right to work in the country.',
    not_mentioned: 'The description says nothing about sponsorship, visas or the right to work.',
  },
} as const satisfies ChoiceQuestion

export const directionFitQuestion = {
  type: 'score',
  instructions: 'How well does the role in `job` fit the direction in `preferences` (target roles, career goals, career-change context)?',
  criteria: [
    'The role moves away from the stated direction.',
    'The role is neutral: neither towards nor away from the stated direction.',
    'The role is adjacent to a target role or goal.',
    'The role is a target role or directly serves a stated goal.',
  ],
} as const satisfies ScoreQuestion

export const remoteMatchQuestion = {
  type: 'noul',
  instructions: 'The working pattern of the role in `job` (onsite, hybrid or remote) fits `preferences.remotePreference`.',
} as const satisfies NoulQuestion

export function dealbreakerQuestion(dealbreaker: string): NoulQuestion {
  return {
    type: 'noul',
    instructions: `The role in \`job\` involves this: "${dealbreaker}"`,
    criteria: {
      true: 'The description states or clearly implies it.',
      false: 'The description does not mention it, and nothing in it implies it.',
    },
  }
}

export interface JudgeQuestionInput {
  facts: Pick<JobFacts, 'requirements'>
  /** Role keys from buildCandidateState's timeline (`role_1` …). */
  roleKeys: readonly string[]
  /** From buildJudgePreferences; decides direction_fit / remote_match. */
  preferences: JudgePreferences | null
  /** eligibility.dealbreakers */
  dealbreakers: readonly string[]
}

/** The full judge question set, in one request over one state (spec §4.2). */
export function buildJudgeQuestions(input: JudgeQuestionInput): Questions {
  const q: Questions = {}

  input.facts.requirements.forEach((req, i) => {
    switch (requirementMode(req)) {
      case 'skip':
        return
      case 'years': {
        const area = req.years!.area
        for (const roleKey of input.roleKeys) {
          q[questionIds.share(i, roleKey, 'a')] = shareQuestion(roleKey, area, 'a')
          q[questionIds.share(i, roleKey, 'b')] = shareQuestion(roleKey, area, 'b')
        }
        q[questionIds.capability(i)] = capabilityQuestion(area)
        return
      }
      case 'parts':
        req.parts!.forEach((part, n) => {
          q[questionIds.part(i, n)] = partQuestion(part)
        })
        return
      case 'single':
        q[questionIds.requirement(i)] = requirementQuestion(req.text)
        return
    }
  })

  q[questionIds.skillsMatch] = skillsMatchQuestion
  q[questionIds.seniorityFit] = seniorityFitQuestion()
  q[questionIds.domainFit] = domainFitQuestion
  q[questionIds.sponsorship] = sponsorshipQuestion

  if (asksDirection(input.preferences)) q[questionIds.directionFit] = directionFitQuestion
  if (asksRemote(input.preferences)) q[questionIds.remoteMatch] = remoteMatchQuestion

  input.dealbreakers.forEach((d, i) => {
    q[questionIds.dealbreaker(i)] = dealbreakerQuestion(d)
  })

  return q
}
