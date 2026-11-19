import { describe, expect, it } from 'vitest'
import { MAX_FINDINGS, checkProfileReadiness } from './index'
import { NOW, careerChanger, cleanProfile, earlyCareer, longCareer, messyImport, role, vaultOf } from './__fixtures__/profiles'

describe('checkProfileReadiness', () => {
  it('produces no fix finding for a clean profile, nor for the other healthy shapes', () => {
    for (const v of [cleanProfile(), earlyCareer(), careerChanger(), longCareer()]) {
      expect(checkProfileReadiness(v, NOW).findings.filter((f) => f.severity === 'fix')).toEqual([])
    }
    expect(checkProfileReadiness(cleanProfile(), NOW)).toMatchObject({ total: 0, fixCount: 0, findings: [] })
  })

  it('finds the problems of a messy imported profile, fixes first', () => {
    const r = checkProfileReadiness(messyImport(), NOW)
    expect(r.fixCount).toBeGreaterThanOrEqual(6)
    const sev = r.findings.map((f) => f.severity)
    expect(sev).toEqual([...sev].sort((a) => (a === 'fix' ? -1 : 1)))
    for (const kind of ['thin_narrative', 'duplicate_project', 'cert_no_issuer', 'cert_status_in_name', 'experience_dates_reversed', 'contact_missing']) {
      expect(r.findings.map((f) => f.kind), kind).toContain(kind)
    }
  })

  it('has unique ids and a plain message and suggestion on every finding', () => {
    const r = checkProfileReadiness(messyImport(), NOW)
    expect(new Set(r.findings.map((f) => f.id)).size).toBe(r.findings.length)
    for (const f of r.findings) {
      expect(f.title.length).toBeGreaterThan(0)
      expect(f.message.length).toBeGreaterThan(0)
      expect(f.suggestion.length).toBeGreaterThan(0)
    }
  })

  it('caps the list and reports the real total', () => {
    const many = vaultOf({ experiences: Array.from({ length: 40 }, (_, i) => role(`r${i}`, `Co ${i}`, 'Analyst', '2020-01', null, '')) })
    const r = checkProfileReadiness(many, NOW)
    expect(r.findings).toHaveLength(MAX_FINDINGS)
    expect(r.total).toBeGreaterThan(MAX_FINDINGS)
    expect(r.fixCount).toBeGreaterThan(MAX_FINDINGS)
  })

  it('is deterministic', () => {
    expect(checkProfileReadiness(messyImport(), NOW)).toEqual(checkProfileReadiness(messyImport(), NOW))
  })
})
