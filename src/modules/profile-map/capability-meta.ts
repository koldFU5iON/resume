// What the Records list says about each capability beyond its own fields:
// whether anything backs it up, and how much does. Read from the vault, so it
// always matches the rest of the profile. Server side only: client code takes
// the wording and the type from ./capability-labels.

import { notesOf } from './build'
import type { CapabilityMeta } from './capability-labels'
import type { Vault } from './types'

export type { CapabilityMeta }

/** Capability id → its status, the evidence demonstrating it, and every link it would lose. */
export function capabilityMeta(vault: Vault): Record<string, CapabilityMeta> {
  const meta: Record<string, CapabilityMeta> = {}
  for (const capability of notesOf(vault, 'capability')) {
    const evidence = capability.backlinks.filter((b) => b.type === 'demonstrates').length
    const uses = capability.backlinks.filter((b) => b.type === 'uses').length
    meta[capability.id] = { status: capability.props.status, evidence, links: evidence + uses }
  }
  return meta
}
