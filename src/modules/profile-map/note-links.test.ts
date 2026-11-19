import { describe, expect, it } from 'vitest'
import { buildVault } from './build'
import { noteCapabilityLinks } from './note-links'
import { t, vaultSource } from './__fixtures__/source'

const base = vaultSource()
const evidence = (id: string, projectId: string, over = {}) => ({
  id, experienceId: null, projectId, kind: 'achievement', description: 'Shipped it', impact: null, result: null,
  highlighted: false, order: 0, tags: '[]', createdAt: t, updatedAt: t, skills: [], ...over,
})
const vault = buildVault(vaultSource({
  projects: [{
    ...base.projects[0],
    activities: [evidence('pa1', 'pr1', { description: 'Cut hotfix time', skills: [{ skillId: 's1', status: 'confirmed' }, { skillId: 's3', status: 'confirmed' }] })],
  }],
}) as never)

describe('noteCapabilityLinks', () => {
  it('lists what a role uses and what its evidence proves, with how each link came about', () => {
    const links = noteCapabilityLinks(vault, 'e1')!
    const byName = Object.fromEntries(links.capabilities.map((c) => [c.name, c]))
    // a1 (the role's own) and pa1 (its project's) both demonstrate Release management.
    expect(byName['Release management']).toMatchObject({ kind: 'skill', evidence: 2, via: ['confirmed'] })
    // Agile only through the project's evidence.
    expect(byName['Agile']).toMatchObject({ evidence: 1 })
    // Jira is on the role itself, with no evidence behind it.
    expect(byName['Jira']).toMatchObject({ evidence: 0 })
    expect(links.capabilities[0].name).toBe('Release management')
  })

  it('counts a role\'s own and its projects\' evidence', () => {
    expect(noteCapabilityLinks(vault, 'e1')!.evidenceIds.sort()).toEqual(['a1', 'a2', 'pa1'])
  })

  it('reads a project from its own evidence only', () => {
    const links = noteCapabilityLinks(vault, 'pr1')!
    expect(links.evidenceIds).toEqual(['pa1'])
    expect(links.capabilities.map((c) => c.name).sort()).toEqual(['Agile', 'Release management'])
    expect(links.capabilities.every((c) => c.evidence === 1)).toBe(true)
  })

  it('is null for notes that are not a role or a project', () => {
    expect(noteCapabilityLinks(vault, 's1')).toBeNull()
    expect(noteCapabilityLinks(vault, 'missing')).toBeNull()
  })
})
