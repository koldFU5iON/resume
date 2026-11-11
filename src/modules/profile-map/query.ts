// Read operations behind the internal profile tools (chat and MCP). Pure
// functions over a loaded vault. Every text field that leaves here goes
// through the contact scrubber unless the caller opts in with pii: 'include'.

import { profileMap, type Gap } from './map'
import { makeContactScrubber, type PiiMode } from './pii'
import { contextOf, renderNote } from './render'
import type { CapabilityKind, CapabilityStatus, LinkType, Note, NoteType, Vault } from './types'

export type QueryOptions = { pii?: PiiMode }

/** One note as a list row: enough to decide whether to open it. */
export type NoteRef = { id: string; type: NoteType; title: string; gist: string; context?: string }

export type LinkRef = { type: LinkType; id: string; noteType: NoteType; title: string }

const SECTION_ORDER: NoteType[] = [
  'identity', 'preferences', 'experience', 'project', 'capability', 'education', 'certification', 'language',
]

const SECTION_LABEL: Record<NoteType, string> = {
  identity: 'Identity', preferences: 'Preferences', experience: 'Experience', project: 'Projects',
  evidence: 'Evidence', capability: 'Capabilities', education: 'Education',
  certification: 'Certifications', language: 'Languages',
}

function scrubberFor(vault: Vault, opts: QueryOptions): (s: string) => string {
  return (opts.pii ?? 'scrub') === 'scrub' ? makeContactScrubber(vault.identity.props.contact) : (s) => s
}

function ref(vault: Vault, note: Note, scrub: (s: string) => string): NoteRef {
  const context = contextOf(vault, note)
  return {
    id: note.id,
    type: note.type,
    title: scrub(note.title),
    gist: scrub(note.gist),
    ...(context ? { context } : {}),
  }
}

function linkRefs(vault: Vault, links: Note['links']): LinkRef[] {
  return links.flatMap((l) => {
    const target = vault.notes.get(l.id)
    return target ? [{ type: l.type, id: l.id, noteType: target.type, title: target.title }] : []
  })
}

/**
 * The map as compact text: one line per note (`id · title — gist`), evidence
 * and projects nested under the role they belong to. Cheaper for a model to
 * read than JSON, and every id in it can be passed to profile_get_note.
 */
export function renderMapText(vault: Vault, opts: QueryOptions = {}): string {
  const scrub = scrubberFor(vault, opts)
  const line = (note: Note, indent = '') => {
    const tag = note.type === 'evidence' ? `[${note.props.kind}] ` : note.type === 'project' && indent ? '[project] ' : ''
    // An experience gist opens with "Role at Company", which the title already says.
    const raw = note.type === 'experience' ? note.gist.replace(`${note.props.role} at ${note.props.company} · `, '') : note.gist
    const gist = raw && raw !== note.title ? ` — ${scrub(raw)}` : ''
    return `${indent}- ${note.id} · ${tag}${scrub(note.title)}${gist}`
  }
  const children = (parentId: string): string[] => {
    const parent = vault.notes.get(parentId)
    if (!parent) return []
    return parent.links
      .filter((l) => l.type === 'has' || l.type === 'contains')
      .map((l) => vault.notes.get(l.id))
      .filter((n): n is Note => Boolean(n))
      .flatMap((n) => [line(n, '  '), ...(n.type === 'project' ? children(n.id).map((c) => `  ${c}`) : [])])
  }

  const out: string[] = []
  for (const type of SECTION_ORDER) {
    let ids = vault.byType[type]
    // Projects under a role are listed with that role.
    if (type === 'project') ids = ids.filter((id) => !(vault.notes.get(id) as Extract<Note, { type: 'project' }>).props.experienceId)
    if (ids.length === 0) continue
    out.push(`## ${SECTION_LABEL[type]}`)
    for (const id of ids) {
      const note = vault.notes.get(id)!
      out.push(line(note))
      if (note.type === 'experience' || note.type === 'project') out.push(...children(id))
    }
    out.push('')
  }
  return out.join('\n').trim()
}

export type MapResult = {
  completeness: number
  counts: Record<NoteType, number>
  map: string
  gaps: Gap[]
}

export function getMap(vault: Vault, opts: QueryOptions = {}): MapResult {
  const { counts, gaps, completeness } = profileMap(vault)
  return { completeness, counts, map: renderMapText(vault, opts), gaps }
}

export function getGaps(vault: Vault): { completeness: number; gaps: Gap[] } {
  const { gaps, completeness } = profileMap(vault)
  return { completeness, gaps }
}

export type NoteResult = {
  id: string
  type: NoteType
  title: string
  markdown: string
  links: LinkRef[]
  backlinks: LinkRef[]
}

/** One self-contained note, plus where it links so a model can keep walking. */
export function getNote(vault: Vault, id: string, opts: QueryOptions = {}): NoteResult | null {
  const note = vault.notes.get(id)
  const markdown = renderNote(vault, id, opts)
  if (!note || markdown === null) return null
  const scrub = scrubberFor(vault, opts)
  return {
    id: note.id,
    type: note.type,
    title: scrub(note.title),
    markdown,
    links: linkRefs(vault, note.links),
    backlinks: linkRefs(vault, note.backlinks),
  }
}

export type ListFilter = {
  type: NoteType
  /** Capabilities only. */
  kind?: CapabilityKind
  /** Capabilities only. */
  status?: CapabilityStatus
  /** Evidence only. */
  evidenceKind?: 'achievement' | 'responsibility'
}

export function listNotes(vault: Vault, filter: ListFilter, opts: QueryOptions = {}): NoteRef[] {
  const scrub = scrubberFor(vault, opts)
  return vault.byType[filter.type]
    .map((id) => vault.notes.get(id)!)
    .filter((n) => {
      if (n.type === 'capability') {
        if (filter.kind && n.props.kind !== filter.kind) return false
        if (filter.status && n.props.status !== filter.status) return false
      }
      if (n.type === 'evidence' && filter.evidenceKind && n.props.kind !== filter.evidenceKind) return false
      return true
    })
    .map((n) => ref(vault, n, scrub))
}

/** What points at a note: the evidence behind a capability, the role behind an achievement. */
export function getBacklinks(vault: Vault, id: string, opts: QueryOptions = {}): { note: NoteRef; backlinks: (NoteRef & { link: LinkType })[] } | null {
  const note = vault.notes.get(id)
  if (!note) return null
  const scrub = scrubberFor(vault, opts)
  return {
    note: ref(vault, note, scrub),
    backlinks: note.backlinks.flatMap((b) => {
      const from = vault.notes.get(b.id)
      return from ? [{ link: b.type, ...ref(vault, from, scrub) }] : []
    }),
  }
}

export type SearchHit = NoteRef & { snippet: string; score: number }

const SNIPPET_RADIUS = 80
const MAX_TERMS = 12

/** Searchable text per note: what a reader would look in. Contact props never included. */
function haystack(note: Note): string {
  const parts = [note.title, note.gist, note.body ?? '']
  switch (note.type) {
    case 'evidence': parts.push(note.props.description, note.props.impact ?? ''); break
    case 'project': parts.push(note.props.highlights.join('\n')); break
    case 'capability': parts.push(note.props.category ?? ''); break
    case 'experience': parts.push(note.props.company, note.props.role, note.props.location ?? ''); break
    case 'education': parts.push(note.props.institution, note.props.qualification, note.props.field ?? ''); break
    case 'certification': parts.push(note.props.issuer ?? ''); break
  }
  return parts.filter(Boolean).join('\n')
}

function snippetAround(text: string, at: number): string {
  const start = Math.max(0, at - SNIPPET_RADIUS)
  const end = Math.min(text.length, at + SNIPPET_RADIUS)
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
}

/**
 * Keyword search across titles, gists, bodies and evidence. Each query term
 * scores once per note; title matches count double. Plain substring matching
 * on purpose: the vault is small, and predictable beats clever here.
 */
export function searchVault(vault: Vault, query: string, opts: QueryOptions & { limit?: number; types?: NoteType[] } = {}): SearchHit[] {
  const terms = [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}+#.]+/u).filter((t) => t.length >= 2))].slice(0, MAX_TERMS)
  if (terms.length === 0) return []
  const scrub = scrubberFor(vault, opts)
  const hits: SearchHit[] = []
  for (const note of vault.notes.values()) {
    if (opts.types && !opts.types.includes(note.type)) continue
    const text = scrub(haystack(note))
    const lower = text.toLowerCase()
    const title = note.title.toLowerCase()
    let score = 0
    let first = -1
    for (const term of terms) {
      const at = lower.indexOf(term)
      if (at === -1) continue
      score += title.includes(term) ? 2 : 1
      if (first === -1 || at < first) first = at
    }
    if (score === 0) continue
    hits.push({ ...ref(vault, note, scrub), snippet: snippetAround(text, first), score })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 20)
}

