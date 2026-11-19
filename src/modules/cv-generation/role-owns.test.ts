// Golden check for the role-owns switch (design doc §13, step 3a): giving a project-only activity its
// project's role must change nothing any reader sees. Every reader is run on the same profile twice,
// once with the activities owned by their project only (today's data) and once with each also carrying
// the role (the data after the assignment step), and the outputs must be identical.
import { describe, expect, it } from 'vitest'
import { buildVault } from '@/modules/profile-map/build'
import { profileMap } from '@/modules/profile-map/map'
import { renderNote } from '@/modules/profile-map/render'
import { vaultSource } from '@/modules/profile-map/__fixtures__/source'
import { toProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { NOW } from '@/modules/profile-readiness/__fixtures__/profiles'
import { checkProfileReadiness } from '@/modules/profile-readiness'
import { buildCandidates, candidatesToPrompt, profileOutline } from './candidates'
import { LONG_NOTES, atomRow } from './__fixtures__/projects'
import { projectRow } from './__fixtures__/write'
import { readerFingerprint, sameFingerprint, simulateAssignment } from './role-owns-check'

const atoms = [
  atomRow('pa1', 'Built the campaign platform used by every team'),
  atomRow('pa2', 'Rebuilt the operating model', 'turnaround 3 weeks to 1 hour, a 75% lead-time cut', { highlighted: true, order: 1 }),
  atomRow('pa3', 'Reached 2.4M people, including registered voters', null, { order: 2 }),
  atomRow('pa4', 'Led the review programme', null, { kind: 'responsibility', order: 3 }),
]

/** The fixture profile with a role, two projects (one archived) and the atoms on the first project. */
function source(assigned: boolean) {
  const src = vaultSource()
  const rows = atoms.map((a) => ({ ...a, projectId: 'pj1', experienceId: assigned ? 'e1' : null }))
  src.projects = [
    projectRow('pj1', 'Campaign Platform', 'A platform for public campaign pages.', { experienceId: 'e1', notes: LONG_NOTES, activities: rows }),
    projectRow('pj2', 'Old Pilot', 'A shelved pilot.', { experienceId: 'e1', status: 'archived', activities: [{ ...atomRow('pb1', 'Piloted the old thing'), projectId: 'pj2', experienceId: assigned ? 'e1' : null }] }),
  ] as never
  if (assigned) {
    // The role's own relation now also returns the activities that carry its id.
    src.experiences[0].activities = [...src.experiences[0].activities, ...src.projects.flatMap((p) => p.activities)] as never
  }
  return src
}

describe('assigning project-only activities to their role changes nothing a reader sees', () => {
  const before = buildVault(source(false))
  const after = buildVault(source(true))

  it('builds the same vault', () => {
    expect(after).toEqual(before)
  })
  it('gives the same candidates, prompt and outline', () => {
    expect(buildCandidates(after)).toEqual(buildCandidates(before))
    expect(candidatesToPrompt(buildCandidates(after))).toBe(candidatesToPrompt(buildCandidates(before)))
    expect(profileOutline('Head', buildCandidates(after))).toBe(profileOutline('Head', buildCandidates(before)))
  })
  it('gives the same readiness findings, profile map, snapshot and rendered notes', () => {
    expect(checkProfileReadiness(after, NOW)).toEqual(checkProfileReadiness(before, NOW))
    expect(profileMap(after)).toEqual(profileMap(before))
    expect(serializeProfileForLLM(toProfileSnapshot(after))).toBe(serializeProfileForLLM(toProfileSnapshot(before)))
    for (const id of ['e1', 'pj1', 'pj2', 'pa1', 'pb1']) expect(renderNote(after, id)).toBe(renderNote(before, id))
  })
  it('lists each activity once, under its project, and counts it once', () => {
    const ids = after.byType.evidence
    expect(new Set(ids).size).toBe(ids.length)
    expect(after.notes.get('pa1')).toMatchObject({ props: { parentId: 'pj1' } })
    expect(after.notes.get('e1')!.gist).not.toMatch(/\(\+\d+ from projects\)\s*\(\+/)
  })
  it('still holds an activity that has a role but no project directly under the role', () => {
    const src = source(true)
    expect(buildVault(src).notes.get('a1')).toMatchObject({ props: { parentId: 'e1' } })
  })
})

describe('an activity whose role disagrees with its project\'s role stays with its own role', () => {
  it('is listed once, under the role, and not under the project', () => {
    const src = source(true)
    // A third role, and an activity of e1 that names a project of the other role.
    src.experiences.push({ ...src.experiences[0], id: 'e2', company: 'Other Co', activities: [], skills: [] } as never)
    src.projects.push(projectRow('pj3', 'Other Project', 'Elsewhere.', { experienceId: 'e2', activities: [{ ...atomRow('mx1', 'Mislabelled work'), projectId: 'pj3', experienceId: 'e1' }] }) as never)
    src.experiences[0].activities = [...src.experiences[0].activities, src.projects[2].activities[0]] as never
    const vault = buildVault(src)
    expect(vault.byType.evidence.filter((id) => id === 'mx1')).toHaveLength(1)
    expect(vault.notes.get('mx1')).toMatchObject({ props: { parentId: 'e1' } })
    expect(vault.notes.get('pj3')!.links.map((l) => l.id)).not.toContain('mx1')
  })
})

describe('the verification helpers', () => {
  it('simulateAssignment gives project-only activities their role, without touching the input', () => {
    const src = source(false)
    const copy = structuredClone(src)
    const sim = simulateAssignment(src)
    expect(src).toEqual(copy)
    expect(sim.projects[0].activities.every((a) => a.experienceId === 'e1')).toBe(true)
    expect(sim.experiences[0].activities.map((a) => a.id)).toEqual(expect.arrayContaining(['a1', 'a2', 'pa1', 'pa2', 'pa3', 'pa4', 'pb1']))
    // Already assigned: nothing more to add.
    expect(simulateAssignment(source(true)).experiences[0].activities).toHaveLength(source(true).experiences[0].activities.length)
  })
  it('the fingerprint is equal before and after, and differs when a reader would notice', () => {
    expect(sameFingerprint(readerFingerprint(source(false), NOW), readerFingerprint(simulateAssignment(source(false)), NOW))).toBe(true)
    const edited = source(false)
    edited.projects[0].activities[0].description = 'Something else entirely'
    expect(sameFingerprint(readerFingerprint(source(false), NOW), readerFingerprint(edited, NOW))).toBe(false)
  })
})
