// What the Records list says about each capability beyond its own fields:
// whether anything backs it up, and how much evidence does. Read from the
// vault, so it always matches the rest of the profile.

import { notesOf } from './build'
import type { CapabilityStatus, Vault } from './types'

export type CapabilityMeta = { status: CapabilityStatus; /** Evidence items that demonstrate it. */ evidence: number }

/** Capability id → its status and how many evidence items demonstrate it. */
export function capabilityMeta(vault: Vault): Record<string, CapabilityMeta> {
  const meta: Record<string, CapabilityMeta> = {}
  for (const capability of notesOf(vault, 'capability')) {
    meta[capability.id] = {
      status: capability.props.status,
      evidence: capability.backlinks.filter((b) => b.type === 'demonstrates').length,
    }
  }
  return meta
}

export const STATUS_LABEL: Record<CapabilityStatus, string> = {
  proven: 'Proven',
  certified: 'Certified',
  claimed: 'Claimed only',
}
