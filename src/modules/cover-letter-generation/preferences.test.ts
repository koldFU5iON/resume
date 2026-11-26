import { describe, expect, it } from 'vitest'
import { mergeChoice, normalizePreferences, pickerDefaults } from './preferences'

describe('normalizePreferences', () => {
  it('keeps valid fields and drops bad ones without throwing', () => {
    expect(normalizePreferences({ tone: 'direct', length: 'huge', answers: { why_now: 'Ready to lead' } })).toEqual({ tone: 'direct', answers: { why_now: 'Ready to lead' } })
    expect(normalizePreferences(null)).toEqual({})
    expect(normalizePreferences('nonsense')).toEqual({})
  })
})

describe('pickerDefaults', () => {
  it('starts on warm and standard the first time, then on what was chosen last', () => {
    expect(pickerDefaults({})).toEqual({ tone: 'warm', length: 'standard', answers: {} })
    expect(pickerDefaults({ tone: 'formal', length: 'short' })).toMatchObject({ tone: 'formal', length: 'short' })
  })
})

describe('mergeChoice', () => {
  it('remembers tone, length and only reusable answers; a blank answer forgets that topic', () => {
    const prev = { tone: 'warm' as const, answers: { why_now: 'old', motivation: 'keep me' } }
    const next = mergeChoice(prev, {
      tone: 'direct',
      length: 'short',
      answers: [
        { topic: 'why_now', question: 'Why now?', answer: '' },
        { topic: 'why_company', question: 'Why us?', answer: 'Job-specific, never remembered' },
        { topic: 'motivation', question: 'What do you want next?', answer: '  Build a team  ' },
      ],
    })
    expect(next).toEqual({ tone: 'direct', length: 'short', answers: { motivation: 'Build a team' } })
  })
})
