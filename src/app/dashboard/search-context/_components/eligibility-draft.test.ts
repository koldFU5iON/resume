import { describe, it, expect } from 'vitest'
import { emptyEligibility, normalizeEligibility, type Eligibility } from '@/modules/search-profile/schema'
import {
  countryFromLocation,
  formatAmount,
  formatMoney,
  fromEligibilityDraft,
  hasDraftErrors,
  nextUnusedCurrency,
  parseAmount,
  toEligibilityDraft,
  validateEligibilityDraft,
  type EligibilityDraft,
} from './eligibility-draft'

const sample: Eligibility = {
  currentCountry: 'FR',
  citizenships: ['IT'],
  visas: [{ country: 'GB', type: 'Skilled Worker', expiresOn: '2027-06-30' }],
  salaryFloors: [
    { currency: 'EUR', floor: 90000, target: 100000 },
    { currency: 'GBP', floor: 85000, target: null },
  ],
  dealbreakers: ['Fixed-term contract'],
}

function draft(patch: Partial<EligibilityDraft>): EligibilityDraft {
  return { ...toEligibilityDraft(emptyEligibility), ...patch }
}

describe('toEligibilityDraft / fromEligibilityDraft', () => {
  it('round-trips a stored eligibility unchanged', () => {
    expect(fromEligibilityDraft(toEligibilityDraft(sample))).toEqual(sample)
  })

  it('gives every row a unique key', () => {
    const d = toEligibilityDraft(sample)
    const keys = [...d.visas, ...d.salaryFloors, ...d.dealbreakers].map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('uses the suggested country only when none is stored', () => {
    expect(toEligibilityDraft(emptyEligibility, 'FR').currentCountry).toBe('FR')
    expect(toEligibilityDraft({ ...sample, currentCountry: 'ES' }, 'FR').currentCountry).toBe('ES')
  })

  it('maps an empty expiry to null and back to an empty date input', () => {
    const d = toEligibilityDraft({ ...emptyEligibility, visas: [{ country: 'US', type: 'H-1B', expiresOn: null }] })
    expect(d.visas[0].expiresOn).toBe('')
    expect(fromEligibilityDraft(d).visas[0].expiresOn).toBeNull()
  })

  it('drops blank rows and trims text', () => {
    const d = draft({
      visas: [
        { key: 'a', country: null, type: '', expiresOn: '' },
        { key: 'b', country: 'CA', type: '  Open work permit ', expiresOn: '' },
      ],
      salaryFloors: [{ key: 'c', currency: 'USD', floor: null, target: null }],
      dealbreakers: [{ key: 'd', text: '   ' }, { key: 'e', text: ' On-call ' }],
    })
    const e = fromEligibilityDraft(d)
    expect(e.visas).toEqual([{ country: 'CA', type: 'Open work permit', expiresOn: null }])
    expect(e.salaryFloors).toEqual([])
    expect(e.dealbreakers).toEqual(['On-call'])
  })

  it('produces a value the server normaliser keeps as-is', () => {
    const e = fromEligibilityDraft(toEligibilityDraft(sample))
    expect(normalizeEligibility(e)).toEqual(e)
  })
})

describe('validateEligibilityDraft', () => {
  it('flags a target below the floor', () => {
    const errors = validateEligibilityDraft(
      draft({ salaryFloors: [{ key: 'f', currency: 'EUR', floor: 90000, target: 80000 }] }),
    )
    expect(errors.floors.f.target).toContain('€90,000')
    expect(hasDraftErrors(errors)).toBe(true)
  })

  it('accepts a target equal to the floor, or no target', () => {
    const errors = validateEligibilityDraft(
      draft({
        salaryFloors: [
          { key: 'f', currency: 'EUR', floor: 90000, target: 90000 },
          { key: 'g', currency: 'GBP', floor: 85000, target: null },
        ],
      }),
    )
    expect(hasDraftErrors(errors)).toBe(false)
  })

  it('flags a target with no floor, but not an untouched row', () => {
    const errors = validateEligibilityDraft(
      draft({
        salaryFloors: [
          { key: 'f', currency: 'EUR', floor: null, target: 100000 },
          { key: 'g', currency: 'GBP', floor: null, target: null },
        ],
      }),
    )
    expect(errors.floors.f.floor).toBeTruthy()
    expect(errors.floors.g).toBeUndefined()
  })

  it('flags a filled-in visa with no country', () => {
    const errors = validateEligibilityDraft(
      draft({
        visas: [
          { key: 'v', country: null, type: 'Skilled Worker', expiresOn: '' },
          { key: 'w', country: null, type: '', expiresOn: '' },
        ],
      }),
    )
    expect(errors.visas.v).toBeTruthy()
    expect(errors.visas.w).toBeUndefined()
  })
})

describe('amount helpers', () => {
  it('parses digits and ignores separators and symbols', () => {
    expect(parseAmount('€90,000')).toBe(90000)
    expect(parseAmount('  ')).toBeNull()
  })

  it('formats with thousands separators', () => {
    expect(formatAmount(85000)).toBe('85,000')
    expect(formatAmount(null)).toBe('')
    expect(formatMoney(85000, 'GBP')).toBe('£85,000')
    expect(formatMoney(120000, 'CHF')).toBe('CHF 120,000')
  })
})

describe('nextUnusedCurrency', () => {
  it('prefers the given currency when it is free', () => {
    expect(nextUnusedCurrency([], 'GBP')).toBe('GBP')
    expect(nextUnusedCurrency(['GBP'], 'GBP')).toBe('EUR')
  })

  it('returns null when every currency is used', () => {
    const all = ['EUR', 'GBP', 'USD', 'CHF', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'SGD']
    expect(nextUnusedCurrency(all)).toBeNull()
  })
})

describe('countryFromLocation', () => {
  it.each([
    ['France', 'FR'],
    ['Paris, France', 'FR'],
    ['London, UK', 'GB'],
    ['fr', 'FR'],
    ['Remote', null],
    ['', null],
    [null, null],
  ])('%s → %s', (location, expected) => {
    expect(countryFromLocation(location)).toBe(expected)
  })
})
