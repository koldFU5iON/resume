import { describe, expect, it } from 'vitest'
import type { RoleTimelineEntry } from './candidate-state'
import { computeYears, formatYearsSummary, roleShare, weightedShare, yearsStatus, type ShareProbabilities } from './years'

const TODAY = new Date('2026-11-10T12:00:00Z')

const most: ShareProbabilities = { most_of_the_role: 1, about_half: 0, small_part: 0, none: 0 }
const half: ShareProbabilities = { most_of_the_role: 0, about_half: 1, small_part: 0, none: 0 }
const small: ShareProbabilities = { most_of_the_role: 0, about_half: 0, small_part: 1, none: 0 }

function role(key: string, start: string, end: string | 'present', label = key): RoleTimelineEntry {
  const ym = (s: string) => ({ y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)) })
  return { key, label, start: ym(start), end: end === 'present' ? 'present' : ym(end) }
}

describe('share', () => {
  it('weights options most 1, about half 0.5, small part and none 0', () => {
    expect(weightedShare(most)).toBe(1)
    expect(weightedShare(half)).toBe(0.5)
    expect(weightedShare(small)).toBe(0)
    expect(weightedShare({ most_of_the_role: 0.6, about_half: 0.3, small_part: 0.1, none: 0 })).toBeCloseTo(0.75)
  })

  it('averages the two option orders', () => {
    expect(roleShare({ a: most, b: half })).toBeCloseTo(0.75)
    expect(roleShare({ a: half, b: small })).toBeCloseTo(0.25)
  })

  it('uses the one order present, and 0 when neither is', () => {
    expect(roleShare({ a: half })).toBe(0.5)
    expect(roleShare({ b: most })).toBe(1)
    expect(roleShare(undefined)).toBe(0)
  })
})

describe('computeYears', () => {
  it('counts months inclusive of start and end', () => {
    const r = computeYears({ role_1: { a: most, b: most } }, [role('role_1', '2020-01', '2020-12')], TODAY)
    expect(r.years).toBeCloseTo(1)
    expect(r.roles[0]).toMatchObject({ key: 'role_1', months: 12, counted: true })
  })

  it('counts overlapping roles once', () => {
    const timeline = [role('role_1', '2020-01', '2021-12'), role('role_2', '2021-01', '2022-12')]
    const r = computeYears({ role_1: { a: most, b: most }, role_2: { a: most, b: most } }, timeline, TODAY)
    expect(r.years).toBeCloseTo(3) // 2020-01..2022-12, not 4
    expect(r.roles.reduce((s, x) => s + x.years, 0)).toBeCloseTo(3)
  })

  it('gives an overlapping month to the role with the higher share', () => {
    const timeline = [role('role_1', '2020-01', '2020-12'), role('role_2', '2020-01', '2020-12')]
    const r = computeYears({ role_1: { a: half, b: half }, role_2: { a: most, b: most } }, timeline, TODAY)
    expect(r.years).toBeCloseTo(1)
    expect(r.roles[0].years).toBe(0)
    expect(r.roles[1].years).toBeCloseTo(1)
  })

  it('runs "present" to today\'s month', () => {
    const r = computeYears({ role_1: { a: most, b: most } }, [role('role_1', '2025-11', 'present')], TODAY)
    expect(r.roles[0].months).toBe(13) // Nov 2025 .. Nov 2026
    expect(r.years).toBeCloseTo(13 / 12)
  })

  it('clips a future end date to today', () => {
    const r = computeYears({ role_1: { a: most, b: most } }, [role('role_1', '2026-01', '2027-12')], TODAY)
    expect(r.roles[0].months).toBe(11)
  })

  it('counts a role only when its share is at least 0.5', () => {
    const timeline = [role('role_1', '2020-01', '2020-12')]
    const just = (p: number): ShareProbabilities => ({ most_of_the_role: p, about_half: 0, small_part: 1 - p, none: 0 })
    const under = computeYears({ role_1: { a: just(0.49), b: just(0.49) } }, timeline, TODAY)
    const over = computeYears({ role_1: { a: just(0.51), b: just(0.51) } }, timeline, TODAY)
    expect(under.years).toBe(0)
    expect(under.roles[0].counted).toBe(false)
    expect(over.years).toBeCloseTo(0.51)
    expect(over.roles[0].counted).toBe(true)
  })

  it('decides counting on the share averaged over both orders', () => {
    const timeline = [role('role_1', '2020-01', '2020-12')]
    // a alone would count (0.5); averaged with b (0.25) it doesn't.
    const r = computeYears({ role_1: { a: half, b: { about_half: 0.5, small_part: 0.5 } } }, timeline, TODAY)
    expect(r.roles[0].share).toBeCloseTo(0.375)
    expect(r.years).toBe(0)
  })

  it('counts a role without answers as 0', () => {
    const r = computeYears({}, [role('role_1', '2020-01', '2020-12')], TODAY)
    expect(r.years).toBe(0)
  })
})

describe('yearsStatus', () => {
  // Spec §5 years table.
  it.each([
    [5, 2.5, 'warn'],
    [10, 2.5, 'block'],
    [8, 6.5, 'warn'],
    [3, 1.5, 'warn'],
    [5, 2.0, 'block'],
  ] as const)('required %d, est %d → %s (capability low)', (required, est, status) => {
    expect(yearsStatus(est, required, 0.2)).toBe(status)
  })

  it('is met at or above the requirement', () => {
    expect(yearsStatus(5, 5, null)).toBe('met')
    expect(yearsStatus(17.9, 5, null)).toBe('met')
  })

  it('turns a block into a stretch at capability 0.70, not 0.69', () => {
    expect(yearsStatus(2.0, 5, 0.69)).toBe('block')
    expect(yearsStatus(2.0, 5, 0.7)).toBe('stretch')
    expect(yearsStatus(2.5, 10, 0.82)).toBe('stretch')
  })

  it('never uses capability to lift a warn or a met', () => {
    expect(yearsStatus(3.7, 5, 0.99)).toBe('warn')
  })

  it('stays block without a capability answer', () => {
    expect(yearsStatus(2.0, 5, null)).toBe('block')
  })
})

describe('formatYearsSummary', () => {
  it('lists the roles that add years', () => {
    const timeline = [
      role('role_1', '2024-08', 'present', 'Senior Program Manager'),
      role('role_2', '2023-11', '2024-07', 'Communications Lead'),
      role('role_3', '2022-06', '2023-10', 'PR Manager'),
      role('role_4', '2015-01', '2022-05', 'PR Officer'),
    ]
    const r = computeYears({
      role_1: { a: most, b: most }, role_2: { a: most, b: most }, role_3: { a: half, b: half }, role_4: { a: small, b: small },
    }, timeline, TODAY)
    expect(formatYearsSummary(r)).toBe('~3.8 yrs: Senior Program Manager 2.3 + Communications Lead 0.8 + PR Manager 50% × 1.4')
  })

  it('says so when no role counts', () => {
    expect(formatYearsSummary({ years: 0, roles: [] })).toBe('~0.0 yrs: no role was mostly this work')
  })
})
