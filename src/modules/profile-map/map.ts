// The Profile Map: the vault's index. A cheap overview an AI reads first to
// decide which notes to open, plus the gaps worth asking the user about.

import { normalize } from '@/modules/profile/duplicate-detect'
import { notesOf } from './build'
import { normalizeName } from './format'
import type { ExperienceNote, NoteType, Vault } from './types'

export type MapEntry = {
  id: string
  type: NoteType
  title: string
  gist: string
  /** Parent narrative for evidence; experience for a nested project. */
  parentId?: string
  links: number
  backlinks: number
}

export type Gap = {
  /** The note the gap is about, if any. */
  noteId?: string
  area: NoteType
  /** Phrased so an assistant can ask it directly. */
  message: string
}

export type ProfileMap = {
  counts: Record<NoteType, number>
  entries: MapEntry[]
  gaps: Gap[]
  /** 0–100: share of completeness checks that pass. */
  completeness: number
}

/** Below this many characters a narrative body is too thin to work from. */
const THIN_BODY_CHARS = 120

export function profileMap(vault: Vault): ProfileMap {
  const counts = Object.fromEntries(
    Object.entries(vault.byType).map(([type, ids]) => [type, ids.length]),
  ) as Record<NoteType, number>

  const entries: MapEntry[] = []
  for (const ids of Object.values(vault.byType)) {
    for (const id of ids) {
      const note = vault.notes.get(id)!
      entries.push({
        id,
        type: note.type,
        title: note.title,
        gist: note.gist,
        ...(note.type === 'evidence' ? { parentId: note.props.parentId } : {}),
        ...(note.type === 'project' && note.props.experienceId ? { parentId: note.props.experienceId } : {}),
        links: note.links.length,
        backlinks: note.backlinks.length,
      })
    }
  }

  const { gaps, checks, passed } = findGaps(vault)
  return { counts, entries, gaps, completeness: checks ? Math.round((passed / checks) * 100) : 0 }
}

function findGaps(vault: Vault): { gaps: Gap[]; checks: number; passed: number } {
  const gaps: Gap[] = []
  let checks = 0
  let passed = 0
  const check = (ok: boolean, gap: Gap) => {
    checks++
    if (ok) passed++
    else gaps.push(gap)
  }

  const id = vault.identity
  check(Boolean(id.props.headline?.trim()), { noteId: id.id, area: 'identity', message: 'What headline sums up your professional identity in one line?' })
  check(Boolean(id.body), { noteId: id.id, area: 'identity', message: 'Add a short professional summary: who you are, what you do best, and what you want next.' })
  check(Boolean(id.props.location?.trim()), { noteId: id.id, area: 'identity', message: 'Where are you based? Location drives eligibility and remote matching.' })
  check(Boolean(id.props.contact.email?.trim()), { noteId: id.id, area: 'identity', message: 'Add a contact email so generated CVs have a complete header.' })

  const prefs = vault.preferences.props
  check(prefs.roles.length > 0, { noteId: vault.preferences.id, area: 'preferences', message: 'Which roles are you targeting?' })

  const experiences = notesOf(vault, 'experience')
  check(experiences.length > 0, { area: 'experience', message: 'Add your work experience, starting with your current or most recent role.' })
  for (const exp of experiences) {
    const ownedBy = [exp.id, ...exp.links.filter((l) => l.type === 'contains').map((l) => l.id)]
    const evidence = ownedBy.flatMap((id) => (vault.notes.get(id)?.links ?? []).filter((l) => l.type === 'has').map((l) => vault.notes.get(l.id)))
    const achievements = evidence.filter((n) => n?.type === 'evidence' && n.props.kind === 'achievement')
    check(achievements.length > 0, {
      noteId: exp.id, area: 'experience',
      message: `What did you achieve as ${exp.props.role} at ${exp.props.company}? Outcomes matter more than duties.`,
    })
    check((exp.body?.length ?? 0) >= THIN_BODY_CHARS || evidence.length >= 3, {
      noteId: exp.id, area: 'experience',
      message: `Your notes for ${exp.props.role} at ${exp.props.company} are thin. What was the scope, the team, and the hardest problem?`,
    })
  }

  const unmeasured = notesOf(vault, 'evidence').filter((e) => e.props.kind === 'achievement' && !e.props.impact)
  if (unmeasured.length > 0) {
    gaps.push({
      area: 'evidence',
      message: `${unmeasured.length} achievement${unmeasured.length === 1 ? ' has' : 's have'} no measurable impact. Can you add numbers (%, time, money, scale)?`,
    })
  }

  const capabilities = notesOf(vault, 'capability')
  check(capabilities.length > 0, { area: 'capability', message: 'List your key skills, tools and competencies.' })
  if (capabilities.length > 0) {
    const proven = capabilities.filter((c) => c.props.status !== 'claimed').length
    check(proven > 0, {
      area: 'capability',
      message: `None of your ${capabilities.length} capabilities are linked to evidence yet. Which achievements show them in action?`,
    })
  }

  check(vault.byType.education.length + vault.byType.certification.length > 0, {
    area: 'education', message: 'Add your education or any professional certifications.',
  })

  gaps.push(...overlappingRoles(vault), ...duplicatedEvidence(vault))

  for (const { noteId, name } of vault.unresolved) {
    const where = vault.notes.get(noteId)?.title
    gaps.push({
      noteId, area: 'capability',
      message: `[[${name}]]${where ? ` in ${where}` : ''} doesn't match any skill, tool or competency. Add it, or fix the link?`,
    })
  }

  const now = Date.now()
  for (const cert of notesOf(vault, 'certification')) {
    if (cert.props.expiryDate && cert.props.expiryDate.getTime() < now) {
      gaps.push({ noteId: cert.id, area: 'certification', message: `${cert.props.name} has expired. Renewed it, or should it be marked as lapsed?` })
    }
  }

  return { gaps, checks, passed }
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000
/** A handover of up to this long between roles at one company is normal, not an overlap. */
const OVERLAP_GRACE_MS = 3 * MONTH_MS
const MAX_OVERLAP_GAPS = 100
const GAP_LABEL_CHARS = 160

/** Sorted interval sweep: each visit either expires a role or emits a bounded warning. */
function overlappingRoles(vault: Vault): Gap[] {
  const gaps: Gap[] = []
  const now = Date.now()
  type Interval = { note: ExperienceNote; start: number; end: number }
  const companies = new Map<string, Interval[]>()
  for (const note of notesOf(vault, 'experience')) {
    const start = note.props.startDate.getTime()
    const end = note.props.endDate?.getTime() ?? now
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start <= OVERLAP_GRACE_MS) continue
    const company = normalizeName(note.props.company)
    const group = companies.get(company) ?? []
    group.push({ note, start, end })
    companies.set(company, group)
  }
  for (const roles of companies.values()) {
    roles.sort((a, b) => a.start - b.start)
    let active: Interval[] = []
    for (const current of roles) {
      const next: Interval[] = []
      for (const previous of active) {
        const end = Math.min(previous.end, current.end)
        if (end - current.start <= OVERLAP_GRACE_MS) continue
        if (gaps.length === MAX_OVERLAP_GAPS) {
          gaps.push({ area: 'experience', message: 'Additional role overlap warnings omitted. Review the reported dates first.' })
          return gaps
        }
        const a = previous.note, b = current.note
        const months = Math.round((end - current.start) / MONTH_MS)
        gaps.push({
          noteId: a.id, area: 'experience',
          message: `${a.props.role.slice(0, GAP_LABEL_CHARS)} and ${b.props.role.slice(0, GAP_LABEL_CHARS)} at ${a.props.company.slice(0, GAP_LABEL_CHARS)} overlap by about ${months} months. Were they held at the same time, or should the dates change?`,
        })
        next.push(previous)
      }
      next.push(current)
      active = next
    }
  }
  return gaps
}

/** Above this word overlap, two achievements under different roles are the same claim. */
const DUPLICATE_SIMILARITY = 0.8
/** Pairwise comparison is quadratic; past this many atoms the check is skipped. */
const MAX_EVIDENCE_FOR_DUPLICATES = 400
/** Bound token-set work as well as pair count, including legacy unbounded descriptions. */
const MAX_DUPLICATE_TEXT_CHARS = 100_000

/** Two parents are the same when equal, or when one is a project under the other role. */
function sameParent(vault: Vault, a: string, b: string): boolean {
  if (a === b) return true
  const roleOf = (id: string) => {
    const n = vault.notes.get(id)
    return n?.type === 'project' ? n.props.experienceId ?? id : id
  }
  return roleOf(a) === roleOf(b)
}

/** Near-identical evidence filed under two different roles. */
function duplicatedEvidence(vault: Vault): Gap[] {
  const atoms = notesOf(vault, 'evidence')
  if (atoms.length > MAX_EVIDENCE_FOR_DUPLICATES ||
      atoms.reduce((total, atom) => total + atom.props.description.length, 0) > MAX_DUPLICATE_TEXT_CHARS) {
    return [{ area: 'evidence', message: 'Duplicate evidence check omitted for a large evidence collection. Review repeated achievements manually.' }]
  }
  const words = atoms.map((e) => new Set(normalize(e.props.description).split(' ').filter((w) => w.length > 2)))
  const gaps: Gap[] = []
  const reported = new Set<string>()
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i], b = atoms[j]
      if (sameParent(vault, a.props.parentId, b.props.parentId) || reported.has(a.id) || reported.has(b.id)) continue
      const wa = words[i], wb = words[j]
      if (wa.size < 3 || wb.size < 3) continue
      let shared = 0
      for (const w of wa) if (wb.has(w)) shared++
      if (shared / (wa.size + wb.size - shared) < DUPLICATE_SIMILARITY) continue
      reported.add(a.id).add(b.id)
      const roleA = vault.notes.get(a.props.parentId)?.title.slice(0, GAP_LABEL_CHARS) ?? 'one role'
      const roleB = vault.notes.get(b.props.parentId)?.title.slice(0, GAP_LABEL_CHARS) ?? 'another'
      gaps.push({
        noteId: a.id, area: 'evidence',
        message: `"${a.title}" appears under both ${roleA} and ${roleB}. Which role does it belong to?`,
      })
    }
  }
  return gaps
}
