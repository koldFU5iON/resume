import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { companiesFromRegister } from './import'
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
