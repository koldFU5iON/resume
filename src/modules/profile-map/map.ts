// The Profile Map: the vault's index. A cheap overview an AI reads first to
// decide which notes to open, plus the gaps worth asking the user about.

import { notesOf } from './build'
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

  const now = Date.now()
  for (const cert of notesOf(vault, 'certification')) {
    if (cert.props.expiryDate && cert.props.expiryDate.getTime() < now) {
      gaps.push({ noteId: cert.id, area: 'certification', message: `${cert.props.name} has expired. Renewed it, or should it be marked as lapsed?` })
    }
  }

  return { gaps, checks, passed }
}
