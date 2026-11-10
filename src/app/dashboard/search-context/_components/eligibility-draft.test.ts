import { describe, it, expect } from 'vitest'
import { emptyEligibility, normalizeEligibility, type Eligibility } from '@/modules/search-profile/schema'
import {
  AMOUNT_MAX,
  formatAmount,
  formatAmountText,
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

  it('gives loaded rows deterministic, unique keys (same on server and client)', () => {
    const a = toEligibilityDraft(sample)
    const b = toEligibilityDraft(sample)
    expect(a).toEqual(b)
    expect(a.visas.map((r) => r.key)).toEqual(['visa-0'])
    expect(a.salaryFloors.map((r) => r.key)).toEqual(['floor-0', 'floor-1'])
    expect(a.dealbreakers.map((r) => r.key)).toEqual(['deal-0'])
  })

  it('keeps salary amounts as editable text', () => {
    const d = toEligibilityDraft(sample)
    expect(d.salaryFloors[0]).toMatchObject({ floor: '90000', target: '100000' })
    expect(d.salaryFloors[1]).toMatchObject({ floor: '85000', target: '' })
  })

  describe('current-country suggestion', () => {
    it('shows the suggestion only when no country is stored', () => {
      expect(toEligibilityDraft(emptyEligibility, 'FR')).toMatchObject({ currentCountry: 'FR', currentCountrySuggested: true })
      expect(toEligibilityDraft({ ...sample, currentCountry: 'ES' }, 'FR')).toMatchObject({
        currentCountry: 'ES',
        currentCountrySuggested: false,
      })
      expect(toEligibilityDraft(emptyEligibility, null)).toMatchObject({ currentCountry: null, currentCountrySuggested: false })
    })

    it('does not save an unconfirmed suggestion', () => {
      expect(fromEligibilityDraft(toEligibilityDraft(emptyEligibility, 'FR')).currentCountry).toBeNull()
    })

    it('saves the suggestion once confirmed', () => {
      const d = { ...toEligibilityDraft(emptyEligibility, 'FR'), currentCountrySuggested: false }
      expect(fromEligibilityDraft(d).currentCountry).toBe('FR')
    })
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
      salaryFloors: [{ key: 'c', currency: 'USD', floor: '', target: '' }],
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
      draft({ salaryFloors: [{ key: 'f', currency: 'EUR', floor: '90000', target: '80000' }] }),
    )
    expect(errors.floors.f.target).toContain('€90,000')
    expect(hasDraftErrors(errors)).toBe(true)
  })

  it('accepts a target equal to the floor, or no target', () => {
    const errors = validateEligibilityDraft(
      draft({
        salaryFloors: [
          { key: 'f', currency: 'EUR', floor: '90k', target: '90,000' },
          { key: 'g', currency: 'GBP', floor: '85000', target: '' },
        ],
      }),
    )
    expect(hasDraftErrors(errors)).toBe(false)
  })

  it('flags a target with no floor, but not an untouched row', () => {
    const errors = validateEligibilityDraft(
      draft({
        salaryFloors: [
          { key: 'f', currency: 'EUR', floor: '', target: '100000' },
          { key: 'g', currency: 'GBP', floor: '', target: '' },
        ],
      }),
    )
    expect(errors.floors.f.floor).toBeTruthy()
    expect(errors.floors.g).toBeUndefined()
  })

  it('flags amounts it cannot read or that are absurd, instead of dropping them', () => {
    const errors = validateEligibilityDraft(
      draft({
        salaryFloors: [
          { key: 'f', currency: 'EUR', floor: 'ninety', target: '' },
          { key: 'g', currency: 'GBP', floor: '85000', target: '1000000000' },
        ],
      }),
    )
    expect(errors.floors.f.floor).toMatch(/Enter a number/)
    expect(errors.floors.g.target).toMatch(/too high/)
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

describe('parseAmount', () => {
  const value = (raw: string) => {
    const r = parseAmount(raw)
    return r.ok ? r.value : `error: ${r.error}`
  }

  it('returns null for empty input', () => {
    expect(value('')).toBeNull()
    expect(value('   ')).toBeNull()
  })

  it.each([
    ['90000', 90000],
    ['€90,000', 90000],
    ['90 000', 90000],
    ['90 000', 90000],
    ["90'000", 90000],
    ['90.000', 90000],
    ['1,250,000', 1250000],
    ['CHF 120000', 120000],
  ])('reads thousands separators and symbols: %s → %d', (raw, expected) => {
    expect(value(raw)).toBe(expected)
  })

  it.each([
    ['90k', 90000],
    ['90K', 90000],
    ['92.5k', 92500],
    ['€ 85 k', 85000],
  ])('reads a k suffix: %s → %d', (raw, expected) => {
    expect(value(raw)).toBe(expected)
  })

  it.each([
    ['90000.50', 90000.5],
    ['90000,50', 90000.5],
    ['90,000.50', 90000.5],
    ['90.000,50', 90000.5],
    ['1.5', 1.5],
  ])('reads decimals without merging them into the integer part: %s → %d', (raw, expected) => {
    expect(value(raw)).toBe(expected)
  })

  it.each(['abc', 'k', '-5', '90k k', '1e9', '9O000'])('rejects text that is not an amount: %s', (raw) => {
    expect(value(raw)).toMatch(/^error: Enter a number/)
  })

  it('rejects absurd values', () => {
    expect(value(String(AMOUNT_MAX))).toBe(AMOUNT_MAX)
    expect(value(String(AMOUNT_MAX + 1))).toMatch(/^error: .*too high/)
    expect(value('9999999999999999999999')).toMatch(/^error: .*too high/)
    expect(value('200000k')).toMatch(/^error: .*too high/)
  })
})

describe('amount formatting', () => {
  it('formats with thousands separators', () => {
    expect(formatAmount(85000)).toBe('85,000')
    expect(formatAmount(90000.5)).toBe('90,000.5')
    expect(formatAmount(null)).toBe('')
    expect(formatMoney(85000, 'GBP')).toBe('£85,000')
    expect(formatMoney(120000, 'CHF')).toBe('CHF 120,000')
  })

  it('formats typed text for display, leaving unreadable text as typed', () => {
    expect(formatAmountText('90k')).toBe('90,000')
    expect(formatAmountText('')).toBe('')
    expect(formatAmountText('ninety')).toBe('ninety')
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
