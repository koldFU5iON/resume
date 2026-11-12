import { describe, expect, it } from 'vitest'
import { emptySearchProfile, type Eligibility } from '@/modules/search-profile/schema'
import { computeInputsHash, resolveJobCountries, sponsorshipNeeded } from './gather'

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
