import { describe, expect, it } from 'vitest'

// The verdict function is intentionally exercised through a small exported test hook
// so hard constraints remain the primary gate instead of a score-only threshold.
import { selectScoutVerdictForTest } from './triage'

const base = {
  fit: { rating: 9, label: 'standout' as const, justification: 'reason' },
  hardConstraintsMet: true,
  logisticalViable: true,
  evidenceStrength: 'strong' as const,
  careerDirection: 'aligned' as const,
  confidence: 'high' as const,
}

describe('Scout triage verdict', () => {
  it('does not prioritize a high score when a hard constraint fails', () => {
    expect(selectScoutVerdictForTest({ ...base, hardConstraintsMet: false })).toBe('PASS')
  })

  it('does not prioritize a high score with weak evidence', () => {
    expect(selectScoutVerdictForTest({ ...base, evidenceStrength: 'weak' })).toBe('PASS')
  })

  it('prioritizes only a strong, viable, aligned, high-confidence role', () => {
    expect(selectScoutVerdictForTest(base)).toBe('PRIORITY')
  })

  it('keeps viable but less certain roles for review', () => {
    expect(selectScoutVerdictForTest({ ...base, confidence: 'medium' })).toBe('REVIEW')
  })
})
