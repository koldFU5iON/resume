import { describe, expect, it } from 'vitest'
import { activityOwnedBy, roleOwnEvidence } from './ownership'

it('matches evidence owned through a role or a project of the profile', () => {
  expect(activityOwnedBy('p1')).toEqual({ OR: [{ experience: { profileId: 'p1' } }, { project: { profileId: 'p1' } }] })
})

describe('roleOwnEvidence', () => {
  const rows = [
    { id: 'a', projectId: null },
    { id: 'b', projectId: 'p1' },
    { id: 'c', projectId: 'elsewhere' },
  ]
  it('leaves out activities labelled with one of the profile\'s projects, in order', () => {
    expect(roleOwnEvidence(rows, new Set(['p1'])).map((r) => r.id)).toEqual(['a', 'c'])
  })
  it('keeps everything when the profile has no projects', () => {
    expect(roleOwnEvidence(rows, new Set()).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
})
