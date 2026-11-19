import { describe, expect, it } from 'vitest'
import {
  BUDGET_CAPS, BUDGET_FLOORS, FLAT_CAPS, FLAT_FLOORS, MAX_EMPLOYERS, MAX_HEADER_ONLY_EMPLOYERS, MAX_TOTAL_BULLETS,
  MIN_EMPLOYERS_WITH_BULLETS, allocateByRecency, clampBudgetValue, type RecencyClaim,
} from './caps'

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)

describe('caps', () => {
  it('are the agreed numbers', () => {
    expect(MAX_EMPLOYERS).toBe(4)
    expect(MAX_HEADER_ONLY_EMPLOYERS).toBe(4)
    expect(MAX_TOTAL_BULLETS).toBe(20)
    expect(FLAT_CAPS).toEqual({ skills: 12, tools: 10, competencies: 8, certifications: 4, education: 2, projects: 2 })
    expect(BUDGET_CAPS.experiences).toBe(MAX_EMPLOYERS)
  })

  it('has no padding floor on any flat section (education keeps 1 so the Brief cannot zero it)', () => {
    expect(MIN_EMPLOYERS_WITH_BULLETS).toBe(4)
    expect(FLAT_FLOORS).toEqual({ skills: 0, tools: 0, competencies: 0, certifications: 0, education: 1, projects: 0 })
    for (const s of Object.keys(BUDGET_CAPS) as Array<keyof typeof BUDGET_CAPS>) expect(BUDGET_FLOORS[s]).toBeLessThanOrEqual(BUDGET_CAPS[s])
  })

  it('clamps a budget into [floor, ceiling]', () => {
    expect(clampBudgetValue('certifications', 3)).toBe(3)
    expect(clampBudgetValue('certifications', 9)).toBe(4)
    expect(clampBudgetValue('competencies', 5)).toBe(5)
    expect(clampBudgetValue('experiences', 1)).toBe(4)
    expect(clampBudgetValue('skills', 99)).toBe(12)
    expect(clampBudgetValue('education', 0)).toBe(1)
    expect(clampBudgetValue('education', 3)).toBe(2)
    expect(clampBudgetValue('projects', 0)).toBe(0)
    expect(clampBudgetValue('projects', 9)).toBe(2)
    expect(clampBudgetValue('tools', Number.NaN)).toBe(0)
  })
})

describe('allocateByRecency', () => {
  const emp = (relevance: number, over: Partial<RecencyClaim> = {}): RecencyClaim => ({ relevance, supply: 30, roles: 1, yearsSinceEnd: 0, tenureYears: 6, ...over })
  // Synthetic careers: employers newest first.
  const long = (rel = 3) => [emp(rel), emp(rel, { yearsSinceEnd: 3 }), emp(rel, { yearsSinceEnd: 8 }), emp(rel, { yearsSinceEnd: 14 })]

  it('gives a long career about 12-16 bullets, recency-banded: current 5-7, previous 3-4, older 2-3, very old 1-2', () => {
    const r = allocateByRecency(long())
    expect(r).toEqual([6, 3, 2, 2])
    expect(sum(r)).toBeGreaterThanOrEqual(12)
    expect(allocateByRecency(long(5))).toEqual([7, 4, 3, 2])
    expect(sum(allocateByRecency(long(5)))).toBeLessThanOrEqual(16)
    expect(allocateByRecency(long(1))).toEqual([5, 3, 2, 1])
  })

  it('allows 8 for the current employer only with 3 or more roles there', () => {
    expect(allocateByRecency([emp(5), emp(3, { yearsSinceEnd: 2 })])[0]).toBe(7)
    expect(allocateByRecency([emp(5, { roles: 3 }), emp(3, { yearsSinceEnd: 2 })])[0]).toBe(8)
    expect(allocateByRecency([emp(1, { roles: 3 }), emp(3, { yearsSinceEnd: 2 })])[0]).toBe(6)
  })

  it('shifts by relevance at most one, and never reorders the bands', () => {
    for (let a = 1; a <= 5; a++) for (let b = 1; b <= 5; b++) for (let c = 1; c <= 5; c++) {
      const r = allocateByRecency([emp(a), emp(b, { yearsSinceEnd: 3 }), emp(c, { yearsSinceEnd: 8 })])
      expect(r[0]).toBeGreaterThanOrEqual(5)
      expect(r[0]).toBeLessThanOrEqual(7)
      expect(r[1]).toBeGreaterThanOrEqual(3)
      expect(r[1]).toBeLessThanOrEqual(4)
      expect(r[2]).toBeGreaterThanOrEqual(2)
      expect(r[2]).toBeLessThanOrEqual(3)
      expect(r[0]).toBeGreaterThan(r[1])
    }
  })

  it('gives a short career proportionally fewer, and never more than the evidence supplies', () => {
    expect(allocateByRecency([emp(3, { tenureYears: 1.2 })])).toEqual([4])
    expect(allocateByRecency([emp(3, { tenureYears: 1 }), emp(3, { yearsSinceEnd: 1, tenureYears: 1 })])).toEqual([4, 3])
    expect(allocateByRecency([emp(5, { supply: 3 }), emp(3, { supply: 1, yearsSinceEnd: 2 })])).toEqual([3, 1])
    expect(allocateByRecency([emp(3, { supply: 0 })])).toEqual([0])
    expect(allocateByRecency([])).toEqual([])
  })

  it('takes a plain 2-employer career of 9 years about 8-10 bullets', () => {
    expect(sum(allocateByRecency([emp(3, { tenureYears: 5 }), emp(3, { yearsSinceEnd: 5, tenureYears: 4 })]))).toBe(9)
  })

  it('never exceeds the total ceiling, trimming the oldest first', () => {
    const many = [emp(5, { roles: 3 }), emp(5), emp(5), emp(5), emp(5), emp(5), emp(5)].map((c, i) => ({ ...c, yearsSinceEnd: i }))
    const r = allocateByRecency(many)
    expect(sum(r)).toBeLessThanOrEqual(MAX_TOTAL_BULLETS)
    expect(r[0]).toBeGreaterThanOrEqual(5) // the newest employer is trimmed last
    expect(r[6]).toBeLessThanOrEqual(r[0])
  })

  it('is deterministic', () => {
    expect(allocateByRecency(long(4))).toEqual(allocateByRecency(long(4)))
  })

  it('property: whole numbers, never above supply or the total ceiling, never reordering bands', () => {
    let seed = 7
    const rnd = (n: number) => { seed = (seed * 48271) % 2147483647; return seed % n }
    for (let k = 0; k < 400; k++) {
      const n = 1 + rnd(5)
      const claims = Array.from({ length: n }, (_, i): RecencyClaim => ({ relevance: 1 + rnd(5), supply: rnd(12), roles: 1 + rnd(4), yearsSinceEnd: i === 0 ? 0 : rnd(25), tenureYears: rnd(12) }))
      const r = allocateByRecency(claims)
      expect(r).toHaveLength(n)
      expect(sum(r)).toBeLessThanOrEqual(MAX_TOTAL_BULLETS)
      r.forEach((c, i) => {
        expect(Number.isInteger(c)).toBe(true)
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(claims[i].supply)
        expect(c).toBeLessThanOrEqual(i === 0 ? 8 : i === 1 ? 4 : 3)
      })
    }
  })
})
