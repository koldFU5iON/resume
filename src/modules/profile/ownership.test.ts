import { describe, expect, it } from 'vitest'
import { activityOwnedBy, isProjectEvidence, projectEvidenceOf, roleOwnEvidence } from './ownership'

it('matches evidence owned through a role or a project of the profile', () => {
  expect(activityOwnedBy('p1')).toEqual({ experience: { profileId: 'p1' } })
})

describe('who holds an activity', () => {
  const roles = new Map<string, string | null>([['p1', 'e1'], ['pNoRole', null]])
  const row = (id: string, experienceId: string | null, projectId: string | null) => ({ id, experienceId, projectId })
  const rows = [
    row('roleOnly', 'e1', null),
    row('projectOnly', null, 'p1'),
    row('both', 'e1', 'p1'),
    row('otherRole', 'e2', 'p1'),
    row('projectWithoutRole', 'e1', 'pNoRole'),
    row('unknownProject', 'e1', 'elsewhere'),
  ]
  const ids = (l: { id: string }[]) => l.map((r) => r.id)

  it('reads an activity as its project\'s when it has no role of its own, or the project\'s role', () => {
    const ofProject = (pid: string, role: string | null) => ids(projectEvidenceOf(rows.filter((r) => r.projectId === pid), role))
    expect(ofProject('p1', 'e1')).toEqual(['projectOnly', 'both'])
  })
  it('keeps the rest with the role, so every activity is held exactly once', () => {
    expect(ids(roleOwnEvidence(rows, roles))).toEqual(['roleOnly', 'otherRole', 'projectWithoutRole', 'unknownProject'])
    const held = [...rows.filter((r) => r.projectId && roles.has(r.projectId) && projectEvidenceOf([r], roles.get(r.projectId)!).length), ...roleOwnEvidence(rows, roles)]
    expect(ids(held).sort()).toEqual(ids(rows).sort())
  })
  it('trusts the activity\'s own role when it disagrees with its project\'s role', () => {
    expect(isProjectEvidence(row('x', 'e2', 'p1'), roles)).toBe(false)
    expect(isProjectEvidence(row('y', 'e1', 'pNoRole'), roles)).toBe(false)
  })
  it('keeps everything with the role when the profile has no projects', () => {
    expect(ids(roleOwnEvidence(rows, new Map()))).toEqual(ids(rows))
  })
})
