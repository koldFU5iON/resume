// The Profile Map: the vault's index. A cheap overview an AI reads first to
// decide which notes to open, plus the gaps worth asking the user about.

import { normalize } from '@/modules/profile/duplicate-detect'
import { notesOf } from './build'
import { normalizeName } from './format'
import type { NoteType, Vault } from './types'

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
    const evidence = exp.links.filter((l) => l.type === 'has').map((l) => vault.notes.get(l.id))
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

/** Roles at the same company whose dates overlap by more than a handover. */
function overlappingRoles(vault: Vault): Gap[] {
  const gaps: Gap[] = []
  const now = Date.now()
  const roles = notesOf(vault, 'experience')
  for (let i = 0; i < roles.length; i++) {
    for (let j = i + 1; j < roles.length; j++) {
      const a = roles[i], b = roles[j]
      if (normalizeName(a.props.company) !== normalizeName(b.props.company)) continue
      const start = Math.max(a.props.startDate.getTime(), b.props.startDate.getTime())
      const end = Math.min(a.props.endDate?.getTime() ?? now, b.props.endDate?.getTime() ?? now)
      if (end - start <= OVERLAP_GRACE_MS) continue
      const months = Math.round((end - start) / MONTH_MS)
      gaps.push({
        noteId: a.id, area: 'experience',
        message: `${a.props.role} and ${b.props.role} at ${a.props.company} overlap by about ${months} months. Were they held at the same time, or should the dates change?`,
      })
    }
  }
  return gaps
}

/** Above this word overlap, two achievements under different roles are the same claim. */
const DUPLICATE_SIMILARITY = 0.8
/** Pairwise comparison is quadratic; past this many atoms the check is skipped. */
const MAX_EVIDENCE_FOR_DUPLICATES = 400

/** Near-identical evidence filed under two different roles. */
function duplicatedEvidence(vault: Vault): Gap[] {
  const atoms = notesOf(vault, 'evidence')
  if (atoms.length > MAX_EVIDENCE_FOR_DUPLICATES) return []
  const words = atoms.map((e) => new Set(normalize(e.props.description).split(' ').filter((w) => w.length > 2)))
  const gaps: Gap[] = []
  const reported = new Set<string>()
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i], b = atoms[j]
      if (a.props.parentId === b.props.parentId || reported.has(a.id) || reported.has(b.id)) continue
      const wa = words[i], wb = words[j]
      if (wa.size < 3 || wb.size < 3) continue
      let shared = 0
      for (const w of wa) if (wb.has(w)) shared++
      if (shared / (wa.size + wb.size - shared) < DUPLICATE_SIMILARITY) continue
      reported.add(a.id).add(b.id)
      const roleA = vault.notes.get(a.props.parentId)?.title ?? 'one role'
      const roleB = vault.notes.get(b.props.parentId)?.title ?? 'another'
      gaps.push({
        noteId: a.id, area: 'evidence',
        message: `"${a.title}" appears under both ${roleA} and ${roleB}. Which role does it belong to?`,
      })
    }
  }
  return gaps
}
