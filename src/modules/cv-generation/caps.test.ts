import { describe, expect, it } from 'vitest'
import {
  BUDGET_CAPS, FLAT_CAPS, MAX_ACTIVITIES_PER_EMPLOYER, MAX_EMPLOYERS, MAX_HEADER_ONLY_EMPLOYERS, MIN_ACTIVITIES_PER_EMPLOYER,
  TOTAL_ACTIVITY_BUDGET, allocateBullets,
} from './caps'

const claim = (relevance: number, supply = 30) => ({ relevance, supply })
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)

describe('caps', () => {
  it('are the agreed numbers', () => {
    expect(MAX_EMPLOYERS).toBe(4)
    expect(MAX_HEADER_ONLY_EMPLOYERS).toBe(4)
    expect(TOTAL_ACTIVITY_BUDGET).toBe(14)
    expect([MIN_ACTIVITIES_PER_EMPLOYER, MAX_ACTIVITIES_PER_EMPLOYER]).toEqual([2, 6])
    expect(FLAT_CAPS).toEqual({ skills: 12, tools: 10, competencies: 6, certifications: 4, education: 3, projects: 2 })
    expect(BUDGET_CAPS.experiences).toBe(MAX_EMPLOYERS)
  })
})

describe('allocateBullets', () => {
  it('splits in proportion to relevance', () => {
    // 14 across weights 5:3:2 -> 7:4.2:2.8, the first capped at 6, the rest re-share 8 as 4.8:3.2.
    expect(allocateBullets([claim(5), claim(3), claim(2)])).toEqual([6, 5, 3])
  })

  it('gives equal relevance an equal split', () => {
    expect(allocateBullets([claim(3), claim(3)])).toEqual([6, 6])
    expect(allocateBullets([claim(3), claim(3), claim(3), claim(3)]).sort()).toEqual([3, 3, 4, 4])
  })

  it('never goes below the minimum or above the maximum', () => {
    const r = allocateBullets([claim(5), claim(1), claim(1), claim(1)])
    expect(r[0]).toBe(6)
    for (const n of r) {
      expect(n).toBeGreaterThanOrEqual(MIN_ACTIVITIES_PER_EMPLOYER)
      expect(n).toBeLessThanOrEqual(MAX_ACTIVITIES_PER_EMPLOYER)
    }
    expect(sum(r)).toBeLessThanOrEqual(TOTAL_ACTIVITY_BUDGET)
  })

  it('is driven by relevance, not by position (recency)', () => {
    // The newest employer is least relevant; the oldest is the lead-with one.
    const r = allocateBullets([claim(1), claim(2), claim(5)])
    expect(r).toEqual([3, 5, 6])
  })

  it('gives a lone employer the maximum', () => {
    expect(allocateBullets([claim(1)])).toEqual([6])
  })

  it('never gives an employer more than it can supply, and passes the rest on', () => {
    expect(allocateBullets([claim(5, 3), claim(1, 30)])).toEqual([3, 6])
    expect(allocateBullets([claim(3, 1), claim(3, 30)])).toEqual([1, 6]) // fewer than the minimum only when that is all there is
    expect(allocateBullets([claim(3, 0)])).toEqual([0])
  })

  it('is deterministic and handles no employers', () => {
    expect(allocateBullets([])).toEqual([])
    const claims = [claim(4), claim(4), claim(2)]
    expect(allocateBullets(claims)).toEqual(allocateBullets(claims))
  })

  it('holds the total, minimum and maximum for every mix of up to four employers', () => {
    for (let a = 1; a <= 5; a++) for (let b = 1; b <= 5; b++) for (let c = 1; c <= 5; c++) for (let d = 1; d <= 5; d++) {
      for (const supply of [2, 4, 30]) {
        const claims = [claim(a, supply), claim(b, supply), claim(c, supply), claim(d, supply)]
        const r = allocateBullets(claims)
        expect(sum(r)).toBeLessThanOrEqual(TOTAL_ACTIVITY_BUDGET)
        r.forEach((n, i) => {
          expect(n).toBeGreaterThanOrEqual(Math.min(MIN_ACTIVITIES_PER_EMPLOYER, supply))
          expect(n).toBeLessThanOrEqual(Math.min(MAX_ACTIVITIES_PER_EMPLOYER, supply))
          expect(Number.isInteger(n)).toBe(true)
          // More relevant never gets fewer.
          claims.forEach((o, j) => { if (o.relevance > claims[i].relevance) expect(r[j]).toBeGreaterThanOrEqual(n) })
        })
        // The budget is used in full whenever the supplies allow it.
        if (supply >= 4) expect(sum(r)).toBe(TOTAL_ACTIVITY_BUDGET)
      }
    }
  })

  it('keeps the most relevant floors when the minimums alone exceed the total', () => {
    const r = allocateBullets([claim(1), claim(5), claim(3)], { total: 5, min: 2, max: 6 })
    expect(sum(r)).toBeLessThanOrEqual(5)
    expect(r[1]).toBeGreaterThanOrEqual(r[2])
  })
})
