import { describe, expect, it } from 'vitest'
import { buildVault } from './build'
import { capabilityMeta } from './capability-meta'
import { deleteDetail, statusLine } from './capability-labels'
import { vaultSource } from './__fixtures__/source'

describe('capabilityMeta', () => {
  const meta = capabilityMeta(buildVault(vaultSource() as never))

  it('counts the evidence that demonstrates a capability and gives its status', () => {
    // a1 demonstrates Release management (s1), confirmed.
    expect(meta.s1).toEqual({ status: 'proven', evidence: 1, links: 1 })
  })

  it('counts a capability only a role uses as proven, with no evidence but one link to lose', () => {
    // Experience e1 uses Jira (s2) through ExperienceSkill; nothing demonstrates it.
    expect(meta.s2).toEqual({ status: 'proven', evidence: 0, links: 1 })
  })

  it('marks a capability backed only by a certification as certified, with no evidence', () => {
    // The PMP certification covers Agile (s3).
    expect(meta.s3).toEqual({ status: 'certified', evidence: 0, links: 0 })
  })

  it('marks one that is only listed as claimed', () => {
    expect(meta.t2).toEqual({ status: 'claimed', evidence: 0, links: 0 })
  })

  it('has an entry for every capability note, and nothing else', () => {
    // The fixture's tool "jira " clashes with the skill "Jira" (s2), which wins, so it is not a note.
    expect(Object.keys(meta).sort()).toEqual(['c1', 's1', 's2', 's3', 't2'])
  })
})

describe('capability wording', () => {
  const meta = capabilityMeta(buildVault(vaultSource() as never))

  it('shows the evidence count, and explains Proven when only a role or project uses it', () => {
    expect(statusLine(meta.s1)).toBe('Proven · 1 evidence item')
    expect(statusLine(meta.s2)).toBe('Proven · used by 1 role or project')
    expect(statusLine(meta.s3)).toBe('Certified')
    expect(statusLine(meta.t2)).toBe('Claimed only')
  })

  it('says what deleting a capability drops, including links from roles and projects', () => {
    expect(deleteDetail(meta.s1)).toBe('along with its links to 1 evidence item')
    expect(deleteDetail(meta.s2)).toBe('along with its links to 1 role or project that uses it')
    expect(deleteDetail({ status: 'proven', evidence: 2, links: 5 })).toBe('along with its links to 2 evidence items and 3 roles or projects that use it')
    expect(deleteDetail(meta.t2)).toBeUndefined()
    expect(deleteDetail(undefined)).toBeUndefined()
  })
})
