import { describe, expect, it } from 'vitest'
import { SkillInputSchema, normalizeSkillLevel } from './schema'

describe('normalizeSkillLevel', () => {
  it('lowercases known levels', () => {
    expect(normalizeSkillLevel('Expert')).toBe('expert')
    expect(normalizeSkillLevel(' ADVANCED ')).toBe('advanced')
  })

  it('falls back to intermediate for unknown or missing values', () => {
    expect(normalizeSkillLevel('guru')).toBe('intermediate')
    expect(normalizeSkillLevel(null)).toBe('intermediate')
    expect(normalizeSkillLevel(undefined)).toBe('intermediate')
  })
})

describe('SkillInputSchema', () => {
  it('normalises level and defaults an empty category', () => {
    expect(SkillInputSchema.parse({ name: ' SQL ', category: '', level: 'Expert' })).toEqual({
      name: 'SQL', category: 'General', level: 'expert',
    })
  })

  it('rejects an empty name', () => {
    expect(SkillInputSchema.safeParse({ name: '  ', category: 'Data', level: 'expert' }).success).toBe(false)
  })
})
