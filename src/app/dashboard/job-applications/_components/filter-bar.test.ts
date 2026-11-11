import { describe, expect, it } from 'vitest'
import { normaliseSort } from './filter-bar'

describe('normaliseSort', () => {
  it('maps a saved JobFit sort to the early score when the early assessment is on', () => {
    expect(normaliseSort({ field: 'fitRating', direction: 'asc' }, true)).toEqual({ field: 'earlyScore', direction: 'asc' })
  })

  it('maps a saved early-score sort back to JobFit when the early assessment is off', () => {
    expect(normaliseSort({ field: 'earlyScore', direction: 'desc' }, false)).toEqual({ field: 'fitRating', direction: 'desc' })
  })

  it('leaves other sorts alone', () => {
    expect(normaliseSort({ field: 'company', direction: 'asc' }, true)).toEqual({ field: 'company', direction: 'asc' })
    expect(normaliseSort({ field: 'earlyScore', direction: 'desc' }, true)).toEqual({ field: 'earlyScore', direction: 'desc' })
  })
})
