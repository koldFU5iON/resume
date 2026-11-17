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
  it('maps a saved JobFit sort to the early score', () => {
    expect(normaliseSort({ field: 'fitRating', direction: 'asc' })).toEqual({ field: 'earlyScore', direction: 'asc' })
  })

  it('leaves current sorts alone', () => {
    expect(normaliseSort({ field: 'company', direction: 'asc' })).toEqual({ field: 'company', direction: 'asc' })
    expect(normaliseSort({ field: 'earlyScore', direction: 'desc' })).toEqual({ field: 'earlyScore', direction: 'desc' })
  })

  it('falls back to the default for an unknown field', () => {
    expect(normaliseSort({ field: 'nope', direction: 'asc' })).toEqual({ field: 'dateApplied', direction: 'desc' })
  })
})
