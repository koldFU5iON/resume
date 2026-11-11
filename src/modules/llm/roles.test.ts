import { describe, it, expect } from 'vitest'
import {
  availableModelIds,
  normalizeModelRoleChoices,
  recommendedModel,
  resolveRoleModel,
  ROLE_RECOMMENDATIONS,
  type RoleResolutionInput,
} from './roles'

const base: RoleResolutionInput = {
  provider: 'anthropic',
  defaultModel: 'claude-sonnet-5-5',
  availableModels: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
  choices: {},
}

describe('resolveRoleModel', () => {
  it('always uses the default model for the default role', () => {
    expect(resolveRoleModel({ ...base, choices: { fast: 'claude-opus-5-5' } }, 'default')).toEqual({
      model: 'claude-sonnet-5-5', source: 'default', staleChoice: null,
    })
  })

  it("prefers the user's choice when their key still has it", () => {
    expect(resolveRoleModel({ ...base, choices: { fast: 'claude-opus-5-5' } }, 'fast')).toEqual({
      model: 'claude-opus-5-5', source: 'choice', staleChoice: null,
    })
  })

  it('falls back to the recommendation and flags a stale choice', () => {
    expect(resolveRoleModel({ ...base, choices: { fast: 'claude-gone-1' } }, 'fast')).toEqual({
      model: 'claude-haiku-5-5', source: 'recommended', staleChoice: 'claude-gone-1',
    })
  })

  it('falls back to the default model when the recommendation is unavailable', () => {
    const input = { ...base, availableModels: ['claude-sonnet-5-5'], choices: { fast: 'claude-gone-1' } }
    expect(resolveRoleModel(input, 'fast')).toEqual({
      model: 'claude-sonnet-5-5', source: 'default', staleChoice: 'claude-gone-1',
    })
  })

  it('falls back to the default model when the provider has no recommendation', () => {
    expect(resolveRoleModel({ ...base, provider: 'google', defaultModel: 'gemini-3.5-flash', availableModels: null }, 'research'))
      .toEqual({ model: 'gemini-3.5-flash', source: 'default', staleChoice: null })
  })

  it('trusts choices and recommendations when no model list is cached', () => {
    const input = { ...base, availableModels: null }
    expect(resolveRoleModel({ ...input, choices: { analysis: 'claude-opus-5-5' } }, 'analysis').source).toBe('choice')
    expect(resolveRoleModel(input, 'fast')).toMatchObject({ model: 'claude-haiku-5-5', source: 'recommended' })
  })
})

describe('recommendations', () => {
  it('keep untested providers null', () => {
    expect(Object.values(ROLE_RECOMMENDATIONS.openai).every(v => v === null)).toBe(true)
    expect(Object.values(ROLE_RECOMMENDATIONS.google).every(v => v === null)).toBe(true)
  })

  it('have none for the default role or unknown providers', () => {
    expect(recommendedModel('anthropic', 'default')).toBeNull()
    expect(recommendedModel('mistral', 'fast')).toBeNull()
  })
})

describe('normalizeModelRoleChoices', () => {
  it('keeps valid role entries and drops the rest', () => {
    expect(normalizeModelRoleChoices({ fast: ' m1 ', research: '', analysis: 3, default: 'x', other: 'y' }))
      .toEqual({ fast: 'm1' })
  })

  it('reads non-objects as no choices', () => {
    expect(normalizeModelRoleChoices(null)).toEqual({})
    expect(normalizeModelRoleChoices(['fast'])).toEqual({})
    expect(normalizeModelRoleChoices('fast')).toEqual({})
  })
})

describe('availableModelIds', () => {
  it('returns ids, or null when no list is cached', () => {
    expect(availableModelIds([{ id: 'a', name: 'A' }, { name: 'no id' }, null])).toEqual(['a'])
    expect(availableModelIds(null)).toBeNull()
  })
})
