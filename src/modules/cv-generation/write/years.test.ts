import { describe, expect, it } from 'vitest'
import { careerYears, statedYears, yearsPhrase } from './years'

const now = new Date('2026-11-19T00:00:00Z')
const d = (y: number, m = 1) => new Date(Date.UTC(y, m - 1, 1))

describe('years of experience', () => {
  it('counts from the EARLIEST start across every employer, however old', () => {
    expect(careerYears([d(2019), d(2002), d(2012)], now)).toBe(24)
    expect(careerYears([], now)).toBe(0)
    expect(careerYears([null, undefined], now)).toBe(0)
  })

  it('states nothing for a 3-year career', () => {
    expect(statedYears([d(2023, 11)], now)).toBeNull()
    expect(statedYears([d(2017, 1)], now)).toBeNull() // 9 years
  })

  it('floors a 12-year career to 10+', () => {
    expect(statedYears([d(2014, 6)], now)).toBe(10)
    expect(yearsPhrase(10)).toBe('10+ years')
  })

  it('floors a 24-year career to 20+, not 25', () => {
    expect(statedYears([d(2002, 11)], now)).toBe(20)
    expect(statedYears([d(2001, 11)], now)).toBe(25)
    expect(yearsPhrase(20)).toBe('20+ years')
  })
})
