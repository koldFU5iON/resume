import { describe, expect, it } from 'vitest'
import { buildVault } from './build'
import { capabilityMeta } from './capability-meta'
import { vaultSource } from './__fixtures__/source'

describe('capabilityMeta', () => {
  const meta = capabilityMeta(buildVault(vaultSource() as never))

  it('counts the evidence that demonstrates a capability and gives its status', () => {
    // a1 demonstrates Release management (s1), confirmed.
    expect(meta.s1).toEqual({ status: 'proven', evidence: 1 })
  })

  it('marks a capability backed only by a certification as certified, with no evidence', () => {
    // The PMP certification covers Agile (s3).
    expect(meta.s3).toEqual({ status: 'certified', evidence: 0 })
  })

  it('marks one that is only listed as claimed', () => {
    expect(meta.t2).toEqual({ status: 'claimed', evidence: 0 })
  })

  it('has an entry for every capability note, and nothing else', () => {
    // The fixture's tool "jira " clashes with the skill "Jira" (s2), which wins, so it is not a note.
    expect(Object.keys(meta).sort()).toEqual(['c1', 's1', 's2', 's3', 't2'])
  })
})
