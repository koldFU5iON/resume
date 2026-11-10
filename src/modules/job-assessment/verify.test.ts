import { describe, expect, it } from 'vitest'
import { VERIFY_REASONS, codeChecks, evaluateVerify, type VerifyAnswers } from './verify'

const FULL_DESCRIPTION = [
  'About the role: you will run the delivery program for our routing platform across five engineering squads,',
  'own quarterly planning, track risks and dependencies, and report progress to the leadership team.',
  'Responsibilities: lead planning; coordinate releases; manage stakeholders across product, sales and support.',
  'Requirements: 7+ years of program or project management in B2B software; experience coordinating several',
  'engineering teams; excellent written and spoken English; PMP or similar certification is a plus.',
  'What we offer: permanent contract, hybrid working from our Lyon office, learning budget and health cover.',
].join(' ')

const TEASER = 'Senior Program Manager · Fictional Freight · Lyon (Hybrid). Sign in to see the full job description and apply.'

const job = { title: 'Senior Program Manager', company: 'Fictional Freight', description: FULL_DESCRIPTION }
const answers = (full: number, reqs: number): VerifyAnswers => ({
  is_full_description: { noul: full },
  has_requirements: { noul: reqs },
  has_responsibilities: { noul: 0.9 },
})

describe('codeChecks', () => {
  it('passes a full job', () => {
    expect(FULL_DESCRIPTION.length).toBeGreaterThanOrEqual(600)
    expect(codeChecks(job)).toEqual([])
  })

  it('flags placeholder or empty title and company', () => {
    expect(codeChecks({ ...job, title: '(untitled)', company: ' (Unknown) ' })).toEqual([
      VERIFY_REASONS.titleMissing, VERIFY_REASONS.companyMissing,
    ])
    expect(codeChecks({ ...job, title: '', company: null })).toEqual([VERIFY_REASONS.titleMissing, VERIFY_REASONS.companyMissing])
  })

  it('flags a missing or short description', () => {
    expect(codeChecks({ ...job, description: '   ' })).toEqual([VERIFY_REASONS.descriptionMissing])
    expect(codeChecks({ ...job, description: TEASER })).toEqual([VERIFY_REASONS.descriptionShort(TEASER.length)])
    expect(VERIFY_REASONS.descriptionShort(112)).toBe('Description is too short (112 characters; at least 600 needed)')
  })
})

describe('evaluateVerify', () => {
  it('passes a full description', () => {
    expect(evaluateVerify(job, answers(0.93, 0.95))).toEqual({ pass: true, reasons: [] })
  })

  it('passes at exactly the thresholds', () => {
    expect(evaluateVerify(job, answers(0.7, 0.5)).pass).toBe(true)
  })

  it('fails a teaser padded past the length check', () => {
    const padded = { ...job, description: `${TEASER} ${'Related jobs: Program Manager, Project Manager, Delivery Lead. '.repeat(10)}` }
    expect(evaluateVerify(padded, answers(0.06, 0.2))).toEqual({
      pass: false,
      reasons: ['Description looks incomplete or truncated', 'No candidate requirements found'],
    })
  })

  it('reports each Jev reason on its own', () => {
    expect(evaluateVerify(job, answers(0.69, 0.9)).reasons).toEqual([VERIFY_REASONS.incomplete])
    expect(evaluateVerify(job, answers(0.9, 0.49)).reasons).toEqual([VERIFY_REASONS.noRequirements])
  })

  it('returns code reasons without reading answers', () => {
    expect(evaluateVerify({ ...job, description: TEASER }, null)).toEqual({
      pass: false,
      reasons: [VERIFY_REASONS.descriptionShort(TEASER.length)],
    })
  })

  it('requires answers once the code checks pass', () => {
    expect(() => evaluateVerify(job, null)).toThrow()
  })
})
