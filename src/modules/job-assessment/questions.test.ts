import { describe, expect, it } from 'vitest'
import { emptySearchProfile } from '@/modules/search-profile/schema'
import type { CandidateState } from './candidate-state'
import {
  asksDirection,
  asksRemote,
  buildJudgePreferences,
  buildJudgeQuestions,
  buildJudgeState,
  buildVerifyQuestions,
  buildVerifyState,
  isWorkRightsRequirement,
  requirementMode,
  MAX_SHARE_QUESTIONS,
  seniorityFitQuestion,
  shareRoleLimit,
  type JudgePreferences,
} from './questions'
import type { JobRequirement } from './schema'

function req(text: string, overrides: Partial<JobRequirement> = {}): JobRequirement {
  return { text, kind: 'skill', importance: 'must', years: null, parts: null, ...overrides }
}

const ROLE_KEYS = ['role_1', 'role_2', 'role_3']

const REQUIREMENTS: JobRequirement[] = [
  req('BSc in Computer Science or related field', { kind: 'education' }),
  req('5+ years in business operations or chief of staff roles', { kind: 'experience', years: { min: 5, area: 'business operations or chief of staff roles' } }),
  req('Hands-on across brand/PR, partnerships and community', { kind: 'experience', parts: ['brand/PR', 'partnerships', 'community'] }),
  req('Availability to travel 30% of the time', { kind: 'availability' }),
  req('Experience with Looker', { importance: 'nice' }),
]

const build = (preferences: JudgePreferences | null = null, dealbreakers: string[] = []) =>
  buildJudgeQuestions({ facts: { requirements: REQUIREMENTS }, roleKeys: ROLE_KEYS, preferences, dealbreakers })

const candidate: CandidateState = { summary: 's', roles: {}, education: [], certifications: [], languages: [], skills: {} }

describe('buildJudgeQuestions', () => {
  it('asks one question per plain requirement, parts per part, years per role and order, and skips availability', () => {
    const ids = Object.keys(build())
    expect(ids).toEqual([
      'req_0',
      'req_1_role_1_a', 'req_1_role_1_b', 'req_1_role_2_a', 'req_1_role_2_b', 'req_1_role_3_a', 'req_1_role_3_b',
      'req_1_capability',
      'req_2_part_0', 'req_2_part_1', 'req_2_part_2',
      'req_4',
      'skills_match', 'seniority_fit', 'domain_fit', 'sponsorship',
    ])
    expect(ids.some((id) => id.startsWith('req_3'))).toBe(false)
  })

  it('asks no direction_fit or remote_match without preferences', () => {
    const q = build()
    expect(q.direction_fit).toBeUndefined()
    expect(q.remote_match).toBeUndefined()
  })

  it('asks direction_fit only with target roles, goals or career-change context', () => {
    expect(build({ targetRoles: ['Program manager'] }).direction_fit).toBeDefined()
    expect(build({ careerGoals: 'Lead programs' }).direction_fit).toBeDefined()
    expect(build({ careerChangeContext: 'Moving from PR' }).direction_fit).toBeDefined()
    expect(build({ remotePreference: 'Fully remote' }).direction_fit).toBeUndefined()
  })

  it('asks remote_match only with a remote preference', () => {
    expect(build({ remotePreference: 'Fully remote' }).remote_match).toBeDefined()
    expect(build({ careerGoals: 'x' }).remote_match).toBeUndefined()
  })

  it('asks one dealbreaker question per dealbreaker', () => {
    const q = build(null, ['Fixed-term contract', 'Regular weekend on-call'])
    expect(q.dealbreaker_0).toEqual({
      type: 'noul',
      instructions: 'The role in `job` involves this: "Fixed-term contract"',
      criteria: {
        true: 'The description states or clearly implies it.',
        false: 'The description does not mention it, and nothing in it implies it.',
      },
    })
    expect(q.dealbreaker_1).toBeDefined()
    expect(q.dealbreaker_2).toBeUndefined()
  })

  it('gives years requirements years questions even when they also have parts', () => {
    const q = buildJudgeQuestions({
      facts: { requirements: [req('5+ years in A and B', { years: { min: 5, area: 'A and B' }, parts: ['A', 'B'] })] },
      roleKeys: ['role_1'], preferences: null, dealbreakers: [],
    })
    expect(Object.keys(q).filter((id) => id.startsWith('req_'))).toEqual(['req_0_role_1_a', 'req_0_role_1_b', 'req_0_capability'])
  })

  it('reverses the share options in order b', () => {
    const q = build()
    const a = q.req_1_role_2_a
    const b = q.req_1_role_2_b
    if (a.type !== 'choice' || b.type !== 'choice') throw new Error('expected choice')
    expect(Object.keys(a.criteria)).toEqual(['most_of_the_role', 'about_half', 'small_part', 'none'])
    expect(Object.keys(b.criteria)).toEqual(['none', 'small_part', 'about_half', 'most_of_the_role'])
    expect(b.instructions).toBe(a.instructions)
    expect(b.criteria).toEqual(a.criteria)
  })
})

describe('question wording (spec §4)', () => {
  const q = build({ targetRoles: ['x'], remotePreference: 'Fully remote' })

  it('requirement', () => {
    expect(q.req_0).toEqual({
      type: 'noul',
      instructions: 'The candidate described in `candidate` meets this job requirement: "BSc in Computer Science or related field"',
      criteria: {
        true: 'The profile shows the requirement is met, directly or through an alternative the requirement itself allows (e.g. "or equivalent experience", "or related field", "or similar").',
        false: 'The profile does not show it, shows only a lower level (e.g. a diploma where a degree is required, fewer years than stated), or shows it only partially.',
      },
    })
  })

  it('requirement part', () => {
    expect(q.req_2_part_1).toEqual({
      type: 'noul',
      instructions: 'The candidate described in `candidate` has hands-on experience with partnerships.',
      criteria: {
        true: 'The profile shows the candidate doing partnerships themselves as part of a role.',
        false: 'The profile does not show the candidate doing partnerships, or only mentions it in passing.',
      },
    })
  })

  it('years share', () => {
    expect(q.req_1_role_3_a).toEqual({
      type: 'choice',
      instructions: 'How much of the role `candidate.roles.role_3` was spent doing this kind of work: business operations or chief of staff roles?',
      criteria: {
        most_of_the_role: 'This work was the main focus of the role, most of the time.',
        about_half: 'This work was a regular, major part of the role, roughly half of it.',
        small_part: 'This work came up occasionally or was a minor part of the role.',
        none: 'The role did not involve this work.',
      },
    })
  })

  it('years capability', () => {
    expect(q.req_1_capability).toEqual({
      type: 'noul',
      instructions: 'The person in `candidate` has done the core work of business operations or chief of staff roles, in any of their roles and under any job title.',
      criteria: {
        true: 'The CV shows them regularly doing the main tasks of business operations or chief of staff roles themselves, even if it was part of a role with a different title.',
        false: 'The CV shows only related or adjacent work, or mentions business operations or chief of staff roles only in passing.',
      },
    })
  })

  it('rubrics', () => {
    expect(q.skills_match).toEqual({
      type: 'score',
      instructions: 'How closely does the experience in `candidate` match the work the role in `job.description` actually involves day to day?',
      criteria: [
        "Little overlap: the core work of the role is outside the candidate's experience.",
        'Some overlap: a few relevant skills, but most of the core work would be new to the candidate.',
        'Partial: about half of the core work matches work the candidate has done.',
        'Strong: most of the core work matches work the candidate has done, with minor gaps.',
        'Near-complete: the candidate has done essentially this job before.',
      ],
    })
    expect(q.seniority_fit).toEqual({
      type: 'choice',
      instructions: 'How does the seniority of the role in `job` compare with the most recent level shown in `candidate`?',
      criteria: {
        well_below: "The role is two or more levels below the candidate's current level.",
        below: 'The role is one level below.',
        match: 'The role is at about the same level.',
        above: 'The role is one level above.',
        well_above: 'The role is two or more levels above.',
      },
    })
    expect(q.domain_fit).toEqual({
      type: 'score',
      instructions: "How familiar is `candidate` with the industry and domain of the role in `job` (the company's market, products and customers)?",
      criteria: ['Unfamiliar industry and domain.', 'Adjacent: a related industry or transferable domain.', 'Same broad industry, different segment.', 'Same industry and domain.'],
    })
    expect(q.sponsorship).toEqual({
      type: 'choice',
      instructions: 'What does `job.description` say about visa sponsorship or the right to work?',
      criteria: {
        offered: 'The description says visa sponsorship or work-permit support is available.',
        not_offered: 'The description says visa sponsorship is not available.',
        right_to_work_required: 'The description says candidates must already have the right to work in the country.',
        not_mentioned: 'The description says nothing about sponsorship, visas or the right to work.',
      },
    })
  })

  it('conditional questions', () => {
    expect(q.direction_fit).toEqual({
      type: 'score',
      instructions: 'How well does the role in `job` fit the direction in `preferences` (target roles, career goals, career-change context)?',
      criteria: [
        'The role moves away from the stated direction.',
        'The role is neutral: neither towards nor away from the stated direction.',
        'The role is adjacent to a target role or goal.',
        'The role is a target role or directly serves a stated goal.',
      ],
    })
    expect(q.remote_match).toEqual({
      type: 'noul',
      instructions: 'The working pattern of the role in `job` (onsite, hybrid or remote) fits `preferences.remotePreference`.',
    })
  })

  it('seniority reversed for the order-bias check', () => {
    expect(Object.keys(seniorityFitQuestion(true).criteria)).toEqual(['well_above', 'above', 'match', 'below', 'well_below'])
  })
})

describe('verify', () => {
  it('state is the trimmed description only', () => {
    expect(buildVerifyState({ description: '  text  ' })).toEqual({ description: 'text' })
  })

  it('asks the three spec nouls', () => {
    expect(buildVerifyQuestions()).toEqual({
      is_full_description: {
        type: 'noul',
        instructions: '`description` is a complete job posting for a single role.',
        criteria: {
          true: 'It describes what the role involves and what is expected of candidates, in enough detail to judge fit.',
          false: 'It is a teaser, a truncated preview, a list of several jobs, a login/cookie/error page, or too short to judge fit.',
        },
      },
      has_requirements: { type: 'noul', instructions: '`description` lists requirements, qualifications or experience expected of candidates.' },
      has_responsibilities: { type: 'noul', instructions: '`description` describes the responsibilities or day-to-day work of the role.' },
    })
  })
})

describe('preferences and judge state', () => {
  it('picks only non-empty preference fields, with a descriptive remote preference', () => {
    expect(buildJudgePreferences(emptySearchProfile)).toBeNull()
    expect(buildJudgePreferences({ ...emptySearchProfile, roles: [' Program manager ', ''], careerGoals: ' Lead ', remotePreference: 'hybrid' })).toEqual({
      targetRoles: ['Program manager'],
      careerGoals: 'Lead',
      remotePreference: 'Hybrid: some days in an office, some remote',
    })
    expect(buildJudgePreferences({ ...emptySearchProfile, pivotContext: 'From PR' })).toEqual({ careerChangeContext: 'From PR' })
  })

  it('does not ask remote_match for a flexible preference', () => {
    const prefs = buildJudgePreferences({ ...emptySearchProfile, remotePreference: 'flexible' })
    expect(prefs).toBeNull()
    expect(asksRemote(prefs)).toBe(false)
    expect(asksDirection(prefs)).toBe(false)
  })

  it('includes preferences in the state only when a conditional question is asked', () => {
    const job = { title: ' T ', company: 'C', description: 'D' }
    expect(buildJudgeState({ candidate, job })).toEqual({ candidate, job: { title: 'T', company: 'C', description: 'D' } })
    expect(buildJudgeState({ candidate, job, preferences: {} })).not.toHaveProperty('preferences')
    expect(buildJudgeState({ candidate, job, preferences: { careerGoals: 'x' } }).preferences).toEqual({ careerGoals: 'x' })
  })
})

describe('shareRoleLimit', () => {
  const years = (n: number) => ({
    requirements: Array.from({ length: n }, () => ({
      text: 'x', kind: 'experience' as const, importance: 'must' as const, years: { min: 3, area: 'x' }, parts: null,
    })),
  })

  it('keeps every role when the total stays under the cap', () => {
    expect(shareRoleLimit(years(4), 8)).toBe(8) // 64 questions
    expect(shareRoleLimit({ requirements: [] }, 30)).toBe(30)
  })

  it('keeps only the newest roles that fit under MAX_SHARE_QUESTIONS', () => {
    const limit = shareRoleLimit(years(8), 15) // 15 roles × 16 = 240 > 160
    expect(limit).toBe(10)
    expect(limit * 2 * 8).toBeLessThanOrEqual(MAX_SHARE_QUESTIONS)
  })

  it('bounds the built question set', () => {
    const facts = years(8)
    const roleKeys = Array.from({ length: 15 }, (_, i) => `role_${i + 1}`).slice(0, shareRoleLimit(facts, 15))
    const q = buildJudgeQuestions({ facts, roleKeys, preferences: null, dealbreakers: [] })
    const shares = Object.keys(q).filter((id) => /_role_\d+_[ab]$/.test(id))
    expect(shares.length).toBeLessThanOrEqual(MAX_SHARE_QUESTIONS)
    expect(shares.some((id) => id.includes('role_11_'))).toBe(false)
  })
})

describe('work rights requirements', () => {
  it.each([
    'Candidates must have the correct visa to live and work in Ireland; no sponsorship available',
    'Only candidates with the right to work in their location will be considered',
    'Right-to-work in the UK is required',
    'Valid work permit required',
    'Visa sponsorship is not available for this role',
    'Sponsorship is not offered',
    'We cannot sponsor candidates who need sponsorship',
    'Must be authorised to work in the EU',
    'Must be authorized to work in the US',
    'Eligible to work in Canada',
    'Must hold a valid visa',
  ])('is skipped: %s', (text) => {
    expect(isWorkRightsRequirement(text)).toBe(true)
    expect(requirementMode(req(text, { kind: 'clearance' }))).toBe('skip')
  })

  it.each([
    'Experience with immigration and visa case management',
    'Experience working with visa processing teams',
    'Sponsor-level stakeholder management',
    'Own the executive sponsorship program for key accounts',
    'Requires executive sponsorship for cross-functional programs',
    'Security clearance (SC level)',
  ])('is still asked: %s', (text) => {
    expect(isWorkRightsRequirement(text)).toBe(false)
    expect(requirementMode(req(text))).toBe('single')
  })

  it.each([
    'Full Australian working rights required',
    'Sponsorship is not available',
    'Sponsorship is unavailable for this position',
    'We are unable to provide visa sponsorship',
    'Unable to offer sponsorship',
    'Must hold a valid Skilled Worker visa',
    'EU citizenship required',
    'Must be a citizen of Canada',
    'Permanent residency required',
    'Permanent resident of the US',
    'Must hold a green card',
    'Passport holder of an EU country',
  ])('also matches: %s', (text) => {
    expect(isWorkRightsRequirement(text)).toBe(true)
    expect(requirementMode(req(text, { kind: 'education' }))).toBe('skip')
  })

  it.each([
    ['Experience managing work permit and visa applications', 'experience'],
    ['Knowledge of UK right to work checks', 'experience'],
    ['Experience with work authorization compliance (I-9)', 'experience'],
    ['Knowledge of hot work permits and lockout/tagout procedures', 'skill'],
    ['Experience securing corporate sponsorship is essential', 'experience'],
  ] as const)('only credential kinds are skipped: %s (%s)', (text, kind) => {
    expect(requirementMode(req(text, { kind }))).toBe('single')
  })

  it('does not match "piano sponsorship"', () => {
    expect(isWorkRightsRequirement('Played piano sponsorship')).toBe(false)
  })

  it('never skips a language requirement', () => {
    expect(requirementMode(req('Fluent German; must be eligible to work in Germany', { kind: 'language' }))).toBe('single')
  })
})
