// Pure: turns the loaded rows into a Vault. No db access, so it is unit-tested
// directly. Storage stays relational (typed tables); this is the read layer
// that presents them as linked notes.

import { parseJsonField } from '@/lib/utils'
import { normalizeSearchProfile } from '@/modules/search-profile/schema'
import { formatMonth, formatSpan, normalizeName, oneLine } from './format'
import type { VaultSource } from './source'
import type {
  CapabilityKind,
  CapabilityNote,
  CapabilityStatus,
  CertificationNote,
  EducationNote,
  EvidenceNote,
  ExperienceNote,
  IdentityNote,
  LanguageNote,
  Link,
  Note,
  NoteType,
  PreferencesNote,
  ProjectNote,
  Vault,
} from './types'

export const PREFERENCES_NOTE_ID = 'preferences'

function emptyByType(): Vault['byType'] {
  return {
    identity: [], preferences: [], experience: [], project: [], evidence: [],
    capability: [], education: [], certification: [], language: [],
  }
}

function evidenceCounts(achievements: number, responsibilities: number): string {
  return `${achievements} achievement${achievements === 1 ? '' : 's'}, ` +
    `${responsibilities} ${responsibilities === 1 ? 'responsibility' : 'responsibilities'}`
}

export function buildVault(row: VaultSource): Vault {
  const notes = new Map<string, Note>()
  const byType = emptyByType()
  const add = (note: Note) => {
    notes.set(note.id, note)
    byType[note.type].push(note.id)
  }

  // ── Identity (the hub note) ──
  const identity: IdentityNote = {
    id: row.id,
    type: 'identity',
    title: row.name,
    gist: row.headline?.trim() || row.name,
    props: {
      name: row.name,
      headline: row.headline,
      location: row.location,
      contact: {
        email: row.email,
        phone: row.phone,
        linkedIn: row.linkedIn,
        github: row.github,
        website: row.website,
      },
    },
    body: row.summary?.trim() || undefined,
    links: [],
    backlinks: [],
    updatedAt: row.updatedAt,
  }
  add(identity)

  // ── Preferences (the one search profile) ──
  const prefs = normalizeSearchProfile(row.settings?.searchProfile)
  const prefsGist = [
    prefs.roles.length ? prefs.roles.join(', ') : null,
    prefs.remotePreference || null,
    prefs.countries.length ? prefs.countries.join(', ') : null,
  ].filter(Boolean).join(' · ')
  const preferences: PreferencesNote = {
    id: PREFERENCES_NOTE_ID,
    type: 'preferences',
    title: 'Search preferences',
    gist: prefsGist || 'Not set',
    props: prefs,
    links: [],
    backlinks: [],
    updatedAt: row.settings?.updatedAt ?? row.updatedAt,
  }
  add(preferences)

  // ── Capabilities: skills, tools and competencies as one faceted set ──
  // Same-name entries across the three tables collapse into one note
  // (skill > tool > competency); `alias` maps every source id to it.
  const alias = new Map<string, string>()
  const byName = new Map<string, string>()
  const addCapability = (
    id: string,
    name: string,
    kind: CapabilityKind,
    rest: Pick<CapabilityNote['props'], 'category' | 'level' | 'yearsOfExperience'>,
    updatedAt: Date,
  ) => {
    const key = normalizeName(name)
    const existing = byName.get(key)
    if (existing) {
      alias.set(id, existing)
      return
    }
    byName.set(key, id)
    alias.set(id, id)
    add({
      id,
      type: 'capability',
      title: name,
      gist: '', // filled once links are known
      props: { name, kind, ...rest, status: 'claimed' },
      links: [],
      backlinks: [],
      updatedAt,
    } satisfies CapabilityNote)
  }
  for (const s of row.skills) {
    addCapability(s.id, s.name, 'skill', {
      category: s.category || null, level: s.level || null, yearsOfExperience: s.yearsOfExperience,
    }, s.updatedAt)
  }
  for (const t of row.tools) {
    addCapability(t.id, t.name, 'tool', { category: t.category, level: null, yearsOfExperience: null }, t.updatedAt)
  }
  for (const c of row.competencies) {
    addCapability(c.id, c.name, 'competency', { category: null, level: null, yearsOfExperience: null }, c.updatedAt)
  }
  const capLinks = (ids: { skillId: string }[], type: Link['type']): Link[] =>
    [...new Set(ids.map((s) => alias.get(s.skillId)).filter((id): id is string => Boolean(id)))]
      .map((id) => ({ type, id }))

  // ── Experiences and their evidence ──
  for (const e of row.experiences) {
    const evidenceIds: string[] = []
    for (const a of e.activities) {
      const kind = a.kind === 'achievement' ? 'achievement' : 'responsibility'
      const note: EvidenceNote = {
        id: a.id,
        type: 'evidence',
        title: oneLine(a.description, 80),
        gist: oneLine(a.impact ? `${a.description} (${a.impact})` : a.description),
        props: {
          kind,
          description: a.description,
          impact: a.impact,
          highlighted: a.highlighted,
          parentId: e.id,
        },
        links: capLinks(a.skills, 'demonstrates'),
        backlinks: [],
        updatedAt: a.updatedAt,
      }
      add(note)
      evidenceIds.push(a.id)
    }
    const projectIds = row.projects.filter((p) => p.experienceId === e.id).map((p) => p.id)
    const achievements = e.activities.filter((a) => a.kind === 'achievement').length
    const span = formatSpan(e.startDate, e.endDate)
    const note: ExperienceNote = {
      id: e.id,
      type: 'experience',
      title: `${e.role} — ${e.company}`,
      gist: [
        `${e.role} at ${e.company}`,
        span,
        e.activities.length ? evidenceCounts(achievements, e.activities.length - achievements) : null,
      ].filter(Boolean).join(' · '),
      props: {
        company: e.company,
        role: e.role,
        startDate: e.startDate,
        endDate: e.endDate,
        location: e.location,
        remote: e.remote,
      },
      body: e.summary.trim() || undefined,
      links: [
        ...projectIds.map((id) => ({ type: 'contains' as const, id })),
        ...evidenceIds.map((id) => ({ type: 'has' as const, id })),
        ...capLinks(e.skills, 'uses'),
      ],
      backlinks: [],
      updatedAt: e.updatedAt,
    }
    add(note)
  }

  // ── Projects: description + notes collapse into one body ──
  for (const p of row.projects) {
    const highlights = parseJsonField<unknown>(p.highlights, [])
    const body = [p.description.trim(), p.notes.trim()].filter(Boolean).join('\n\n')
    const note: ProjectNote = {
      id: p.id,
      type: 'project',
      title: p.name,
      gist: oneLine(p.description || (Array.isArray(highlights) ? String(highlights[0] ?? '') : '') || p.name),
      props: {
        name: p.name,
        description: p.description,
        status: p.status,
        startDate: p.startDate,
        endDate: p.endDate,
        url: p.url,
        repoUrl: p.repoUrl,
        highlights: Array.isArray(highlights) ? highlights.filter((h): h is string => typeof h === 'string') : [],
        experienceId: p.experienceId,
      },
      body: body || undefined,
      links: capLinks(p.skills, 'uses'),
      backlinks: [],
      updatedAt: p.updatedAt,
    }
    add(note)
  }

  // ── Records ──
  for (const ed of row.educations) {
    const span = formatSpan(ed.startDate, ed.endDate)
    add({
      id: ed.id,
      type: 'education',
      title: `${ed.qualification} — ${ed.institution}`,
      gist: [`${ed.qualification}${ed.field ? ` in ${ed.field}` : ''}, ${ed.institution}`, span, ed.grade].filter(Boolean).join(' · '),
      props: {
        institution: ed.institution,
        qualification: ed.qualification,
        field: ed.field,
        startDate: ed.startDate,
        endDate: ed.endDate,
        grade: ed.grade,
      },
      links: [],
      backlinks: [],
      updatedAt: ed.updatedAt,
    } satisfies EducationNote)
  }
  for (const c of row.certifications) {
    add({
      id: c.id,
      type: 'certification',
      title: c.name,
      gist: [
        c.name,
        c.issuer,
        c.issueDate ? formatMonth(c.issueDate) : null,
        c.expiryDate ? `expires ${formatMonth(c.expiryDate)}` : null,
      ].filter(Boolean).join(' · '),
      props: {
        name: c.name,
        issuer: c.issuer,
        issueDate: c.issueDate,
        expiryDate: c.expiryDate,
        credentialUrl: c.credentialUrl,
      },
      links: capLinks(c.skills, 'certifies'),
      backlinks: [],
      updatedAt: c.updatedAt,
    } satisfies CertificationNote)
  }
  for (const l of row.languages) {
    add({
      id: l.id,
      type: 'language',
      title: l.name,
      gist: l.proficiency ? `${l.name} (${l.proficiency})` : l.name,
      props: { name: l.name, proficiency: l.proficiency },
      links: [],
      backlinks: [],
      updatedAt: l.updatedAt,
    } satisfies LanguageNote)
  }

  // ── Backlinks, then derived capability status and gist ──
  for (const note of notes.values()) {
    for (const link of note.links) {
      notes.get(link.id)?.backlinks.push({ type: link.type, id: note.id })
    }
  }
  for (const id of byType.capability) {
    const cap = notes.get(id) as CapabilityNote
    cap.props.status = capabilityStatus(cap)
    const evidence = cap.backlinks.filter((b) => b.type === 'demonstrates' || b.type === 'uses').length
    cap.gist = [
      cap.props.kind,
      cap.props.category && cap.props.category !== 'General' ? cap.props.category : null,
      cap.props.level,
      cap.props.yearsOfExperience ? `${cap.props.yearsOfExperience}y` : null,
      cap.props.status === 'proven' ? `proven by ${evidence}` : cap.props.status,
    ].filter(Boolean).join(' · ')
  }

  return { profileId: row.id, identity, preferences, notes, byType }
}

function capabilityStatus(cap: CapabilityNote): CapabilityStatus {
  if (cap.backlinks.some((b) => b.type === 'demonstrates' || b.type === 'uses')) return 'proven'
  if (cap.backlinks.some((b) => b.type === 'certifies')) return 'certified'
  return 'claimed'
}

/** Typed list of a type's notes, in display order. */
export function notesOf<T extends NoteType>(vault: Vault, type: T): Extract<Note, { type: T }>[] {
  return vault.byType[type].map((id) => vault.notes.get(id) as Extract<Note, { type: T }>)
}
