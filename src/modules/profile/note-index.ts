// The profile as a list of notes, and the URL each one lives at. Pure: built
// from the profile already loaded, so nothing here touches the database and
// ownership is inherent (a profile only lists its own rows).

export const NOTE_BASE = '/dashboard/profile'
/** The Overview note has no row of its own; its id in the URL is this word. */
export const OVERVIEW_ID = 'overview'

export const overviewHref = () => `${NOTE_BASE}/n/${OVERVIEW_ID}`
/** A role's or project's note. Ids are cuids, unique across both tables. */
export const noteHref = (id: string) => `${NOTE_BASE}/n/${id}`
export const capabilitiesHref = () => `${NOTE_BASE}/records/capabilities`
export const credentialsHref = () => `${NOTE_BASE}/records/credentials`

type IndexExperience = { id: string; role: string; company: string; startDate: Date | string; endDate: Date | string | null }
type IndexProject = { id: string; name: string; experienceId: string | null }

export type NoteIndex = {
  /** Newest first; each carries its projects, oldest first. */
  experiences: { id: string; title: string; period: string; projects: { id: string; name: string }[] }[]
  /** Projects with no role, by name. */
  projects: { id: string; name: string }[]
}

const year = (d: Date | string) => new Date(d).getFullYear()

export function buildNoteIndex(profile: { experiences: IndexExperience[]; projects: IndexProject[] }): NoteIndex {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
  const experiences = [...profile.experiences]
    .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
    .map((e) => ({
      id: e.id,
      title: `${e.role}, ${e.company}`,
      period: `${year(e.startDate)}–${e.endDate ? year(e.endDate) : 'now'}`,
      projects: profile.projects.filter((p) => p.experienceId === e.id).map((p) => ({ id: p.id, name: p.name })),
    }))
  const projects = profile.projects.filter((p) => !p.experienceId).map((p) => ({ id: p.id, name: p.name })).sort(byName)
  return { experiences, projects }
}

export type NoteRef =
  | { kind: 'overview' }
  | { kind: 'experience'; id: string }
  | { kind: 'project'; id: string; experienceId: string | null }

/** What a note URL's id points at, or null when it isn't one of this profile's notes. */
export function findNote(profile: { experiences: { id: string }[]; projects: { id: string; experienceId: string | null }[] }, id: string): NoteRef | null {
  if (id === OVERVIEW_ID) return { kind: 'overview' }
  if (profile.experiences.some((e) => e.id === id)) return { kind: 'experience', id }
  const project = profile.projects.find((p) => p.id === id)
  return project ? { kind: 'project', id, experienceId: project.experienceId } : null
}

const parentIdOf = (props: unknown) => (props as { parentId?: string } | undefined)?.parentId

/**
 * Where a gap prompt or map entry should send the user. Narrative notes have
 * a page; records share the two Records pages; the identity and preferences
 * notes are the Overview.
 */
export function vaultNoteHref(note: { type: string; id: string; props?: unknown }): string {
  switch (note.type) {
    case 'experience':
    case 'project':
      return noteHref(note.id)
    case 'evidence':
      return parentIdOf(note.props) ? noteHref(parentIdOf(note.props)!) : overviewHref()
    case 'capability':
    case 'language':
      return capabilitiesHref()
    case 'education':
    case 'certification':
      return credentialsHref()
    default:
      return overviewHref()
  }
}

/** A gap with no note of its own still belongs to an area. */
export function areaHref(area: string): string {
  switch (area) {
    case 'capability':
    case 'language':
      return capabilitiesHref()
    case 'education':
    case 'certification':
      return credentialsHref()
    default:
      return overviewHref()
  }
}
