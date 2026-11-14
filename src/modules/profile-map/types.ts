// The profile as a vault of atomic, linked notes. See
// docs/superpowers/specs/2026-11-11-profile-map-design.md.
//
// Two families of notes:
// - record notes (education, certification, language, capability): meaning
//   lives in fixed, validated props; no body.
// - narrative notes (experience, project): small fixed props + a free markdown
//   body, which is the source of truth.
// Evidence notes sit between them: atomic claims extracted from a narrative,
// linked to the capabilities they demonstrate.

import type { SearchProfile } from '@/modules/search-profile/schema'

export type NoteType =
  | 'identity'
  | 'preferences'
  | 'experience'
  | 'project'
  | 'evidence'
  | 'capability'
  | 'education'
  | 'certification'
  | 'language'

/**
 * Typed edges. `from` → `to`:
 * - contains:     experience → project
 * - has:          experience | project → evidence
 * - demonstrates: evidence → capability
 * - uses:         experience | project → capability
 * - certifies:    certification → capability
 */
export type LinkType = 'contains' | 'has' | 'demonstrates' | 'uses' | 'certifies'

/**
 * How a capability link came about. Confirmed links are stored decisions;
 * exact mentions and [[wikilinks]] are derived from the text on each load.
 */
export type LinkVia = 'confirmed' | 'exact' | 'wikilink'

export type Link = { type: LinkType; id: string; via?: LinkVia }

export type CapabilityKind = 'skill' | 'tool' | 'competency'

/**
 * Derived from links, never typed by hand: proven = backed by evidence or a
 * narrative that uses it; certified = a certification covers it; claimed =
 * listed only.
 */
export type CapabilityStatus = 'proven' | 'certified' | 'claimed'

type NoteBase<T extends NoteType, P> = {
  id: string
  type: T
  /** Human title, unique enough to show in a list ("Snr Program Manager — Unity"). */
  title: string
  /** One line, for the map. */
  gist: string
  props: P
  /** Markdown body. Narrative and identity notes only. */
  body?: string
  links: Link[]
  /** Computed from every other note's `links`. */
  backlinks: Link[]
  updatedAt: Date
}

export type Contact = {
  email: string | null
  phone: string | null
  linkedIn: string | null
  github: string | null
  website: string | null
}

export type IdentityNote = NoteBase<'identity', {
  name: string
  headline: string | null
  location: string | null
  /** PII. Never put into a prompt unless a caller opts in with `pii: 'include'`. */
  contact: Contact
}>

export type PreferencesNote = NoteBase<'preferences', SearchProfile>

export type ExperienceNote = NoteBase<'experience', {
  company: string
  role: string
  startDate: Date
  endDate: Date | null
  location: string | null
  remote: boolean
}>

export type ProjectNote = NoteBase<'project', {
  name: string
  /** The legacy one-paragraph description; the body holds description + notes. */
  description: string
  status: string
  startDate: Date | null
  endDate: Date | null
  url: string | null
  repoUrl: string | null
  highlights: string[]
  /** The experience this project sits under, if any. */
  experienceId: string | null
}>

export type EvidenceNote = NoteBase<'evidence', {
  kind: 'responsibility' | 'achievement'
  description: string
  impact: string | null
  highlighted: boolean
  /** The narrative note that owns this atom: an experience id, or a project id. */
  parentId: string
}>

export type CapabilityNote = NoteBase<'capability', {
  name: string
  kind: CapabilityKind
  category: string | null
  level: string | null
  yearsOfExperience: number | null
  status: CapabilityStatus
}>

export type EducationNote = NoteBase<'education', {
  institution: string
  qualification: string
  field: string | null
  startDate: Date
  endDate: Date | null
  grade: string | null
}>

export type CertificationNote = NoteBase<'certification', {
  name: string
  issuer: string | null
  issueDate: Date | null
  expiryDate: Date | null
  credentialUrl: string | null
}>

export type LanguageNote = NoteBase<'language', {
  name: string
  proficiency: string | null
}>

export type Note =
  | IdentityNote
  | PreferencesNote
  | ExperienceNote
  | ProjectNote
  | EvidenceNote
  | CapabilityNote
  | EducationNote
  | CertificationNote
  | LanguageNote

export type NoteOf<T extends NoteType> = Extract<Note, { type: T }>

export type Vault = {
  profileId: string
  identity: IdentityNote
  preferences: PreferencesNote
  /** Every note, including identity and preferences, keyed by id. */
  notes: Map<string, Note>
  /** Ids per type, in display order (newest first for dated notes). */
  byType: { [T in NoteType]: string[] }
  /** [[Wikilinks]] that match no capability, for the gap list. */
  unresolved: { noteId: string; name: string }[]
}
