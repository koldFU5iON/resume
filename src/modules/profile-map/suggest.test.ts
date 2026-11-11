import { describe, expect, it } from 'vitest'
import { vaultSource } from './__fixtures__/source'
import { buildVault } from './build'
import { buildSuggestionPrompt, pairKey, resolveSuggestions } from './suggest'

const vault = buildVault(vaultSource())
const { prompt, refs } = buildSuggestionPrompt(vault)
const E = (id: string) => `E${refs.evidence.indexOf(id) + 1}`
const C = (id: string) => `C${refs.capabilities.indexOf(id) + 1}`

describe('buildSuggestionPrompt', () => {
  it('lists capabilities and evidence by short reference, marking existing links', () => {
    expect(prompt).toContain(`${C('s1')}: Release management (skill)`)
    expect(prompt).toContain(`${E('a1')} [achievement, Program Manager at Fictional Freight, Mar 2021 – present]: Cut release time — 6 weeks → 2 weeks (already linked: ${C('s1')})`)
  })

  it('never includes contact details', () => {
    expect(prompt).not.toMatch(/robin@example\.test|\+33 6/)
  })
})

describe('resolveSuggestions', () => {
  it('maps references to ids and drops unknown, existing, rejected and repeated links', () => {
    const result = resolveSuggestions(vault, {
      links: [
        { evidence: E('a2'), capability: C('s3'), reason: 'Ran agile standups' },
        { evidence: E('a2'), capability: C('s3'), reason: 'duplicate' },
        { evidence: E('a1'), capability: C('s1'), reason: 'already linked' },
        { evidence: E('a2'), capability: C('c1'), reason: 'rejected before' },
        { evidence: 'E99', capability: C('s1'), reason: 'unknown evidence' },
        { evidence: E('a2'), capability: 'banana', reason: 'not a reference' },
      ],
      newCapabilities: [],
    }, refs, new Set([pairKey('a2', 'c1')]))
    expect(result.links).toEqual([{ evidenceId: 'a2', capabilityId: 's3', reason: 'Ran agile standups' }])
  })

  it('keeps only genuinely new capabilities that cite real evidence', () => {
    const result = resolveSuggestions(vault, {
      links: [],
      newCapabilities: [
        { name: 'Facilitation', kind: 'competency', evidence: [E('a2'), 'E99'], reason: 'Runs standups' },
        { name: 'release Management', kind: 'skill', evidence: [E('a1')], reason: 'already listed' },
        { name: 'Kanban', kind: 'skill', evidence: ['E99'], reason: 'no real evidence' },
      ],
    }, refs, new Set())
    expect(result.newCapabilities).toEqual([{ name: 'Facilitation', kind: 'competency', evidenceIds: ['a2'], reason: 'Runs standups' }])
  })
})
