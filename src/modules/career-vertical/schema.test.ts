import { describe, it, expect } from 'vitest'
import { CareerVerticalAnalysisSchema } from './schema'

const VALID_ANALYSIS = {
  thesis: 'Solves cross-functional operational complexity by designing scalable systems.',
  businessProblems: ['Cross-functional misalignment', 'Manual processes', 'Scaling execution'],
  responsibilities: ['Lead programmes', 'Build operational processes', 'Metrics & reporting'],
  outcomes: ['Improved efficiency', 'Increased adoption', 'Standardisation'],
  competencies: ['Programme Management', 'Process Design', 'Stakeholder Management'],
}

describe('CareerVerticalAnalysisSchema', () => {
  it('accepts a valid analysis', () => {
    const res = CareerVerticalAnalysisSchema.safeParse(VALID_ANALYSIS)
    expect(res.success).toBe(true)
  })

  it('rejects an empty thesis', () => {
    const res = CareerVerticalAnalysisSchema.safeParse({
      ...VALID_ANALYSIS,
      thesis: '',
    })
    expect(res.success).toBe(false)
  })

  it('rejects missing thread arrays', () => {
    const res = CareerVerticalAnalysisSchema.safeParse({ thesis: VALID_ANALYSIS.thesis })
    expect(res.success).toBe(false)
  })

  it('rejects non-string items in the arrays', () => {
    const res = CareerVerticalAnalysisSchema.safeParse({
      ...VALID_ANALYSIS,
      competencies: ['Programme Management', 42],
    })
    expect(res.success).toBe(false)
  })
})
