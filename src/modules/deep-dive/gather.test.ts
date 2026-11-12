import { describe, expect, it } from 'vitest'
import { emptySearchProfile, type Eligibility } from '@/modules/search-profile/schema'
import { computeInputsHash, resolveJobCountries, salaryFloorFromNotes, searchProfileSuggestions, sponsorshipNeeded } from './gather'

const today = new Date('2026-11-11T00:00:00Z')
const elig = (over: Partial<Eligibility>): Eligibility => ({
  currentCountry: null, citizenships: [], visas: [], salaryFloors: [], dealbreakers: [], ...over,
})

describe('resolveJobCountries', () => {
  it('merges the job row and the early assessment facts as ISO codes', () => {
    expect(resolveJobCountries(['UK', 'London'], { location: { countries: ['IE', 'GB'] } })).toEqual(['GB', 'IE'])
  })

  it('drops values it cannot read and tolerates missing facts', () => {
    expect(resolveJobCountries(['Somewhere nice', ''], null)).toEqual([])
    expect(resolveJobCountries(['DE'], { location: { countries: 'nope' } })).toEqual(['DE'])
  })
})

describe('sponsorshipNeeded', () => {
  it('is false when the user can work in a job country', () => {
    expect(sponsorshipNeeded(elig({ citizenships: ['IE'] }), ['GB'], today)).toBe(false)
    expect(sponsorshipNeeded(elig({ visas: [{ country: 'GB', expiresOn: '2027-01-01' }] as Eligibility['visas'] }), ['GB'], today)).toBe(false)
  })

  it('is true when the user can work in none of them', () => {
    expect(sponsorshipNeeded(elig({ citizenships: ['FR'] }), ['GB'], today)).toBe(true)
    expect(sponsorshipNeeded(elig({ visas: [{ country: 'GB', expiresOn: '2026-01-01' }] as Eligibility['visas'] }), ['GB'], today)).toBe(true)
  })

  it('is null without work rights or job countries', () => {
    expect(sponsorshipNeeded(elig({}), ['GB'], today)).toBeNull()
    expect(sponsorshipNeeded(elig({ citizenships: ['FR'] }), [], today)).toBeNull()
  })
})

describe('computeInputsHash', () => {
  const base = {
    profileText: 'profile', searchProfile: emptySearchProfile, jobDescription: 'jd', salaryBand: null, sourceAssessmentId: 'a1',
  }

  it('is stable for the same inputs and changes when any input changes', () => {
    const h = computeInputsHash(base)
    expect(computeInputsHash({ ...base })).toBe(h)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    for (const change of [
      { profileText: 'profile 2' },
      { searchProfile: { ...emptySearchProfile, careerGoals: 'x' } },
      { jobDescription: 'jd 2' },
      { salaryBand: '£1' },
      { sourceAssessmentId: 'a2' },
    ]) {
      expect(computeInputsHash({ ...base, ...change })).not.toBe(h)
    }
  })
})

describe('searchProfileSuggestions', () => {
  const brief = { title: 'Platform Lead', company: 'Acme' } as Parameters<typeof searchProfileSuggestions>[0]['brief']

  it('suggests a salary floor from the notes when the profile has no band', () => {
    const out = searchProfileSuggestions({ brief, searchProfile: emptySearchProfile, notes: 'Not worth it below 85,000' })
    expect(out).toEqual([expect.objectContaining({
      field: 'salaryBand', source: 'deep-dive', suggestedValue: { min: 85000, max: null, currency: 'GBP' },
    })])
  })

  it('suggests no floor without notes or when a band is set', () => {
    expect(searchProfileSuggestions({ brief, searchProfile: emptySearchProfile, notes: null })).toEqual([])
    const withBand = { ...emptySearchProfile, salaryBand: { min: 90000, max: null, currency: 'GBP' } }
    expect(searchProfileSuggestions({ brief, searchProfile: withBand, notes: 'minimum 85000' })).toEqual([])
  })

  it('suggests adding a job title that is not a target role', () => {
    const profile = { ...emptySearchProfile, roles: ['Programme Manager'] }
    expect(searchProfileSuggestions({ brief, searchProfile: profile, notes: null })).toEqual([expect.objectContaining({
      field: 'roles', source: 'deep-dive', suggestedValue: ['Programme Manager', 'Platform Lead'],
    })])
    expect(searchProfileSuggestions({ brief, searchProfile: { ...emptySearchProfile, roles: ['platform lead'] }, notes: null })).toEqual([])
  })
})

describe('salaryFloorFromNotes', () => {
  it('reads salary figures after a floor phrase', () => {
    expect(salaryFloorFromNotes('Not worth it below 85,000')).toEqual({ amount: 85000, currency: 'GBP' })
    expect(salaryFloorFromNotes('minimum £90k')).toEqual({ amount: 90000, currency: 'GBP' })
    expect(salaryFloorFromNotes('less than $120,000 is a no')).toEqual({ amount: 120000, currency: 'USD' })
    expect(salaryFloorFromNotes('minimum salary £90k')).toEqual({ amount: 90000, currency: 'GBP' })
    expect(salaryFloorFromNotes('Minimum expected: 85,000')).toEqual({ amount: 85000, currency: 'GBP' })
    expect(salaryFloorFromNotes('not worth it below €95k')).toEqual({ amount: 95000, currency: 'EUR' })
  })

  it('ignores numbers that are not salaries', () => {
    expect(salaryFloorFromNotes('less than 30 minutes commute')).toBeNull()
    expect(salaryFloorFromNotes('minimum 10 years experience')).toBeNull()
    expect(salaryFloorFromNotes('below average Glassdoor, 2019 reviews 85000')).toBeNull()
  })
})
