import { contentStems } from './checks'
import type { EvidenceRef } from './provenance'
import { shortened } from './bullets'

// Keep internal punctuation, word order, case, units and qualifiers: a similar claim is not proof of a repeat.
export const claimText = (text: string): string => text.trim().replace(/\s+/g, ' ').replace(/(?<=[\p{L}\p{N}%)])\.$/u, '')

type CitedBullet = { text: string; sources: readonly EvidenceRef[]; unknown?: number; beforeShortening?: string }

function projectIds(sources: readonly EvidenceRef[]): string[] {
  return [...new Set(sources.flatMap((s) => s.project ? [s.project.id] : []))].sort()
}

/** Shared citations and overlapping wording only identify pairs for a closer look. */
export function possibleRepeat(a: CitedBullet, b: CitedBullet): boolean {
  if (!a.sources.some((s) => b.sources.some((t) => s.id === t.id && s.kind === t.kind))) return false
  const left = contentStems(a.text)
  const right = contentStems(b.text)
  const shared = [...left].filter((w) => right.has(w)).length
  return shared >= 3 && shared / Math.max(left.size, right.size) >= 0.7
}

function evidenceClaim(ref: EvidenceRef): string {
  const label = ref.project?.name
  return claimText(label && ref.text.startsWith(`${label}\n`) ? ref.text.slice(label.length + 1) : ref.text)
}

export function sameCitedClaim(a: CitedBullet, b: CitedBullet): boolean {
  return !a.unknown && !b.unknown && a.sources.length > 0 && b.sources.length > 0 &&
    claimText(a.text) === claimText(b.text) &&
    claimText(a.beforeShortening ?? a.text) === claimText(b.beforeShortening ?? b.text) &&
    a.sources.some((s) => b.sources.some((t) => (s.id === t.id && s.kind === t.kind) ||
      (evidenceClaim(s).length > 0 && evidenceClaim(s) === evidenceClaim(t)))) &&
    JSON.stringify(projectIds(a.sources)) === JSON.stringify(projectIds(b.sources))
}

/** Only collapse identical displayed claims with resolved, compatible project attribution. */
export function dedupeClaims<T extends CitedBullet>(bullets: readonly T[], notes?: string[]): T[] {
  const kept: T[] = []
  for (const bullet of bullets) {
    const same = kept.findIndex((prev) => sameCitedClaim(prev, bullet))
    if (same < 0) {
      kept.push(bullet)
      continue
    }
    const prev = kept[same]
    const sources = [...prev.sources, ...bullet.sources.filter((s) => !prev.sources.some((p) => p.id === s.id && p.kind === s.kind))]
    kept[same] = { ...prev, sources }
    notes?.push(`Removed a repeated bullet and kept its citations on the remaining copy: “${shortened(bullet.text)}”.`)
  }
  return kept
}
