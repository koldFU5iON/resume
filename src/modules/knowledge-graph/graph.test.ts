import { describe, expect, it } from 'vitest'
import { buildVault } from '@/modules/profile-map/build'
import { vaultSource } from '@/modules/profile-map/__fixtures__/source'
import { buildKnowledgeGraph, retrieveRequirements } from './graph'

describe('profile knowledge graph', () => {
  it('retrieves evidence through a confirmed capability link without matching its wording', () => {
    const graph = buildKnowledgeGraph(buildVault(vaultSource()))
    const [result] = retrieveRequirements(graph, ['Release management'])
    expect(result.matches.find((m) => m.nodeId === 'a1')).toMatchObject({
      seedId: 's1', match: 'name', path: [{ from: 'a1', to: 's1', type: 'demonstrates', via: 'confirmed' }],
    })
    expect(result.matches.find((m) => m.nodeId === 'e1')?.path).toHaveLength(2)
    expect(result.matches.some((m) => m.nodeId === 'a2')).toBe(false)
    expect(result.matches.some((m) => m.nodeId === 'pr1')).toBe(false)
  })

  it('does not spread narrative uses or certification links onto unrelated achievements', () => {
    const vault = buildVault(vaultSource())
    const graph = buildKnowledgeGraph(vault)
    const [tool, certification] = retrieveRequirements(graph, ['Jira', 'Agile'])
    expect(tool.matches.some((m) => m.nodeId === 'e1')).toBe(true)
    expect(tool.matches.some((m) => m.nodeId === 'a1')).toBe(false)
    expect(certification.matches.find((m) => m.nodeId === 'ce1')?.path[0].type).toBe('certifies')
    expect(certification.matches.some((m) => m.nodeId === 'a1')).toBe(false)
    expect(vault.notes.get('s3')).toMatchObject({ props: { status: 'certified' } })
  })

  it('preserves derived link provenance separately from owner-confirmed links', () => {
    const source = vaultSource()
    source.experiences[0].activities[1].description = 'Coordinated [[Confluence]] documentation'
    const graph = buildKnowledgeGraph(buildVault(source))
    const [result] = retrieveRequirements(graph, ['Confluence'])
    expect(result.matches.find((m) => m.nodeId === 'a2')?.path[0].via).toBe('wikilink')
  })

  it('finds project evidence and its owner without crossing into sibling projects', () => {
    const source = vaultSource()
    source.projects[0].activities = [{ ...source.experiences[0].activities[0], id: 'project-atom', experienceId: null, projectId: 'pr1' }]
    source.projects.push({ ...source.projects[0], id: 'pr2', name: 'Other project', activities: [] })
    const graph = buildKnowledgeGraph(buildVault(source))
    const [result] = retrieveRequirements(graph, ['Release management'])
    const match = result.matches.find((m) => m.nodeId === 'pr1')!
    expect(match.path.map((e) => e.type)).toEqual(['demonstrates', 'has'])
    expect(result.matches.some((m) => m.nodeId === 'pr2')).toBe(false)
    const [named] = retrieveRequirements(graph, ['Release train'])
    expect(named.matches.find((m) => m.nodeId === 'project-atom')).toMatchObject({ seedId: 'pr1', path: [{ type: 'has' }] })
  })

  it('keeps contact information and search preferences out of the projection', () => {
    const vault = buildVault(vaultSource())
    const graph = buildKnowledgeGraph(vault)
    expect(graph.nodes.has(vault.identity.id)).toBe(false)
    expect(graph.nodes.has(vault.preferences.id)).toBe(false)
    expect(JSON.stringify([...graph.nodes.values()])).not.toContain('robin@example.test')
    expect(retrieveRequirements(graph, ['Head of Delivery'])[0].matches).toEqual([])
  })

  it('requires multiple matching words for lexical hints and avoids substring tool matches', () => {
    const source = vaultSource()
    source.skills[0].name = 'JavaScript'
    source.experiences[0].activities[1].description = 'Improved complex operational workflows'
    const graph = buildKnowledgeGraph(buildVault(source))
    const [lexical, single, substring, missing] = retrieveRequirements(graph, ['Complex operational workflows', 'Operational', 'Java', 'Nuclear engineering'])
    expect(lexical.matches.find((m) => m.nodeId === 'a2')?.match).toBe('lexical')
    expect(single.matches).toEqual([])
    expect(substring.matches).toEqual([])
    expect(missing.matches).toEqual([])
  })

  it('includes wording deep in a narrative and keeps outcome qualifications unchanged', () => {
    const source = vaultSource()
    const wording = 'Typical turnaround was two weeks; fastest observed case was one hour.'
    source.projects[0].notes = 'unrelated '.repeat(50) + wording
    const graph = buildKnowledgeGraph(buildVault(source))
    expect(graph.nodes.get('pr1')?.text).toContain(wording)
    expect(retrieveRequirements(graph, ['Typical turnaround'])[0].matches.some((m) => m.nodeId === 'pr1')).toBe(true)
  })

  it('changes its fingerprint when only a link decision changes, and ignores map iteration order', () => {
    const vault = buildVault(vaultSource())
    const before = buildKnowledgeGraph(vault).fingerprint
    vault.notes = new Map([...vault.notes.entries()].reverse())
    expect(buildKnowledgeGraph(vault).fingerprint).toBe(before)
    vault.notes.get('a1')!.links[0].via = 'exact'
    expect(buildKnowledgeGraph(vault).fingerprint).not.toBe(before)
  })

  it('excludes archived projects and tolerates dangling or duplicate links', () => {
    const source = vaultSource()
    source.projects[0].status = 'archived'
    const vault = buildVault(source)
    vault.notes.get('a1')!.links.push({ type: 'demonstrates', id: 'missing' }, ...vault.notes.get('a1')!.links)
    const graph = buildKnowledgeGraph(vault)
    expect(graph.nodes.has('pr1')).toBe(false)
    expect(graph.incoming.get('s1')).toHaveLength(1)
    expect(retrieveRequirements(graph, ['Release management'])[0].matches.some((m) => m.nodeId === 'missing')).toBe(false)
  })
})
