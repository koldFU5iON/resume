/**
 * Fixtures are anonymised and shaped like the spec §6 round-3 signals: answer
 * objects are synthesised to match the reported values, never fetched live.
 */
import { describe, expect, it } from 'vitest'
import { emptyEligibility, type Eligibility } from '@/modules/search-profile/schema'
import type { RoleTimelineEntry } from './candidate-state'
import {
  MissingAnswerError,
  combineAssessment,
  computeScore,
  displayLabel,
  levelForScore,
  senioritySignal,
  type CombineInput,
  type JevAnswer,
  type JudgeAnswers,
} from './combine'
import type { JobFacts, JobRequirement } from './schema'

const TODAY = new Date('2026-11-10T12:00:00Z')

// ── Answer builders ─────────────────────────────────────────────────────────

const n = (p: number): JevAnswer => ({ type: 'noul', noul: p })

function ch(probabilities: Record<string, number>): JevAnswer {
  const [top, conf] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]
  return { type: 'choice', choice: top, confidence: conf, probabilities }
}

// Built untyped, then cast: contextually typing `legend` against the SDK's recursive ScoreLegend is too deep for tsc.
const sc = (score: number): JevAnswer => {
  const answer = { type: 'score', score, confidence: 0.8, legend: {}, probabilities: {} }
  return answer as unknown as JevAnswer
}

type Share = 'most' | 'half' | 'two_thirds' | 'small' | 'none'
const SHARE_PROBS: Record<Share, Record<string, number>> = {
  most: { most_of_the_role: 1, about_half: 0, small_part: 0, none: 0 },
  half: { most_of_the_role: 0, about_half: 1, small_part: 0, none: 0 },
  two_thirds: { most_of_the_role: 1 / 3, about_half: 2 / 3, small_part: 0, none: 0 }, // share 2/3
  small: { most_of_the_role: 0, about_half: 0, small_part: 1, none: 0 },
  none: { most_of_the_role: 0, about_half: 0, small_part: 0, none: 1 },
}

function shares(i: number, byRole: Record<string, Share>): Record<string, JevAnswer> {
  const out: Record<string, JevAnswer> = {}
  for (const [key, s] of Object.entries(byRole)) {
    out[`req_${i}_${key}_a`] = ch(SHARE_PROBS[s])
    out[`req_${i}_${key}_b`] = ch(SHARE_PROBS[s])
  }
  return out
}

// ── Base fixture: round-3 example 5 (business manager, GTM; remote anywhere) ─

function role(key: string, label: string, start: [number, number], end: [number, number] | 'present'): RoleTimelineEntry {
  return { key, label, start: { y: start[0], m: start[1] }, end: end === 'present' ? 'present' : { y: end[0], m: end[1] } }
}

const TIMELINE: RoleTimelineEntry[] = [
  role('role_1', 'Senior Program Manager', [2024, 8], 'present'),   // 28 months
  role('role_2', 'Communications Lead', [2023, 11], [2024, 7]),     // 9 months
  role('role_3', 'International PR Manager', [2022, 6], [2023, 10]), // 17 months
  role('role_4', 'PR Officer', [2015, 1], [2022, 5]),
]

const r = (text: string, o: Partial<JobRequirement> = {}): JobRequirement =>
  ({ text, kind: 'experience', importance: 'must', years: null, parts: null, ...o })

const BASE_FACTS: JobFacts = {
  requirements: [
    r('5–8 years in business operations, chief of staff, strategy consulting or similar', {
      years: { min: 5, area: 'business operations, chief of staff, strategy consulting or similar' },
    }),
    r('Cross-functional program leadership'),
    r('Stakeholder management with senior leaders', { kind: 'skill' }),
    r("Bachelor's degree", { kind: 'education', importance: 'nice' }),
    r('Willing to travel', { kind: 'availability' }),
  ],
  location: { countries: [], mode: 'remote_anywhere', basedInRequired: false, remoteRegions: [] },
  salary: null,
  seniority: 'senior',
  employmentType: 'permanent',
}

const BASE_ANSWERS: Record<string, JevAnswer> = {
  ...shares(0, { role_1: 'most', role_2: 'most', role_3: 'half', role_4: 'small' }),
  req_0_capability: n(0.9),
  req_1: n(0.92),
  req_2: n(0.81),
  req_3: n(0.95),
  skills_match: sc(2.4),
  seniority_fit: ch({ well_below: 0, below: 0, match: 0.8, above: 0.2, well_above: 0 }),
  domain_fit: sc(2),
  sponsorship: ch({ offered: 0.02, not_offered: 0.02, right_to_work_required: 0.02, not_mentioned: 0.94 }),
}

// EU (non-Irish) citizen living in FR; EUR floor 90k (target 100k), GBP floor 85k.
const BASE_ELIGIBILITY: Eligibility = {
  ...emptyEligibility,
  currentCountry: 'FR',
  citizenships: ['ES'],
  salaryFloors: [
    { currency: 'EUR', floor: 90000, target: 100000 },
    { currency: 'GBP', floor: 85000, target: null },
  ],
}

function run(o: {
  facts?: Partial<JobFacts>
  answers?: Record<string, JevAnswer | undefined>
  eligibility?: Partial<Eligibility>
  targets?: string[]
} = {}) {
  const input: CombineInput = {
    facts: { ...BASE_FACTS, ...o.facts },
    answers: { ...BASE_ANSWERS, ...o.answers } as JudgeAnswers,
    timeline: TIMELINE,
    eligibility: { ...BASE_ELIGIBILITY, ...o.eligibility },
    searchProfile: { countries: o.targets ?? [] },
    today: TODAY,
  }
  return combineAssessment(input)
}

const severities = (res: ReturnType<typeof run>, kind: string) => res.blockers.filter((b) => b.kind === kind).map((b) => b.severity)

// ── Tests ───────────────────────────────────────────────────────────────────

describe('example 5: years warning → pursue 7', () => {
  const res = run()

  it('estimates years from the two latest roles plus half of the third', () => {
    expect(res.years).toHaveLength(1)
    const y = res.years[0]
    expect(y.estimate).toBeCloseTo(28 / 12 + 9 / 12 + 0.5 * 17 / 12)
    expect(y.status).toBe('warn')
    expect(y.summary).toBe('~3.8 yrs: Senior Program Manager 2.3 + Communications Lead 0.8 + International PR Manager 50% × 1.4')
    expect(y.roles.find((x) => x.key === 'role_4')).toMatchObject({ counted: false, years: 0 })
  })

  it('scores pursue 7 with one amber years warning and no hard blocker', () => {
    expect(res.blockers).toEqual([
      expect.objectContaining({ kind: 'years', severity: 'warn', label: 'Short on years (~3.8 of 5): business operations, chief of staff, strategy consulting or similar' }),
    ])
    expect(res.blocked).toBe(false)
    const coverage = (2 * (3.7917 / 5) + 2 * 0.92 + 2 * 0.81 + 0.95) / 7
    expect(res.breakdown.coverage).toBeCloseTo(coverage, 3)
    expect(res.breakdown.penaltyItems).toBe(1)
    expect(res.breakdown.penalty).toBe(0.5)
    expect(res.score).toBe(7)
    expect(res.level).toBe('pursue')
    expect(displayLabel(res)).toBe('pursue · 7/10')
  })

  it('lists met must-haves as strengths and skips availability', () => {
    expect(res.strengths).toEqual(['Cross-functional program leadership', 'Stakeholder management with senior leaders'])
    expect(res.gaps).toEqual([])
    expect(res.unsettled).toEqual([])
    expect(res.notes).toEqual([])
  })
})

describe('blockers table', () => {
  describe('credential must-have', () => {
    const facts = { requirements: [...BASE_FACTS.requirements.slice(0, 3), r('BSc in Computer Science', { kind: 'education' })] }

    it('blocks below 0.3', () => {
      const res = run({ facts, answers: { req_3: n(0.06) } })
      expect(res.blockers[0]).toMatchObject({ kind: 'credential', severity: 'hard', label: 'Missing requirement: BSc in Computer Science' })
      expect(res.blocked).toBe(true)
      expect(displayLabel(res)).toBe(`Blocked · ${res.score}/10`)
    })

    it('is met with an allowed equivalent at 0.73', () => {
      const res = run({ facts, answers: { req_3: n(0.73) } })
      expect(res.blocked).toBe(false)
      expect(res.strengths).toContain('BSc in Computer Science')
    })

    it('is unsettled between 0.3 and 0.7', () => {
      const res = run({ facts, answers: { req_3: n(0.45) } })
      expect(res.blocked).toBe(false)
      expect(res.unsettled).toEqual(['BSc in Computer Science'])
    })

    it('never blocks as a nice-to-have', () => {
      const res = run({ answers: { req_3: n(0.02) } })
      expect(res.blocked).toBe(false)
      expect(res.breakdown.coverage).toBeLessThan(run().breakdown.coverage!)
    })
  })

  describe('years must-have (example 12 shape: 5+ yrs, ~2.0 estimated)', () => {
    // Latest two roles at about two-thirds each (37 months × 2/3 ≈ 2.06 yrs); the rest below half.
    const answers = { ...shares(0, { role_1: 'two_thirds', role_2: 'two_thirds', role_3: 'small', role_4: 'none' }) }

    it('blocks with capability 0.69', () => {
      const res = run({ answers: { ...answers, req_0_capability: n(0.69) } })
      expect(res.years[0].status).toBe('block')
      expect(severities(res, 'years')).toEqual(['hard'])
      expect(res.blocked).toBe(true)
      expect(res.breakdown.penaltyItems).toBe(0)
    })

    it('becomes a stretch with capability 0.70', () => {
      const res = run({ answers: { ...answers, req_0_capability: n(0.7) } })
      expect(res.years[0].status).toBe('stretch')
      expect(res.blocked).toBe(false)
      expect(res.blockers[0]).toMatchObject({
        kind: 'years', severity: 'stretch',
        label: 'Short on years (~2.1 of 5) — strong transferable experience across your CV',
      })
      expect(res.breakdown.penaltyItems).toBe(1)
    })

    it('stays block when capability is missing', () => {
      const res = run({ answers: { ...answers, req_0_capability: undefined } })
      expect(res.years[0]).toMatchObject({ status: 'block', capability: null })
    })

    it('shows met years as a strength with the estimate', () => {
      const res = run({ facts: { requirements: [r('3+ years in program management', { years: { min: 3, area: 'program management' } })] } })
      expect(res.years[0].status).toBe('met')
      expect(res.strengths).toEqual(['3+ years in program management (~3.8 yrs)'])
      expect(res.blockers).toEqual([])
    })

    it('never flags a nice-to-have years requirement but counts it in coverage', () => {
      const facts = { requirements: [r('10+ years in X', { importance: 'nice', years: { min: 10, area: 'X' } }), ...BASE_FACTS.requirements.slice(1)] }
      const res = run({ facts, answers: { req_0_capability: n(0.1) } })
      expect(res.blockers).toEqual([])
      expect(res.years[0].status).toBe('block')
    })
  })

  describe('other experience or skill must-have', () => {
    it('is a major gap below 0.3: red, −0.5, no block', () => {
      const res = run({ answers: { req_1: n(0.2) } })
      expect(res.gaps).toEqual(['Cross-functional program leadership'])
      expect(res.blocked).toBe(false)
      expect(res.breakdown.penaltyItems).toBe(2) // + the years warning
    })

    it('is unsettled between 0.3 and 0.7', () => {
      expect(run({ answers: { req_2: n(0.3) } }).unsettled).toEqual(['Stakeholder management with senior leaders'])
      expect(run({ answers: { req_2: n(0.69) } }).unsettled).toEqual(['Stakeholder management with senior leaders'])
    })

    it('ignores a weak nice-to-have skill except in coverage', () => {
      const facts = { requirements: [...BASE_FACTS.requirements, r('Looker', { kind: 'skill', importance: 'nice' })] }
      const res = run({ facts, answers: { req_5: n(0.05) } })
      expect(res.gaps).toEqual([])
    })
  })

  describe('work rights (EU citizen, GB role)', () => {
    const facts = { location: { countries: ['GB'], mode: 'onsite' as const, basedInRequired: true, remoteRegions: [] } }
    const targets = ['GB'] // so relocation stays quiet
    const sponsor = (s: string) => ({ sponsorship: ch({ offered: 0, not_offered: 0, right_to_work_required: 0, not_mentioned: 0, [s]: 1 }) })

    it.each(['not_offered', 'right_to_work_required'])('blocks when the description says %s', (s) => {
      const res = run({ facts, targets, answers: sponsor(s) })
      expect(res.blockers[0]).toMatchObject({ kind: 'work_rights', severity: 'hard', label: 'Needs sponsorship for United Kingdom' })
      expect(res.blocked).toBe(true)
    })

    it('is unconfirmed when sponsorship is not mentioned', () => {
      const res = run({ facts, targets, answers: sponsor('not_mentioned') })
      expect(severities(res, 'work_rights')).toEqual(['unconfirmed'])
      expect(res.blocked).toBe(false)
    })

    it('is clear when sponsorship is offered, or for an Irish citizen', () => {
      expect(severities(run({ facts, targets, answers: sponsor('offered') }), 'work_rights')).toEqual([])
      expect(severities(run({ facts, targets, answers: sponsor('not_offered'), eligibility: { citizenships: ['IE'] } }), 'work_rights')).toEqual([])
    })

    it('example 6: US remote role, nothing said → amber, not blocked', () => {
      const res = run({ facts: { location: { countries: ['US'], mode: 'remote_in_country', basedInRequired: true, remoteRegions: [] } }, targets: ['US'] })
      expect(res.blockers).toContainEqual(expect.objectContaining({ kind: 'work_rights', severity: 'unconfirmed', label: 'Needs sponsorship for United States — not confirmed' }))
      expect(res.blocked).toBe(false)
    })

    it('skips the check and notes it when the location is unknown', () => {
      const res = run({ facts: { location: { countries: [], mode: 'unknown', basedInRequired: false, remoteRegions: [] } } })
      expect(res.blockers.filter((b) => b.kind !== 'years')).toEqual([])
      expect(res.notes).toContain('Location unknown: work rights and relocation not checked')
    })

    it('notes missing work rights in the eligibility profile', () => {
      const res = run({ facts, targets, eligibility: { citizenships: [], visas: [] } })
      expect(res.notes).toContain('Add your citizenships or visas to check work rights')
    })
  })

  describe('relocation', () => {
    const facts = { location: { countries: ['IE'], mode: 'remote_in_country' as const, basedInRequired: true, remoteRegions: [] } }

    it('is unconfirmed when based-in is required elsewhere and not a target', () => {
      const res = run({ facts })
      expect(res.blockers).toContainEqual({
        kind: 'relocation', severity: 'unconfirmed', label: 'Must be based in Ireland',
        detail: "You live in France, and it isn't one of your target countries.",
      })
      expect(res.blocked).toBe(false)
    })

    it('is clear when the country is a target', () => {
      expect(severities(run({ facts, targets: ['Ireland'] }), 'relocation')).toEqual([])
    })
  })

  describe('pay (EUR floor 90k, target 100k)', () => {
    const salary = (min: number | null, max: number | null, currency = 'EUR') => ({ salary: { min, max, currency, period: 'year' as const } })

    it('blocks when the stated max is below the floor', () => {
      const res = run({ facts: salary(70000, 80000) })
      expect(res.blockers[0]).toMatchObject({ kind: 'pay', severity: 'hard', detail: 'EUR 70,000–80,000 vs your floor of EUR 90,000.' })
      expect(res.blocked).toBe(true)
    })

    it('is unconfirmed when the range straddles the floor (example 3: €78k–129.8k)', () => {
      expect(severities(run({ facts: salary(78000, 129800) }), 'pay')).toEqual(['unconfirmed'])
    })

    it('subtracts 0.05 from the composite when max is below target', () => {
      const ok = run({ facts: salary(95000, 120000) })
      const below = run({ facts: salary(95000, 99000) })
      expect(severities(below, 'pay')).toEqual([])
      expect(below.breakdown.belowTargetPay).toBe(true)
      expect(ok.breakdown.composite - below.breakdown.composite).toBeCloseTo(0.05)
    })

    it('ignores a currency with no floor', () => {
      expect(severities(run({ facts: salary(10000, 20000, 'USD') }), 'pay')).toEqual([])
    })
  })

  describe('dealbreakers', () => {
    const eligibility = { dealbreakers: ['Fixed-term contract'] }

    it('is hard above 0.7, unconfirmed from 0.3 to 0.7, clear below', () => {
      expect(severities(run({ eligibility, answers: { dealbreaker_0: n(0.99) } }), 'dealbreaker')).toEqual(['hard'])
      expect(severities(run({ eligibility, answers: { dealbreaker_0: n(0.7) } }), 'dealbreaker')).toEqual(['unconfirmed'])
      expect(severities(run({ eligibility, answers: { dealbreaker_0: n(0.3) } }), 'dealbreaker')).toEqual(['unconfirmed'])
      expect(severities(run({ eligibility, answers: { dealbreaker_0: n(0.29) } }), 'dealbreaker')).toEqual([])
    })

    it('labels the dealbreaker', () => {
      expect(run({ eligibility, answers: { dealbreaker_0: n(0.99) } }).blockers[0].label).toBe('Dealbreaker: Fixed-term contract')
    })
  })

  it('orders blockers hard → unconfirmed → stretch → warn', () => {
    const res = run({
      facts: { location: { countries: ['IE'], mode: 'onsite', basedInRequired: true, remoteRegions: [] }, salary: { min: 50000, max: 60000, currency: 'EUR', period: 'year' } },
      eligibility: { dealbreakers: ['Weekend on-call'] },
      answers: { dealbreaker_0: n(0.5) },
    })
    expect(res.blockers.map((b) => b.severity)).toEqual(['hard', 'unconfirmed', 'unconfirmed', 'warn'])
  })
})

describe('parts', () => {
  const facts = {
    requirements: [
      r('Hands-on across performance marketing, influencers, community, partnerships and brand/PR', {
        parts: ['performance marketing', 'influencers', 'community', 'partnerships', 'brand/PR'],
      }),
      r('Analytics: attribution, incrementality, cohorts, LTV', { kind: 'skill', parts: ['attribution', 'incrementality', 'cohorts', 'LTV'] }),
    ],
  }
  // Example 11 values.
  const answers = {
    req_0_part_0: n(0.16), req_0_part_1: n(0.44), req_0_part_2: n(0.38), req_0_part_3: n(0.5), req_0_part_4: n(0.96),
    req_1_part_0: n(0.22), req_1_part_1: n(0.08), req_1_part_2: n(0.12), req_1_part_3: n(0.1),
  }

  it('takes the mean: 0.49 is unsettled, 0.13 is a major gap', () => {
    const res = run({ facts, answers })
    expect(res.unsettled).toEqual([facts.requirements[0].text])
    expect(res.gaps).toEqual([facts.requirements[1].text])
    expect(res.breakdown.coverage).toBeCloseTo((0.488 + 0.13) / 2)
  })

  it('names the missing parts when only some are missing', () => {
    const res = run({ facts, answers: { ...answers, req_1_part_0: n(0.6), req_1_part_2: n(0.2) } }) // mean 0.245
    expect(res.gaps).toEqual([`${facts.requirements[1].text} (not shown: incrementality, cohorts, LTV)`])
  })
})

describe('score', () => {
  const flat = (c: number, o: Partial<Parameters<typeof computeScore>[0]> = {}) =>
    computeScore({ coverage: c, skills: c, seniority: c, domain: c, direction: null, belowTargetPay: false, penaltyItems: 0, ...o })

  it('maps scores onto the ladder at 2/3, 4/5 and 7/8', () => {
    expect([1, 2, 3, 4, 5, 7, 8, 10].map(levelForScore)).toEqual(['weak', 'weak', 'consider', 'consider', 'pursue', 'pursue', 'priority', 'priority'])
  })

  it.each([[2.49, 2, 'weak'], [2.51, 3, 'consider'], [4.49, 4, 'consider'], [4.51, 5, 'pursue'], [7.49, 7, 'pursue'], [7.51, 8, 'priority']] as const)(
    'raw %d → %d (%s)', (raw, score, level) => {
      const res = flat((raw - 1) / 9)
      expect(res.raw).toBeCloseTo(raw)
      expect(res.score).toBe(score)
      expect(levelForScore(res.score)).toBe(level)
    },
  )

  it('caps the penalty at 2', () => {
    expect(flat(1, { penaltyItems: 3 })).toMatchObject({ penalty: 1.5, score: 9 })
    expect(flat(1, { penaltyItems: 6 })).toMatchObject({ penalty: 2, score: 8 })
  })

  it('clamps to 1–10', () => {
    expect(flat(0, { penaltyItems: 4 }).score).toBe(1)
    expect(flat(1).score).toBe(10)
  })

  it('uses the tested weights without direction and the direction weights with it', () => {
    const signals = { coverage: 1, skills: 0, seniority: 0, domain: 0 }
    expect(flat(0, signals).composite).toBeCloseTo(0.4)
    expect(flat(0, { ...signals, direction: 0 }).composite).toBeCloseTo(0.34)
    expect(flat(0, { direction: 1 }).composite).toBeCloseTo(0.15)
  })

  it('spreads coverage weight over the rest when there are no scorable requirements', () => {
    expect(flat(0.5, { coverage: null }).composite).toBeCloseTo(0.5)
    const res = run({ facts: { requirements: [r('Travel', { kind: 'availability' })] } })
    expect(res.breakdown.coverage).toBeNull()
  })

  it('reads direction_fit only when it was asked', () => {
    expect(run().breakdown.direction).toBeNull()
    const res = run({ answers: { direction_fit: sc(3) } })
    expect(res.breakdown.direction).toBe(1)
    expect(res.breakdown.composite).not.toBeCloseTo(run().breakdown.composite)
  })

  it('weights seniority by option probability', () => {
    expect(senioritySignal({ match: 0.8, above: 0.2 })).toBeCloseTo(0.92)
    expect(senioritySignal({ well_below: 1 })).toBeCloseTo(0.2)
  })
})

describe('strengths, notes and errors', () => {
  it('keeps the top 3 must-haves by p, then met years', () => {
    const facts = {
      requirements: [
        r('A'), r('B'), r('C'), r('D'), r('E'),
        r('2+ years in X', { years: { min: 2, area: 'X' } }),
      ],
    }
    const res = run({
      facts,
      answers: { req_0: n(0.72), req_1: n(0.95), req_2: n(0.75), req_3: n(0.9), req_4: n(0.8), ...shares(5, { role_1: 'most', role_2: 'none', role_3: 'none', role_4: 'none' }) },
    })
    expect(res.strengths).toEqual(['B', 'D', 'E', '2+ years in X (~2.3 yrs)'])
  })

  it('notes contract roles and a remote mismatch', () => {
    expect(run({ facts: { employmentType: 'contract' } }).notes).toContain('Contract role')
    expect(run({ facts: { employmentType: 'fixed_term' } }).notes).toContain('Fixed-term role')
    expect(run({ answers: { remote_match: n(0.1) } }).notes).toContain("Working pattern doesn't fit your remote preference")
    expect(run({ answers: { remote_match: n(0.9) } }).notes).toEqual([])
  })

  it('throws on a missing answer instead of reading it as a no', () => {
    expect(() => run({ answers: { req_1: undefined } })).toThrow(MissingAnswerError)
    expect(() => run({ answers: { skills_match: undefined } })).toThrow(MissingAnswerError)
    expect(() => run({ answers: { req_0_role_2_a: undefined, req_0_role_2_b: undefined } })).toThrow(MissingAnswerError)
    expect(() => run({ eligibility: { dealbreakers: ['x'] } })).toThrow(MissingAnswerError)
  })

  it('tolerates one missing share order', () => {
    expect(() => run({ answers: { req_0_role_2_b: undefined } })).not.toThrow()
  })
})
