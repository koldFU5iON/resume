import { describe, expect, it } from 'vitest'
import { evidenceLine, projectHighlights } from './project-highlights'

const ev = (description: string, impact: string | null = null) => ({ description, impact })

describe('projectHighlights', () => {
  it('uses owned evidence, with impact in brackets, over legacy highlights', () => {
    expect(projectHighlights([ev('Shipped', '2x faster'), ev('Scaled')], ['old'])).toEqual(['Shipped (2x faster)', 'Scaled'])
  })

  it('falls back to legacy highlights, keeping only strings', () => {
    expect(projectHighlights([], ['a', 3, 'b'])).toEqual(['a', 'b'])
    expect(projectHighlights([], 'not an array')).toEqual([])
  })

  it('formats one evidence line', () => {
    expect(evidenceLine(ev('Shipped'))).toBe('Shipped')
    expect(evidenceLine(ev('Shipped', '10%'))).toBe('Shipped (10%)')
  })
})
