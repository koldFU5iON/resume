import { describe, it, expect } from 'vitest'
import {
  normalizeSearchProfile,
  searchProfileHasContent,
  normalizeSuggestions,
  emptySearchProfile,
  emptyEligibility,
  normalizeEligibility,
  formatSalaryBand,
} from './schema'

describe('normalizeSearchProfile', () => {
  it('returns empty defaults for null input', () => {
    expect(normalizeSearchProfile(null)).toEqual(emptySearchProfile)
  })

  it('returns empty defaults for invalid input', () => {
    expect(normalizeSearchProfile('not-an-object')).toEqual(emptySearchProfile)
  })

  it('parses a valid profile', () => {
    const raw = {
      preferredName: 'Devon',
      currentRole: 'Comms Ops',
      roles: ['Director of Operations'],
      countries: ['UK'],
      remotePreference: 'remote',
      salaryBand: { min: 80000, max: 120000, currency: 'GBP' },
      careerGoals: 'Want to lead ops at a mission-driven tech company',
      pivotContext: '',
      extraContext: '',
    }
    const result = normalizeSearchProfile(raw)
    expect(result.preferredName).toBe('Devon')
    expect(result.roles).toEqual(['Director of Operations'])
    expect(result.salaryBand?.min).toBe(80000)
    expect(result.remotePreference).toBe('remote')
  })

  it('defaults salaryBand to null when absent', () => {
    expect(normalizeSearchProfile({}).salaryBand).toBeNull()
  })

  it('defaults roles to empty array when absent', () => {
    expect(normalizeSearchProfile({}).roles).toEqual([])
  })

  it('falls back to empty string for unknown remotePreference without discarding other fields', () => {
    const result = normalizeSearchProfile({ preferredName: 'Devon', roles: ['CTO'], remotePreference: 'moonbase' })
    expect(result.remotePreference).toBe('')
    expect(result.preferredName).toBe('Devon')
    expect(result.roles).toEqual(['CTO'])
  })
})

describe('searchProfileHasContent', () => {
  it('returns false for empty profile', () => {
    expect(searchProfileHasContent(emptySearchProfile)).toBe(false)
  })

  it('returns true when preferredName is set', () => {
    expect(searchProfileHasContent({ ...emptySearchProfile, preferredName: 'Devon' })).toBe(true)
  })

  it('returns true when roles is non-empty', () => {
    expect(searchProfileHasContent({ ...emptySearchProfile, roles: ['Head of Ops'] })).toBe(true)
  })

  it('returns true when salaryBand is set', () => {
    expect(
      searchProfileHasContent({ ...emptySearchProfile, salaryBand: { min: 80000, max: null, currency: 'GBP' } }),
    ).toBe(true)
  })
})

describe('normalizeSuggestions', () => {
  it('returns empty array for null', () => {
    expect(normalizeSuggestions(null)).toEqual([])
  })

  it('returns empty array for non-array', () => {
    expect(normalizeSuggestions('bad')).toEqual([])
  })

  it('filters out invalid entries', () => {
    const input = [
      { id: '1', field: 'roles', suggestedValue: ['DevRel'], reason: 'test', source: 'chat', createdAt: '2026-01-01T00:00:00Z' },
      { id: '2', field: 'INVALID_FIELD', suggestedValue: 'x', reason: 'r', source: 'chat', createdAt: '2026-01-01T00:00:00Z' },
    ]
    expect(normalizeSuggestions(input)).toHaveLength(1)
    expect(normalizeSuggestions(input)[0].id).toBe('1')
  })
})

describe('formatSalaryBand', () => {
  it('formats min and max', () => {
    expect(formatSalaryBand({ min: 80000, max: 120000, currency: 'GBP' })).toBe('£80,000–£120,000 GBP')
  })

  it('formats min only', () => {
    expect(formatSalaryBand({ min: 80000, max: null, currency: 'GBP' })).toBe('£80,000+ GBP')
  })

  it('formats max only', () => {
    expect(formatSalaryBand({ min: null, max: 100000, currency: 'USD' })).toBe('$100,000 USD')
  })

  it('returns currency code when both are null', () => {
    expect(formatSalaryBand({ min: null, max: null, currency: 'EUR' })).toBe('EUR')
  })
})

describe('eligibility', () => {
  const legacyRow = {
    preferredName: 'Devon', currentRole: '', roles: ['CTO'], countries: ['UK'],
    remotePreference: 'remote', salaryBand: null, careerGoals: '', pivotContext: '', extraContext: '',
  }

  it('parses an old row without eligibility to an empty eligibility, keeping the other fields', () => {
    const result = normalizeSearchProfile(legacyRow)
    expect(result.eligibility).toEqual(emptyEligibility)
    expect(result.preferredName).toBe('Devon')
    expect(result.roles).toEqual(['CTO'])
  })

  it.each([['a string', 'junk'], ['an array', [1, 2]], ['null', null], ['a number', 42]])(
    'parses %s eligibility to empty without discarding the profile',
    (_label, eligibility) => {
      const result = normalizeSearchProfile({ ...legacyRow, eligibility })
      expect(result.eligibility).toEqual(emptyEligibility)
      expect(result.preferredName).toBe('Devon')
    },
  )

  it('replaces malformed fields with their empty value', () => {
    expect(
      normalizeEligibility({ currentCountry: 7, citizenships: 'ES', visas: {}, salaryFloors: null, dealbreakers: 'x' }),
    ).toEqual(emptyEligibility)
  })

  it('round-trips a valid eligibility unchanged', () => {
    const eligibility = {
      currentCountry: 'FR',
      citizenships: ['ES'],
      visas: [{ country: 'GB', type: 'Skilled Worker', expiresOn: '2027-03-31' }],
      salaryFloors: [
        { currency: 'EUR', floor: 90000, target: 100000 },
        { currency: 'GBP', floor: 85000, target: null },
      ],
      dealbreakers: ['Fixed-term contract'],
    }
    expect(normalizeSearchProfile({ ...legacyRow, eligibility }).eligibility).toEqual(eligibility)
  })

  it('trims and uppercases country and currency codes', () => {
    const result = normalizeEligibility({
      currentCountry: ' fr ',
      citizenships: ['es', 'ie'],
      visas: [{ country: 'gb', type: 'Skilled Worker', expiresOn: null }],
      salaryFloors: [{ currency: 'eur', floor: 90000, target: null }],
    })
    expect(result.currentCountry).toBe('FR')
    expect(result.citizenships).toEqual(['ES', 'IE'])
    expect(result.visas[0].country).toBe('GB')
    expect(result.salaryFloors[0].currency).toBe('EUR')
  })

  it('drops invalid codes and de-duplicates citizenships', () => {
    const result = normalizeEligibility({ currentCountry: 'France', citizenships: ['es', 'ES', 'ESP', '', 3] })
    expect(result.currentCountry).toBeNull()
    expect(result.citizenships).toEqual(['ES'])
  })

  it('defaults a visa expiry to null and drops visas with a bad country or malformed date', () => {
    const result = normalizeEligibility({
      visas: [
        { country: 'US', type: 'H-1B' },
        { country: 'GB', type: 'Skilled Worker', expiresOn: '2027-02-30' },
        { country: 'GB', type: 'Skilled Worker', expiresOn: '31/03/2027' },
        { country: '', type: 'Blue Card', expiresOn: null },
      ],
    })
    expect(result.visas).toEqual([{ country: 'US', type: 'H-1B', expiresOn: null }])
  })

  it('collapses duplicate currencies, keeping the first floor', () => {
    const result = normalizeEligibility({
      salaryFloors: [
        { currency: 'EUR', floor: 90000, target: 100000 },
        { currency: 'eur', floor: 50000, target: null },
        { currency: 'GBP', floor: 85000 },
      ],
    })
    expect(result.salaryFloors).toEqual([
      { currency: 'EUR', floor: 90000, target: 100000 },
      { currency: 'GBP', floor: 85000, target: null },
    ])
  })

  it('drops a target below its floor but keeps the floor', () => {
    const result = normalizeEligibility({ salaryFloors: [{ currency: 'EUR', floor: 90000, target: 80000 }] })
    expect(result.salaryFloors).toEqual([{ currency: 'EUR', floor: 90000, target: null }])
  })

  it('drops floors that are negative or not numbers', () => {
    const result = normalizeEligibility({
      salaryFloors: [{ currency: 'EUR', floor: -1 }, { currency: 'GBP', floor: '85000' }],
    })
    expect(result.salaryFloors).toEqual([])
  })

  it('trims dealbreakers, drops empty, duplicate and over-long lines, and keeps at most 10', () => {
    const many = Array.from({ length: 12 }, (_, i) => `Line ${i}`)
    expect(normalizeEligibility({ dealbreakers: ['  On-call  ', '', '   ', 'On-call', 'x'.repeat(201)] }).dealbreakers)
      .toEqual(['On-call'])
    expect(normalizeEligibility({ dealbreakers: many }).dealbreakers).toEqual(many.slice(0, 10))
  })

  it('returns a fresh empty eligibility each time, never the shared constant', () => {
    const a = normalizeSearchProfile(null)
    a.eligibility.citizenships.push('FR')
    expect(emptyEligibility.citizenships).toEqual([])
    expect(normalizeSearchProfile({}).eligibility.citizenships).toEqual([])
  })

  it('counts towards searchProfileHasContent', () => {
    expect(searchProfileHasContent({ ...emptySearchProfile, eligibility: { ...emptyEligibility, currentCountry: 'FR' } }))
      .toBe(true)
    expect(searchProfileHasContent({ ...emptySearchProfile, eligibility: { ...emptyEligibility, dealbreakers: ['On-call'] } }))
      .toBe(true)
    expect(searchProfileHasContent({ ...emptySearchProfile, eligibility: { ...emptyEligibility } })).toBe(false)
  })
})
