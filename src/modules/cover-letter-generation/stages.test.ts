import { describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/llm/prompt-context', () => ({ composeSystem: vi.fn(), loadWritingContext: vi.fn() }))
vi.mock('@/modules/prompts/loader', () => ({ loadPromptText: vi.fn() }))
vi.mock('@/modules/cv-generation/call', () => ({ attributionOf: vi.fn(), completeChecked: vi.fn(), completeValidated: vi.fn() }))

import { applyReviewEdits } from './stages'

const out = {
  salutation: 'Dear Hiring Team,',
  paragraphs: ['I led the rollout across eight markets.', 'I cut cycle time 40% at my last company.', 'I would welcome a conversation.'],
  closing: 'Kind regards,',
}
const sources = ['Cut cycle time 40%', 'eight markets']

describe('applyReviewEdits', () => {
  it('applies an exact, unique edit', () => {
    const r = applyReviewEdits(out, [{ paragraph: 2, before: 'I would welcome a conversation.', after: 'I would like to talk about how I could help your team.', reason: 'stronger close' }], sources)
    expect(r.out.paragraphs[2]).toBe('I would like to talk about how I could help your team.')
    expect(r.applied).toHaveLength(1)
    expect(r.discarded).toEqual([])
  })

  it('discards edits that quote text not in the paragraph, empty it, add figures or add clichés', () => {
    const r = applyReviewEdits(out, [
      { paragraph: 0, before: 'not there', after: 'x', reason: '' },
      { paragraph: 2, before: 'I would welcome a conversation.', after: '', reason: '' },
      { paragraph: 1, before: '40%', after: '55%', reason: '' },
      { paragraph: 0, before: 'I led', after: 'As a team player, I led', reason: '' },
      { paragraph: 7, before: 'x', after: 'y', reason: '' },
    ], sources)
    expect(r.applied).toEqual([])
    expect(r.out).toEqual(out)
    expect(r.discarded.map((d) => d.why)).toEqual([
      'the quoted text is not in the paragraph',
      'it would empty the paragraph',
      'it adds figures not in the sources: 55',
      'it adds generic phrases: team player',
      'no such paragraph',
    ])
  })
})
