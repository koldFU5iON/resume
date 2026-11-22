/** A disposable, profile-scoped graph projection. The profile vault remains the source of truth. */
import { createHash } from 'node:crypto'
import { findMentions, stripWikilinks } from '@/modules/profile-map/links'
import { makeContactScrubber } from '@/modules/profile-map/pii'
import type { LinkType, LinkVia, NoteType, Vault } from '@/modules/profile-map/types'

export type GraphNode = { id: string; type: NoteType; title: string; text: string }
export type GraphEdge = { from: string; to: string; type: LinkType; via?: LinkVia }
export type KnowledgeGraph = {
  nodes: Map<string, GraphNode>
  outgoing: Map<string, GraphEdge[]>
  incoming: Map<string, GraphEdge[]>
  fingerprint: string
}
export type GraphMatch = {
  nodeId: string
  seedId: string
  match: 'name' | 'lexical'
  score: number
  /** Original edge direction, including when retrieval followed an incoming edge. */
  path: GraphEdge[]
}
export type RequirementMatches = { requirement: string; matches: GraphMatch[] }

export function buildKnowledgeGraph(vault: Vault): KnowledgeGraph {
  const scrub = makeContactScrubber(vault.identity.props.contact)
  const archivedProjects = new Set(vault.byType.project.filter((id) => {
    const note = vault.notes.get(id)
    return note?.type === 'project' && note.props.status === 'archived'
  }))
  const nodes = new Map<string, GraphNode>()
  for (const note of vault.notes.values()) {
    // Contact details, identity and search preferences never become matching evidence.
    if (note.type === 'identity' || note.type === 'preferences') continue
    if (archivedProjects.has(note.id) || (note.type === 'evidence' && archivedProjects.has(note.props.parentId))) continue
    const extra = note.type === 'evidence' ? [note.props.description, note.props.impact ?? '']
      : note.type === 'project' ? [note.props.description, ...note.props.highlights] : []
    nodes.set(note.id, {
      id: note.id, type: note.type, title: scrub(stripWikilinks(note.title)),
      text: scrub(stripWikilinks([note.title, note.body ?? '', ...extra].join('\n'))),
    })
  }
  const outgoing = new Map<string, GraphEdge[]>()
  const incoming = new Map<string, GraphEdge[]>()
  const edges: GraphEdge[] = []
  const seen = new Set<string>()
  for (const note of vault.notes.values()) {
    if (!nodes.has(note.id)) continue
    for (const link of note.links) {
      if (!nodes.has(link.id)) continue
      const edge: GraphEdge = { from: note.id, to: link.id, type: link.type, ...(link.via ? { via: link.via } : {}) }
      const key = JSON.stringify(edge)
      if (seen.has(key)) continue
      seen.add(key)
      edges.push(edge)
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge])
      incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge])
    }
  }
  const fingerprint = createHash('sha256').update(JSON.stringify([
    [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges.map((e) => JSON.stringify(e)).sort(),
  ])).digest('hex')
  return { nodes, outgoing, incoming, fingerprint }
}

const STOP = new Set('a an and are as at be by for from has have in is it of on or our that the their this to with you your experience ability skills strong'.split(' '))
function terms(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^\p{L}\p{N}+#.]+/u).filter((t) => t.length > 1 && !STOP.has(t)))]
}

/**
 * Name/word matching supplies seeds; typed edges supply related evidence.
 * Only capability → supporting note → owner paths are followed. Never spread
 * a role's tool usage onto every achievement, or across sibling projects.
 * A name hit is a retrieval signal, not a judgement of job qualification.
 */
export function retrieveRequirements(graph: KnowledgeGraph, requirements: readonly string[], selectableIds?: ReadonlySet<string>): RequirementMatches[] {
  return [...new Set(requirements.map((r) => r.trim()).filter(Boolean))].slice(0, 24).map((requirement) => {
    const query = terms(requirement).slice(0, 32)
    const found = new Map<string, GraphMatch>()
    const put = (hit: GraphMatch) => {
      const old = found.get(hit.nodeId)
      if (!old || hit.score > old.score) found.set(hit.nodeId, hit)
    }
    const owners = (hit: GraphMatch) => {
      let current = hit
      const visited = new Set([hit.nodeId])
      for (let depth = 0; depth < 2; depth++) {
        const owner = (graph.incoming.get(current.nodeId) ?? []).find((e) => e.type === 'has' || e.type === 'contains')
        if (!owner || visited.has(owner.from)) break
        visited.add(owner.from)
        current = { ...current, nodeId: owner.from, score: current.score - 1, path: [...current.path, owner] }
        put(current)
      }
    }
    for (const node of [...graph.nodes.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      const named = findMentions(requirement, [{ id: node.id, name: node.title }]).length > 0
      const words = new Set(terms(node.text))
      const overlap = query.filter((t) => words.has(t)).length
      // No match from a single generic word in a long requirement.
      if (!named && !(query.length >= 2 && overlap >= 2 && overlap / query.length >= 0.5)) continue
      const seed: GraphMatch = { nodeId: node.id, seedId: node.id, match: named ? 'name' : 'lexical', score: named ? 10 : 5 + overlap / query.length, path: [] }
      put(seed)
      owners(seed)
      // A brief that names a project should see that project's own evidence.
      // This is containment, not an inference that its atoms demonstrate a tool.
      if (named && node.type === 'project') {
        for (const edge of graph.outgoing.get(node.id) ?? []) {
          if (edge.type === 'has') put({ ...seed, nodeId: edge.to, score: seed.score + 1, path: [edge] })
        }
      }
      if (node.type !== 'capability') continue
      for (const edge of graph.incoming.get(node.id) ?? []) {
        if (!['demonstrates', 'uses', 'certifies'].includes(edge.type)) continue
        const support: GraphMatch = {
          ...seed, nodeId: edge.from, path: [edge],
          score: seed.score + (edge.via === 'confirmed' ? 3 : 1),
        }
        put(support)
        owners(support)
      }
    }
    return { requirement, matches: [...found.values()].filter((m) => !selectableIds || selectableIds.has(m.nodeId)).sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId)).slice(0, 40) }
  })
}
