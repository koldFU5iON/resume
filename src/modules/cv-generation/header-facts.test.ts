import { describe, expect, it } from 'vitest'
import { vaultOf } from '@/modules/profile-readiness/__fixtures__/profiles'
import { headerFacts, rightToWorkText } from './header-facts'

const NOW = new Date('2026-11-19T12:00:00Z')
const withProfile = (location: string | null, eligibility: object | null) =>
  vaultOf({}, {
    location,
    settings: eligibility ? { searchProfile: { eligibility }, updatedAt: NOW } : null,
  } as never)

describe('headerFacts', () => {
  it('is the location and the right to work, joined, in code from what the owner entered', () => {
    const v = withProfile('Lyon, France', { citizenships: ['GB'], visas: [{ country: 'DE', type: 'Blue Card', expiresOn: null }] })
    expect(headerFacts(v, NOW)).toBe('Lyon, France · Right to work: United Kingdom (citizen); Germany (Blue Card visa)')
  })

  it('shows only what exists: location alone, right to work alone, or nothing', () => {
    expect(headerFacts(withProfile('Lyon, France', null), NOW)).toBe('Lyon, France')
    expect(headerFacts(withProfile(null, { citizenships: ['FR'], visas: [] }), NOW)).toBe('Right to work: France (citizen)')
    expect(headerFacts(withProfile('  ', null), NOW)).toBeNull()
    expect(headerFacts(withProfile(null, { citizenships: [], visas: [] }), NOW)).toBeNull()
  })

  it('leaves out an expired visa, keeps one that expires today or later or never, and names a visa with no type', () => {
    const v = withProfile(null, { citizenships: [], visas: [
      { country: 'DE', type: 'Old permit', expiresOn: '2026-11-18' },
      { country: 'NL', type: '', expiresOn: '2026-11-19' },
      { country: 'ES', type: 'Digital Nomad', expiresOn: '2028-01-01' },
    ] })
    expect(rightToWorkText(v, NOW)).toBe('Netherlands (visa); Spain (Digital Nomad visa)')
  })

  it('lists a country once when the owner is a citizen and also holds a visa there, and never infers other countries', () => {
    const v = withProfile(null, { citizenships: ['GB'], visas: [{ country: 'GB', type: 'Settled', expiresOn: null }] })
    expect(rightToWorkText(v, NOW)).toBe('United Kingdom (citizen, Settled visa)')
  })
})
