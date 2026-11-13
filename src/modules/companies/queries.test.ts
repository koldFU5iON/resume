import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { isUkOrUnknownJob, sponsorStatusFrom, type SponsorEntry } from './queries'

const asOf = new Date('2026-11-11T05:30:00Z')
const entry = (route: string, typeRating = 'Worker (A rating)', orgName = 'Acme Ltd'): SponsorEntry =>
  ({ orgName, townCity: 'London', typeRating, route })

describe('sponsorStatusFrom', () => {
  it('is licensed with the best Skilled Worker rating, Skilled Worker entries first', () => {
    const s = sponsorStatusFrom(
      [entry('Creative Worker'), entry('Skilled Worker', 'Worker (B rating)', 'Acme B'), entry('Skilled Worker', 'Worker (A rating)', 'Acme A')],
      asOf, true,
    )
    expect(s).toMatchObject({ result: 'licensed', rating: 'A', totalEntries: 3, registerAsOf: asOf })
    expect(s.entries.map((e) => e.route)).toEqual(['Skilled Worker', 'Skilled Worker', 'Creative Worker'])
  })

  it('reports a B rating when that is the only Skilled Worker licence', () => {
    expect(sponsorStatusFrom([entry('Skilled Worker', 'Worker (B rating)')], asOf, true).rating).toBe('B')
  })

  it('is licensed_other_route without a Skilled Worker licence', () => {
    expect(sponsorStatusFrom([entry('Creative Worker')], asOf, true)).toMatchObject({ result: 'licensed_other_route', rating: null })
  })

  it('is not_listed for a matched company with no current licence', () => {
    expect(sponsorStatusFrom([], asOf, true).result).toBe('not_listed')
  })

  it('is unknown with no company match or no complete import', () => {
    expect(sponsorStatusFrom([entry('Skilled Worker')], asOf, false).result).toBe('unknown')
    expect(sponsorStatusFrom([entry('Skilled Worker')], null, true).result).toBe('unknown')
  })

  it('caps the listed entries', () => {
    const many = Array.from({ length: 8 }, (_, i) => entry('Skilled Worker', 'Worker (A rating)', `Org ${i}`))
    const s = sponsorStatusFrom(many, asOf, true)
    expect(s.entries).toHaveLength(5)
    expect(s.totalEntries).toBe(8)
  })
})

describe('isUkOrUnknownJob', () => {
  it('is true for UK jobs, cities only and no location', () => {
    expect(isUkOrUnknownJob(['UK'])).toBe(true)
    expect(isUkOrUnknownJob(['London', 'United Kingdom'])).toBe(true)
    expect(isUkOrUnknownJob(['London'])).toBe(true)
    expect(isUkOrUnknownJob([])).toBe(true)
  })

  it('is false when the countries are known and none is the UK', () => {
    expect(isUkOrUnknownJob(['France'])).toBe(false)
    expect(isUkOrUnknownJob(['Paris, France', 'DE'])).toBe(false)
  })
})
