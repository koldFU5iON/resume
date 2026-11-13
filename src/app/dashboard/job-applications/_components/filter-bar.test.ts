import { describe, expect, it } from 'vitest'
import { normaliseSort, selectSortField } from './filter-bar'

describe('selectSortField', () => {
  it('starts company sorting alphabetically and dates/scores newest or best first', () => {
    expect(selectSortField({ field: 'dateApplied', direction: 'desc' }, 'company')).toEqual({ field: 'company', direction: 'asc' })
    expect(selectSortField({ field: 'company', direction: 'asc' }, 'earlyScore')).toEqual({ field: 'earlyScore', direction: 'desc' })
    expect(selectSortField({ field: 'company', direction: 'asc' }, 'dateApplied')).toEqual({ field: 'dateApplied', direction: 'desc' })
  })

  it('preserves a manually chosen direction when reselecting the current field', () => {
    expect(selectSortField({ field: 'company', direction: 'desc' }, 'company')).toEqual({ field: 'company', direction: 'desc' })
  })
})

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
