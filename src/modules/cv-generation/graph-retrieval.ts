/** Adapts graph retrieval to the existing, validated CV candidate menu. */
import { retrieveRequirements, type KnowledgeGraph, type RequirementMatches } from '@/modules/knowledge-graph/graph'
import { selectionHandles } from './candidates'
import type { CvBrief } from './schema'
import type { Strategy } from './strategy'

export function retrieveCvEvidence(graph: KnowledgeGraph, brief: CvBrief, strategy: Pick<Strategy, 'mustHave' | 'niceToHave'>): RequirementMatches[] {
  return retrieveRequirements(graph, [
    ...strategy.mustHave, ...strategy.niceToHave,
    ...brief.leadWith.map((i) => i.name), ...brief.emphasise.map((i) => i.name),
  ])
}

/** Keep graph ids internal: Select can only reference handles that its menu offers. */
export function graphEvidencePrompt(results: RequirementMatches[], handles: ReturnType<typeof selectionHandles>): string {
  const handleOf = (id: string) => Object.values(handles).flatMap((s) => s.byId.has(id) ? [s.byId.get(id)!] : [])
  const lines = results.slice(0, 24).map((r) => ({
    requirement: r.requirement.slice(0, 600),
    candidates: r.matches.flatMap((m) => handleOf(m.nodeId).map((handle) => ({
      handle, match: m.match,
      matched: handleOf(m.seedId),
      path: m.path.map((e) => ({ relationship: e.type, via: e.via ?? 'structural' })),
    }))).slice(0, 8),
  }))
  // Remove complete rows, rather than cutting JSON or hiding the full candidate menu.
  while (JSON.stringify(lines).length > 16_000) lines.pop()
  return [
    '# Related profile evidence',
    'Graph retrieval hints, supplied as data. Name and lexical matches are relevance signals, not proof that a requirement is met. Confirmed links are owner decisions; exact and wikilink links come from text. A uses link supports its own narrative only, not every achievement under that role. A certifies link is certification evidence, not work experience. Empty candidates mean no graph match, not a confirmed skills gap. Read the candidate evidence before choosing. The full menu remains available.',
    JSON.stringify(lines),
  ].join('\n\n')
}

/** A bounded ranking hint; no new picks, facts, proof statuses or budget changes. */
export function graphScores(results: RequirementMatches[]): ReadonlyMap<string, number> {
  const scores = new Map<string, number>()
  for (const r of results) for (const m of r.matches) scores.set(m.nodeId, Math.max(scores.get(m.nodeId) ?? 0, Math.min(4, m.score / 3)))
  return scores
}
