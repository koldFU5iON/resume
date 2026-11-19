import { describe, expect, it } from 'vitest'
import { buildVault } from '@/modules/profile-map/build'
import { writeVaultSource } from '../__fixtures__/write'
import { certificationStatus, educationStatus, isClaimedCapability, isDegreeLike } from './status'
import type { CapabilityNote } from '@/modules/profile-map/types'

const now = new Date('2026-11-18T00:00:00Z')
const cert = (over: object) => ({ name: 'PMP', issueDate: new Date('2018-05-01T00:00:00Z'), expiryDate: null, ...over })
const edu = (over: object) => ({ qualification: 'MSc', field: null, grade: null, startDate: new Date('2012-09-01T00:00:00Z'), endDate: new Date('2014-06-01T00:00:00Z'), ...over })

describe('certificationStatus', () => {
  it('held, in progress (issue date in the future or wording), expired', () => {
    expect(certificationStatus(cert({}), now)).toBe('held')
    expect(certificationStatus(cert({ issueDate: new Date('2099-01-01T00:00:00Z') }), now)).toBe('in_progress')
    expect(certificationStatus(cert({ name: 'CISSP, studying' }), now)).toBe('in_progress')
    expect(certificationStatus(cert({ expiryDate: new Date('2021-03-01T00:00:00Z') }), now)).toBe('expired')
  })

  it('a future expiry date is a held certification, not in progress', () => {
    expect(certificationStatus(cert({ expiryDate: new Date('2030-03-01T00:00:00Z') }), now)).toBe('held')
  })
})

describe('educationStatus', () => {
  it('a past end date is completed; a future one is in progress', () => {
    expect(educationStatus(edu({}), now)).toBe('completed')
    expect(educationStatus(edu({ endDate: new Date('2027-06-01T00:00:00Z') }), now)).toBe('in_progress')
  })

  it('wording in the qualification, field or grade means in progress', () => {
    expect(educationStatus(edu({ grade: 'expected: First' }), now)).toBe('in_progress')
    expect(educationStatus(edu({ qualification: 'MBA (in progress)' }), now)).toBe('in_progress')
  })

  it('no end date: in progress only when the start is within the last 6 years', () => {
    expect(educationStatus(edu({ endDate: null, startDate: new Date('2025-09-01T00:00:00Z') }), now)).toBe('in_progress')
    expect(educationStatus(edu({ endDate: null, startDate: new Date('2021-01-01T00:00:00Z') }), now)).toBe('in_progress')
    expect(educationStatus(edu({ endDate: null, startDate: new Date('2019-01-01T00:00:00Z') }), now)).toBe('undated')
    expect(educationStatus(edu({ endDate: null, startDate: new Date('2005-09-01T00:00:00Z') }), now)).toBe('undated')
  })
})

describe('isClaimedCapability (CV view of a capability)', () => {
  const src = () => {
    const s = writeVaultSource()
    const cap = (id: string, name: string) => ({ id, profileId: 'p1', name, kind: 'skill', category: null, level: null, order: 0, origin: null, yearsOfExperience: null, tags: '[]', notes: null, createdAt: new Date(0), updatedAt: new Date(0) })
    s.skills = [...(s.skills as never[]), cap('skx', 'Programme governance'), cap('sky', 'Agile coaching')] as never
    return s
  }
  const capNote = (vault: ReturnType<typeof buildVault>, name: string) =>
    [...vault.notes.values()].find((n): n is CapabilityNote => n.type === 'capability' && n.props.name === name)!

  it('a skill backed only by an in-progress certification is claimed; profile-map still calls it certified', () => {
    const s = src()
    ;(s.certifications as Array<{ id: string; skills: unknown[] }>).find((c) => c.id === 'wc2')!.skills = [{ skillId: 'skx', status: 'confirmed' }]
    const vault = buildVault(s)
    expect(capNote(vault, 'Programme governance').props.status).toBe('certified')
    expect(isClaimedCapability(vault, capNote(vault, 'Programme governance'), now)).toBe(true)
  })

  it('a skill backed by a held certification stays certified, and one with evidence stays proven', () => {
    const s = src()
    ;(s.certifications as Array<{ id: string; skills: unknown[] }>).find((c) => c.id === 'wc1')!.skills = [{ skillId: 'sky', status: 'confirmed' }]
    const vault = buildVault(s)
    expect(isClaimedCapability(vault, capNote(vault, 'Agile coaching'), now)).toBe(false)
    expect(isClaimedCapability(vault, capNote(vault, 'Release management'), now)).toBe(false)
  })

  it('one held and one in-progress certification: not claimed', () => {
    const s = src()
    for (const id of ['wc1', 'wc2']) (s.certifications as Array<{ id: string; skills: unknown[] }>).find((c) => c.id === id)!.skills = [{ skillId: 'skx', status: 'confirmed' }]
    const vault = buildVault(s)
    expect(isClaimedCapability(vault, capNote(vault, 'Programme governance'), now)).toBe(false)
  })
})

describe('isDegreeLike', () => {
  it('treats degrees, diplomas and school qualifications as education', () => {
    for (const q of ['BSc', 'MSc in Supply chain', 'Bachelor of Arts', 'MBA', 'Higher Diploma in Computing', 'Postgraduate Certificate in Education', 'PhD', 'Leaving Certificate', 'Degree 3', 'Certificate of Higher Education', 'National Certificate (NCEA Level 3)']) expect(isDegreeLike(q), q).toBe(true)
  })
  it('keeps a short course or certificate out of education', () => {
    for (const q of ['Certificate in On-screen Presenting', 'Short course in negotiation', 'Data bootcamp', 'Workshop: pricing', 'Leadership training programme']) expect(isDegreeLike(q), q).toBe(false)
  })
})
