/**
 * Per-bullet provenance (Phase 3d). Every evidence item sent to an experience
 * writer gets a short label (E1, E2, ... for activities; P1, P2, ... for
 * projects) and the writer returns each bullet with the labels it comes from.
 * Code validates the labels, maps them to real ids, and keeps a short snippet
 * of each source so the log can SHOW where a bullet came from (a bullet that
 * quietly merged two different activities, with two different figures, is the
 * failure this makes visible).
 *
 * Pure: no DB, no network, no model.
 */

import type { BulletProvenance, BulletSource } from '../schema'
import { figuresIn } from './checks'
import { activityEvidenceText, type EmployerEvidence } from './evidence'
import { isThin } from './thin'
import { plainLine } from './plain'

/** Longest snippet stored per source. */
export const SNIPPET_MAX_CHARS = 140

/** One evidence item as the writer sees it: its label, the real id, and its text. */
export type EvidenceRef = {
  label: string
  id: string
  kind: BulletSource['kind']
  /** The text the writer saw (activity text and impact; project name and text): what a figure is checked against. */
  text: string
  snippet: string
  project?: { id: string; name: string }
}

const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/g
const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+/gi

/** A short, one-line piece of an evidence text for the log: plain, without contact details, at most SNIPPET_MAX_CHARS. */
export function snippetOf(text: string, max = SNIPPET_MAX_CHARS): string {
  const t = plainLine(text).replace(EMAIL, '').replace(URL_LIKE, '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

/** The labelled evidence of one employer, in the order the prompt lists it: activities E1.., then projects P1... */
export function evidenceRefs(emp: Pick<EmployerEvidence, 'activities' | 'projects'>): EvidenceRef[] {
  return [
    ...emp.activities.map((a, i): EvidenceRef => ({
      label: `E${i + 1}`,
      id: a.id,
      kind: 'activity',
      text: activityEvidenceText(a),
      ...(a.fromProject ? { project: a.fromProject } : {}),
      snippet: snippetOf(a.fromProject ? `${a.fromProject.name}: ${a.text}` : a.text),
    })),
    ...emp.projects.map((p, i): EvidenceRef => ({
      label: `P${i + 1}`,
      id: p.id,
      kind: 'project',
      text: `${p.name}\n${p.text}`,
      ...(!isThin(p) ? { project: { id: p.id, name: p.name } } : {}),
      snippet: snippetOf(`${p.name}: ${p.text}`),
    })),
  ]
}

/** "E3", "[e3]", " P1 " → "E3" / "P1"; anything else null. */
export function normaliseLabel(raw: string): string | null {
  const m = /^\s*\[?\s*([EPep])\s*0*(\d+)\s*\]?\s*$/.exec(raw)
  return m ? `${m[1].toUpperCase()}${m[2]}` : null
}

/** The labels a writer cited, resolved against the employer's evidence: valid ones (each once, in the writer's order) and the count of unknown ones, which are dropped. */
export function resolveSources(cited: readonly string[], refs: readonly EvidenceRef[]): { sources: EvidenceRef[]; unknown: number } {
  const byLabel = new Map(refs.map((r) => [r.label, r]))
  const sources: EvidenceRef[] = []
  let unknown = 0
  for (const raw of cited) {
    const ref = byLabel.get(normaliseLabel(raw) ?? '')
    if (!ref) { unknown++; continue }
    if (!sources.includes(ref)) sources.push(ref)
  }
  return { sources, unknown }
}

/** What is stored for a source: the real id, its kind and a snippet (never the label, which only exists for one prompt). */
export const toSource = (r: EvidenceRef): BulletSource => ({ id: r.id, kind: r.kind, snippet: r.snippet })

export const toProvenance = (text: string, sources: readonly EvidenceRef[]): BulletProvenance => ({ text, sources: sources.map(toSource) })

/**
 * A SOFT note when a bullet's figures come from two or more DIFFERENT evidence
 * items: two sources are mixed when each states a figure of the bullet that the
 * other does not. Related activities with different figures ("asset collection
 * 4 weeks to 1 week" for 150 customer projects; "3 weeks to under an hour" for
 * the whole business) must never be conflated, so this makes it visible.
 * Merging two items that state the same measured outcome (the same figures in
 * both) is allowed and never flagged. Informational: no retry, and it is never
 * a "worth a quick check" note.
 */
export function mixedSourceNote(bullet: string, sources: readonly EvidenceRef[], names: readonly string[] = []): string | null {
  if (sources.length < 2) return null
  const wanted = new Set(figuresIn(bullet, { names }).map((f) => f.key))
  if (wanted.size === 0) return null
  const own = sources.map((s) => ({ s, keys: new Set(figuresIn(s.text, { names, bareOne: true }).map((f) => f.key).filter((k) => wanted.has(k))) }))
  for (let i = 0; i < own.length; i++) {
    for (let j = i + 1; j < own.length; j++) {
      const onlyA = [...own[i].keys].some((k) => !own[j].keys.has(k))
      const onlyB = [...own[j].keys].some((k) => !own[i].keys.has(k))
      if (onlyA && onlyB) {
        const contributing = own.filter((o) => o.keys.size > 0)
        return `Bullet combines figures from ${contributing.length} activities: ${contributing.map((o) => o.s.snippet).join(' / ')}`
      }
    }
  }
  return null
}
