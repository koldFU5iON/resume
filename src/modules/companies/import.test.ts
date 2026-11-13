import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { companiesFromRegister, selectForJobs } from './import'
import type { RegisterRow } from './sponsor-register'

const row = (orgName: string, townCity = 'London'): RegisterRow =>
  ({ orgName, townCity, county: null, typeRating: 'Worker (A rating)', route: 'Skilled Worker' })

describe('companiesFromRegister', () => {
  it('makes one company per normalised legal name and gathers trading names as aliases', () => {
    const companies = companiesFromRegister([
      row('The Real Good Dental Company Limited T/A Breeze Family Dental Care'),
      row('The Real Good Dental Company Ltd T/A Lux Dental Care', 'Leeds'),
      row('Acme Ltd'),
      row('ACME LIMITED', 'Leeds'),
    ])
    expect(companies).toEqual([
      {
        name: 'The Real Good Dental Company Limited',
        normalizedName: 'real good dental company',
        aliases: ['breeze family dental care', 'lux dental care'],
      },
      { name: 'Acme Ltd', normalizedName: 'acme', aliases: [] },
    ])
  })
})

describe('selectForJobs', () => {
  const register = [
    row('Anthropic Limited'),
    row('Anthropic Limited', 'Manchester'),
    row('BRANOS OXFORD LTD T/A LILO'),
    row('Subway T/A Eat Fresh Ltd'),
    row('Other Sandwich Co Ltd T/A Eat Fresh'),
    row('Unrelated Ltd'),
  ]

  it('keeps only register companies named in jobs, by exact legal name', () => {
    const { companies, rows } = selectForJobs(register, ['Anthropic'])
    expect(companies.map((c) => c.normalizedName)).toEqual(['anthropic'])
    expect(rows).toHaveLength(2)
  })

  it('selects by a trading name used by exactly one register company', () => {
    const { companies } = selectForJobs(register, ['Lilo'])
    expect(companies).toEqual([{ name: 'BRANOS OXFORD LTD', normalizedName: 'branos oxford', aliases: ['lilo'] }])
  })

  it('selects nothing for a trading name several companies use', () => {
    expect(selectForJobs(register, ['Eat Fresh']).rows).toEqual([])
  })

  it('selects nothing for names not in the register, and dedupes names that resolve to one company', () => {
    expect(selectForJobs(register, ['Nope Ltd']).rows).toEqual([])
    const { companies } = selectForJobs(register, ['Anthropic', 'ANTHROPIC LIMITED', 'anthropic ltd'])
    expect(companies).toHaveLength(1)
  })

  it('ignores a trading name typed in a job: only the legal part is matched', () => {
    expect(selectForJobs(register, ['Fake Holdings T/A Lilo']).rows).toEqual([])
  })
})
