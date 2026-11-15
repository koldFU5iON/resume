// Wording for a capability's status and links. Kept free of imports from the
// vault builder so client components can use it without bundling that code.

import type { CapabilityStatus } from './types'

export type CapabilityMeta = {
  status: CapabilityStatus
  /** Evidence items that demonstrate it. */
  evidence: number
  /** Every link that goes when it is deleted: evidence it demonstrates plus roles and projects that use it. */
  links: number
}

export const STATUS_LABEL: Record<CapabilityStatus, string> = {
  proven: 'Proven',
  certified: 'Certified',
  claimed: 'Claimed only',
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** What a capability row says under its name. "Proven" is always explained: by evidence, or by the roles and projects that use it. */
export function statusLine(meta: CapabilityMeta): string {
  const parts: string[] = [STATUS_LABEL[meta.status]]
  if (meta.evidence > 0) parts.push(plural(meta.evidence, 'evidence item', 'evidence items'))
  else if (meta.status === 'proven' && meta.links > 0) parts.push(`used by ${plural(meta.links, 'role or project', 'roles or projects')}`)
  return parts.join(' · ')
}

/** The end of the delete confirmation: what goes with the capability besides itself. */
export function deleteDetail(meta?: CapabilityMeta): string | undefined {
  if (!meta) return undefined
  const used = meta.links - meta.evidence
  const parts = [
    meta.evidence > 0 ? `${plural(meta.evidence, 'evidence item', 'evidence items')}` : null,
    used > 0 ? `${plural(used, 'role or project', 'roles or projects')} that ${used === 1 ? 'uses' : 'use'} it` : null,
  ].filter(Boolean)
  return parts.length ? `along with its links to ${parts.join(' and ')}` : undefined
}
