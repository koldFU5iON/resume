import { describe, it, expect } from 'vitest'
import { emptyEligibility, type Eligibility } from '@/modules/search-profile/schema'
import {
  COUNTRIES,
  CURRENCIES,
  EU_EEA_CH,
  checkPay,
  checkRelocation,
  checkWorkRights,
  coveredCountries,
  toCountryCode,
  type JobLocation,
  type JobSalary,
} from './eligibility'

const TODAY = new Date('2026-11-10T12:00:00Z')

function elig(overrides: Partial<Eligibility> = {}): Eligibility {
  return { ...emptyEligibility, ...overrides }
}

const onsite = (...countries: string[]): JobLocation => ({ countries, mode: 'onsite' })

describe('reference data', () => {
  it('lists unique uppercase country codes sorted by name', () => {
    const codes = COUNTRIES.map((c) => c.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true)
    const names = COUNTRIES.map((c) => c.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')))
    expect(COUNTRIES.find((c) => c.code === 'GB')?.name).toBe('United Kingdom')
  })

  it('has every EU/EEA/CH code in the country list', () => {
    expect(EU_EEA_CH.size).toBe(31)
    const codes = new Set(COUNTRIES.map((c) => c.code))
    for (const c of EU_EEA_CH) expect(codes.has(c)).toBe(true)
  })

  it('includes the required currencies', () => {
    const codes = CURRENCIES.map((c) => c.code)
    for (const c of ['EUR', 'GBP', 'USD', 'CHF', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN']) {
      expect(codes).toContain(c)
    }
  })

  it.each([['fr', 'FR'], ['France', 'FR'], ['UK', 'GB'], ['england', 'GB'], ['USA', 'US'], ['Narnia', null], ['', null]])(
    'toCountryCode(%s) → %s',
    (input, expected) => {
      expect(toCountryCode(input)).toBe(expected)
    },
  )
})

describe('coveredCountries', () => {
  it('a non-Irish EU citizen covers EU/EEA/CH but not GB', () => {
    const covered = coveredCountries(elig({ citizenships: ['IT'] }), TODAY)
    for (const c of ['IT', 'FR', 'DE', 'IE', 'NO', 'IS', 'LI', 'CH']) expect(covered.has(c)).toBe(true)
    expect(covered.has('GB')).toBe(false)
  })

  it('an Irish citizen covers IE, the EU and GB', () => {
    const covered = coveredCountries(elig({ citizenships: ['IE'] }), TODAY)
    for (const c of ['IE', 'FR', 'CH', 'GB']) expect(covered.has(c)).toBe(true)
  })

  it('a British citizen covers GB and IE only', () => {
    const covered = coveredCountries(elig({ citizenships: ['GB'] }), TODAY)
    expect([...covered].sort()).toEqual(['GB', 'IE'])
  })

  it('any other citizenship covers that country only', () => {
    expect([...coveredCountries(elig({ citizenships: ['US'] }), TODAY)]).toEqual(['US'])
  })

  it('counts unexpired and open-ended visas and ignores expired ones', () => {
    const covered = coveredCountries(
      elig({
        visas: [
          { country: 'GB', type: 'Skilled Worker', expiresOn: '2026-11-09' },
          { country: 'CA', type: 'Work permit', expiresOn: '2026-11-10' },
          { country: 'AU', type: 'Working holiday', expiresOn: '2027-06-01' },
          { country: 'US', type: 'Green card', expiresOn: null },
        ],
      }),
      TODAY,
    )
    expect(covered.has('GB')).toBe(false)
    expect(covered.has('CA')).toBe(true)
    expect(covered.has('AU')).toBe(true)
    expect(covered.has('US')).toBe(true)
  })
})

describe('checkWorkRights', () => {
  const spanish = elig({ citizenships: ['ES'] })

  it('remote anywhere is covered', () => {
    expect(checkWorkRights(elig(), { countries: [], mode: 'remote_anywhere' }, 'not_offered', TODAY))
      .toEqual({ status: 'covered', countries: [] })
  })

  it('no known job countries is unknown', () => {
    expect(checkWorkRights(spanish, { countries: [], mode: 'onsite' }, 'not_mentioned', TODAY).status).toBe('unknown')
  })

  it('covered when any job country is covered', () => {
    expect(checkWorkRights(spanish, onsite('FR', 'GB'), 'not_offered', TODAY))
      .toEqual({ status: 'covered', countries: ['FR'] })
  })

  it.each([
    ['not_offered', 'blocked'],
    ['right_to_work_required', 'blocked'],
    ['offered', 'needs_sponsorship_offered'],
    ['not_mentioned', 'unconfirmed'],
  ] as const)('not covered + sponsorship %s → %s', (sponsorship, status) => {
    expect(checkWorkRights(spanish, onsite('GB'), sponsorship, TODAY)).toEqual({ status, countries: ['GB'] })
  })

  it('normalises job country codes and aliases', () => {
    expect(checkWorkRights(elig({ citizenships: ['GB'] }), onsite('uk'), 'not_offered', TODAY).status).toBe('covered')
  })

  it('remote_region uses remoteRegions as the countries', () => {
    const job: JobLocation = { countries: ['US'], mode: 'remote_region', remoteRegions: ['DE', 'NL'] }
    expect(checkWorkRights(spanish, job, 'not_offered', TODAY)).toEqual({ status: 'covered', countries: ['DE', 'NL'] })
    expect(checkWorkRights(elig({ citizenships: ['US'] }), job, 'not_offered', TODAY).status).toBe('blocked')
  })

  it('remote_region understands "EU" and falls back to countries when regions name nothing usable', () => {
    expect(checkWorkRights(spanish, { countries: [], mode: 'remote_region', remoteRegions: ['EU'] }, 'not_offered', TODAY).status)
      .toBe('covered')
    expect(checkWorkRights(spanish, { countries: ['GB'], mode: 'remote_region', remoteRegions: ['EMEA'] }, 'not_offered', TODAY))
      .toEqual({ status: 'blocked', countries: ['GB'] })
  })

  it('an expired visa does not cover', () => {
    const e = elig({ visas: [{ country: 'GB', type: 'Skilled Worker', expiresOn: '2026-01-01' }] })
    expect(checkWorkRights(e, onsite('GB'), 'not_mentioned', TODAY).status).toBe('unconfirmed')
  })
})

describe('checkRelocation', () => {
  const inFrance = elig({ currentCountry: 'FR', citizenships: ['ES'] })

  it('none when the user lives in a job country', () => {
    expect(checkRelocation(inFrance, onsite('FR', 'GB'), [])).toBe('none')
  })

  it('unconfirmed when on-site elsewhere and not a target country', () => {
    expect(checkRelocation(inFrance, onsite('IE'), ['France'])).toBe('unconfirmed')
  })

  it('none when the job country is one of the target countries (names and aliases accepted)', () => {
    expect(checkRelocation(inFrance, onsite('IE'), ['Ireland'])).toBe('none')
    expect(checkRelocation(inFrance, onsite('GB'), ['UK'])).toBe('none')
  })

  it('applies to basedInRequired, hybrid and remote_in_country, but not remote_region or remote_anywhere', () => {
    expect(checkRelocation(inFrance, { countries: ['IE'], mode: 'unknown', basedInRequired: true }, [])).toBe('unconfirmed')
    expect(checkRelocation(inFrance, { countries: ['IE'], mode: 'hybrid' }, [])).toBe('unconfirmed')
    expect(checkRelocation(inFrance, { countries: ['IE'], mode: 'remote_in_country' }, [])).toBe('unconfirmed')
    expect(checkRelocation(inFrance, { countries: ['IE'], mode: 'remote_region' }, [])).toBe('none')
    expect(checkRelocation(inFrance, { countries: [], mode: 'remote_anywhere' }, [])).toBe('none')
  })

  it('unknown when the job countries or the current country are missing', () => {
    expect(checkRelocation(inFrance, onsite(), [])).toBe('unknown')
    expect(checkRelocation(elig(), onsite('IE'), [])).toBe('unknown')
  })
})

describe('checkPay', () => {
  const floors = elig({
    salaryFloors: [
      { currency: 'EUR', floor: 90000, target: 100000 },
      { currency: 'GBP', floor: 85000, target: null },
    ],
  })
  const eur = (min: number | null, max: number | null, period: JobSalary['period'] = 'year'): JobSalary =>
    ({ min, max, currency: 'EUR', period })

  it('below floor when max < floor', () => {
    expect(checkPay(floors, eur(70000, 85000)))
      .toEqual({ status: 'below_floor', belowTarget: true, floor: 90000, target: 100000 })
  })

  it('straddles when min < floor <= max', () => {
    expect(checkPay(floors, eur(78000, 129800)))
      .toEqual({ status: 'straddles_floor', belowTarget: false, floor: 90000, target: 100000 })
    expect(checkPay(floors, eur(78000, 90000)).status).toBe('straddles_floor')
  })

  it('ok when min >= floor, including a missing max', () => {
    expect(checkPay(floors, eur(95000, 110000)).status).toBe('ok')
    expect(checkPay(floors, eur(90000, null))).toEqual({ status: 'ok', belowTarget: false, floor: 90000, target: 100000 })
  })

  it('straddles when only one end is stated and it cannot confirm the floor', () => {
    expect(checkPay(floors, eur(80000, null)).status).toBe('straddles_floor')
    expect(checkPay(floors, eur(null, 120000)).status).toBe('straddles_floor')
  })

  it('belowTarget when max < target even when the floor is met', () => {
    expect(checkPay(floors, eur(92000, 98000))).toEqual({ status: 'ok', belowTarget: true, floor: 90000, target: 100000 })
  })

  it('belowTarget is false without a target', () => {
    expect(checkPay(floors, { min: 70000, max: 80000, currency: 'GBP', period: 'year' }))
      .toEqual({ status: 'below_floor', belowTarget: false, floor: 85000, target: null })
  })

  it('no floor for the currency', () => {
    expect(checkPay(floors, { min: 100000, max: 150000, currency: 'USD', period: 'year' }))
      .toEqual({ status: 'no_floor_for_currency', belowTarget: false })
  })

  it('matches currency case-insensitively', () => {
    expect(checkPay(floors, { min: 70000, max: 80000, currency: 'eur', period: 'year' }).status).toBe('below_floor')
  })

  it.each(['month', 'day', 'hour'] as const)('a %s salary is unknown (no conversion)', (period) => {
    expect(checkPay(floors, eur(5000, 6000, period))).toEqual({ status: 'unknown', belowTarget: false })
  })

  it('no salary, or no figures, is unknown', () => {
    expect(checkPay(floors, null)).toEqual({ status: 'unknown', belowTarget: false })
    expect(checkPay(floors, eur(null, null)).status).toBe('unknown')
  })
})
