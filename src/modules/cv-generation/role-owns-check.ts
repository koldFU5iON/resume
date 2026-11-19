// Verification helpers for the role-owns switch (design doc §13). Pure: no database.
//
// `readerFingerprint` runs the readers that must not notice the switch (the vault, the CV candidates, the
// readiness findings, the profile map and the LLM snapshot) and hashes what each produces.
// `simulateAssignment` gives every project-only activity its project's role in memory, as step 3c will in
// the database. Equal fingerprints before and after mean no reader can tell the difference.

import { createHash } from 'node:crypto'
import { buildVault } from '@/modules/profile-map/build'
import { profileMap } from '@/modules/profile-map/map'
import type { VaultSource } from '@/modules/profile-map/source'
import { serializeProfileForLLM, toProfileSnapshot } from '@/modules/profile/snapshot'
import { checkProfileReadiness } from '@/modules/profile-readiness'
import { buildCandidates, candidatesToPrompt } from './candidates'

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12)
const stable = (v: unknown) => JSON.stringify(v, (_k, x) => (x instanceof Map ? [...x.entries()] : x instanceof Set ? [...x] : x))

export type ReaderFingerprint = { vault: string; candidates: string; readiness: string; map: string; snapshot: string }

export function readerFingerprint(source: VaultSource, now: Date): ReaderFingerprint {
  const vault = buildVault(source)
  const candidates = buildCandidates(vault)
  return {
    vault: sha(stable(vault)),
    candidates: sha(stable(candidates) + candidatesToPrompt(candidates)),
    readiness: sha(stable(checkProfileReadiness(vault, now))),
    map: sha(stable(profileMap(vault))),
    snapshot: sha(serializeProfileForLLM(toProfileSnapshot(vault))),
  }
}

/** The source as it will be once project-only activities carry their project's role. Input is not modified. */
export function simulateAssignment(source: VaultSource): VaultSource {
  const roleOf = new Map(source.projects.map((p) => [p.id, p.experienceId]))
  const roles = new Set(source.experiences.map((e) => e.id))
  const assigned = (a: VaultSource['projects'][number]['activities'][number], projectId: string) => {
    const roleId = roleOf.get(projectId)
    return !a.experienceId && roleId && roles.has(roleId) ? { ...a, experienceId: roleId } : a
  }
  const projects = source.projects.map((p) => ({ ...p, activities: p.activities.map((a) => assigned(a, p.id)) }))
  const experiences = source.experiences.map((e) => ({
    ...e,
    activities: [
      ...e.activities,
      ...projects.flatMap((p) => p.activities.filter((a) => a.experienceId === e.id && !e.activities.some((x) => x.id === a.id))),
    ],
  }))
  return { ...source, projects, experiences }
}

export const sameFingerprint = (a: ReaderFingerprint, b: ReaderFingerprint) => (Object.keys(a) as (keyof ReaderFingerprint)[]).every((k) => a[k] === b[k])
