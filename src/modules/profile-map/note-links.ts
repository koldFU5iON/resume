// The capability links around one narrative note, for the Links tab: which
// skills, tools and competencies it uses or proves, how each link came about,
// and how much evidence stands behind it. A role also counts the evidence of
// the projects inside it, since that is shown under the role too.

import type { CapabilityKind, CapabilityStatus, LinkVia, Vault } from './types'

export type NoteCapabilityLink = {
  id: string
  name: string
  kind: CapabilityKind
  status: CapabilityStatus
  /** How the link came about: a decision you made, or read from the text. A capability can have several. */
  via: LinkVia[]
  /** Evidence items of this note that demonstrate it. */
  evidence: number
}

export type NoteLinks = {
  capabilities: NoteCapabilityLink[]
  /** The evidence the note owns, plus (for a role) its projects' evidence. */
  evidenceIds: string[]
}

/** Null when the id isn't a role or a project in the vault. */
export function noteCapabilityLinks(vault: Vault, noteId: string): NoteLinks | null {
  const note = vault.notes.get(noteId)
  if (!note || (note.type !== 'experience' && note.type !== 'project')) return null

  const owners = [note, ...(note.type === 'experience'
    ? note.links.filter((l) => l.type === 'contains').flatMap((l) => {
        const project = vault.notes.get(l.id)
        return project?.type === 'project' ? [project] : []
      })
    : [])]
  const evidenceIds = owners.flatMap((o) => o.links.filter((l) => l.type === 'has').map((l) => l.id))

  const found = new Map<string, { via: Set<LinkVia>; evidence: number }>()
  const entry = (id: string) => {
    let e = found.get(id)
    if (!e) found.set(id, (e = { via: new Set(), evidence: 0 }))
    return e
  }
  // The note's own mentions and confirmed uses.
  for (const link of note.links) {
    if (link.type !== 'uses') continue
    const e = entry(link.id)
    if (link.via) e.via.add(link.via)
  }
  // What its evidence demonstrates.
  for (const id of evidenceIds) {
    for (const link of vault.notes.get(id)?.links ?? []) {
      if (link.type !== 'demonstrates') continue
      const e = entry(link.id)
      e.evidence++
      if (link.via) e.via.add(link.via)
    }
  }

  const capabilities: NoteCapabilityLink[] = []
  for (const [id, { via, evidence }] of found) {
    const capability = vault.notes.get(id)
    if (capability?.type !== 'capability') continue
    capabilities.push({ id, name: capability.props.name, kind: capability.props.kind, status: capability.props.status, via: [...via], evidence })
  }
  capabilities.sort((a, b) => b.evidence - a.evidence || a.name.localeCompare(b.name))
  return { capabilities, evidenceIds }
}
