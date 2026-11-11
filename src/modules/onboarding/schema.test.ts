import { describe, expect, it } from 'vitest'
import { emptyOnboardingContext, normalizeOnboardingContext } from './schema'

describe('normalizeOnboardingContext', () => {
  it('keeps valid fields when another field is malformed', () => {
    const ctx = normalizeOnboardingContext({ currentRole: 'PM', targetRole: 42, additionalRoles: 'nope' })
    expect(ctx.currentRole).toBe('PM')
    expect(ctx.targetRole).toBe('')
    expect(ctx.additionalRoles).toEqual([])
  })

  it('truncates over-long text instead of discarding the whole context', () => {
    const ctx = normalizeOnboardingContext({ currentRole: 'PM', industries: 'x'.repeat(600) })
    expect(ctx.currentRole).toBe('PM')
    expect(ctx.industries).toHaveLength(500)
  })

  it('drops non-string and blank roles and unknown keys', () => {
    const ctx = normalizeOnboardingContext({ additionalRoles: [' DevRel ', 3, ''], bogus: true })
    expect(ctx.additionalRoles).toEqual(['DevRel'])
    expect(ctx).not.toHaveProperty('bogus')
  })

  it('returns the empty context for non-objects', () => {
    expect(normalizeOnboardingContext('junk')).toEqual(emptyOnboardingContext)
  })
})
