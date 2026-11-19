// Dry-run plan for the profile model simplification (design doc
// docs/superpowers/specs/2026-11-19-profile-model-simplification-design.md, §6).
//
// Pure: takes rows, returns what a later migration would do and what only the
// owner can decide. It writes nothing and calls no database. The script
// scripts/profile-model-backfill-report.ts feeds it real rows and prints the
// result; the constraints and the Overview fold are applied in a later PR,
// only after the owner has read this report.

export type BackfillExperience = { id: string; company: string; role: string; type: string; summary: string; revision: number }
export type BackfillProject = { id: string; name: string; experienceId: string | null }
export type BackfillActivity = {
  id: string
  kind: string
  description: string
  experienceId: string | null
  projectId: string | null
}

export type BackfillInput = {
  experiences: BackfillExperience[]
  projects: BackfillProject[]
  activities: BackfillActivity[]
}

type Role = { experienceId: string; company: string; role: string }

export type BackfillReport = {
  /** Projects with no role. Only the owner can choose where each goes (default offered: Independent projects). */
  projectsWithoutRole: { id: string; name: string; activityCount: number; activitiesWithRole: number }[]
  /** Activities owned only by a project that has a role: they will take that role as their owner. */
  activitiesToAssign: ({ id: string; description: string; projectId: string; projectName: string } & Role)[]
  /** Activities that cannot get a role from the data alone. */
  activitiesUnresolved: {
    id: string
    description: string
    projectId: string | null
    projectName: string | null
    reason: 'project_without_role' | 'no_owner'
  }[]
  /** Activities whose role and project's role disagree. The owner decides which is right. */
  activitiesMismatched: {
    id: string
    description: string
    experienceId: string
    projectId: string
    projectName: string
    projectExperienceId: string
  }[]
  /** Roles whose responsibilities would be folded into the Overview text. */
  folds: ({
    /** Responsibilities that would be added to the Overview. */
    responsibilities: string[]
    /** Responsibilities whose wording is already in the note; nothing to add for these. */
    alreadyInNote: string[]
    /** Where it goes: the end of the note's existing Overview section, or a new Overview section at the end of the note. */
    placement: 'existing_overview' | 'new_section'
    /** The exact text appended to the note. */
    addition: string
    /** The note before and after the fold. */
    before: string
    after: string
  } & Role)[]
  /** Responsibilities left out of the fold because an achievement in the same role already says almost the same thing. Nothing is lost: the achievement keeps the wording. */
  nearDuplicates: ({ responsibility: string; achievementId: string; achievement: string } & Role)[]
  /** Roles left out of the fold because their note was already folded once; they still have responsibilities not in the Overview. */
  foldsSkipped: ({ reason: 'already_folded'; responsibilities: string[] } & Role)[]
  counts: {
    experiences: number
    independentExperiences: number
    projects: number
    activities: number
    responsibilities: number
    achievements: number
  }
}

/** The lead-in line of a fold. Also how a note that was already folded is recognised, so a second run adds nothing. */
export const FOLD_LEAD_IN = 'Responsibilities (moved here from the list):'

const OVERVIEW_HEADING = /^#{1,2}\s+overview\s*$/i
const ANY_HEADING = /^#{1,2}\s+\S/

const normalize = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').replace(/[\s.;:,]+$/, '').trim()

const NEAR_DUPLICATE_MIN_TOKENS = 6
const NEAR_DUPLICATE_OVERLAP = 0.8

const tokens = (t: string) => new Set((t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3))

/**
 * Two texts say almost the same thing when most of the shorter one's words are in the other.
 * Deliberately strict (a long enough text, a high overlap) so only near-verbatim restatements
 * match; a paraphrase is still folded, and shows in the report for the owner to judge.
 */
export function isNearDuplicate(a: string, b: string): boolean {
  const ta = tokens(a)
  const tb = tokens(b)
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta]
  if (small.size < NEAR_DUPLICATE_MIN_TOKENS) return false
  let shared = 0
  for (const w of small) if (large.has(w)) shared++
  return shared / small.size >= NEAR_DUPLICATE_OVERLAP
}

/** The lines of the note's Overview section, as bullets or prose, normalised; empty when there is no Overview. */
function overviewLines(summary: string): Set<string> {
  const lines = summary.split(/\r?\n/)
  const start = lines.findIndex((l) => OVERVIEW_HEADING.test(l.trim()))
  const found = new Set<string>()
  if (start === -1) return found
  for (let i = start + 1; i < lines.length; i++) {
    if (ANY_HEADING.test(lines[i].trim())) break
    const text = normalize(lines[i].replace(/^\s*[-*]\s+/, ''))
    if (text) found.add(text)
  }
  return found
}

/**
 * Adds a block of responsibilities to the Overview section of a note: at the end
 * of an existing `## Overview` section, or as a new `## Overview` section at the
 * end of the note. Wording is never changed. Returns the appended text and the
 * resulting note.
 */
export function foldIntoOverview(
  summary: string,
  responsibilities: string[],
): { addition: string; after: string; placement: 'existing_overview' | 'new_section' } {
  const block = `${FOLD_LEAD_IN}\n${responsibilities.map((r) => `- ${r}`).join('\n')}`
  const lines = summary.split('\n')
  const start = lines.findIndex((l) => OVERVIEW_HEADING.test(l.trim()))
  if (start === -1) {
    const addition = `## Overview\n\n${block}`
    return { addition, placement: 'new_section', after: summary.trim() ? `${summary.replace(/\s+$/, '')}\n\n${addition}\n` : `${addition}\n` }
  }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (ANY_HEADING.test(lines[i].trim())) { end = i; break }
  }
  // Trim trailing blank lines of the section so the block sits right after the last content.
  let insertAt = end
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === '') insertAt--
  const before = lines.slice(0, insertAt)
  const rest = lines.slice(insertAt)
  const after = [...before, '', ...block.split('\n'), ...(rest.length && rest[0].trim() !== '' ? [''] : []), ...rest].join('\n')
  return { addition: block, after, placement: 'existing_overview' }
}

export function planBackfill(input: BackfillInput): BackfillReport {
  const experienceById = new Map(input.experiences.map((e) => [e.id, e]))
  const projectById = new Map(input.projects.map((p) => [p.id, p]))
  const roleOf = (id: string): Role | null => {
    const e = experienceById.get(id)
    return e ? { experienceId: e.id, company: e.company, role: e.role } : null
  }

  const projectsWithoutRole = input.projects
    .filter((p) => !p.experienceId || !experienceById.has(p.experienceId))
    .map((p) => {
      const mine = input.activities.filter((a) => a.projectId === p.id)
      return { id: p.id, name: p.name, activityCount: mine.length, activitiesWithRole: mine.filter((a) => a.experienceId && experienceById.has(a.experienceId)).length }
    })

  const activitiesToAssign: BackfillReport['activitiesToAssign'] = []
  const activitiesUnresolved: BackfillReport['activitiesUnresolved'] = []
  const activitiesMismatched: BackfillReport['activitiesMismatched'] = []
  // The role each activity will end up with, for the responsibility fold.
  const effectiveRole = new Map<string, string>()

  for (const a of input.activities) {
    const project = a.projectId ? projectById.get(a.projectId) ?? null : null
    const owner = a.experienceId && experienceById.has(a.experienceId) ? a.experienceId : null
    if (owner) {
      effectiveRole.set(a.id, owner)
      if (project?.experienceId && project.experienceId !== owner && experienceById.has(project.experienceId)) {
        activitiesMismatched.push({
          id: a.id, description: a.description, experienceId: owner,
          projectId: project.id, projectName: project.name, projectExperienceId: project.experienceId,
        })
      }
      continue
    }
    if (a.projectId && project) {
      const role = project.experienceId ? roleOf(project.experienceId) : null
      if (role) {
        effectiveRole.set(a.id, role.experienceId)
        activitiesToAssign.push({ id: a.id, description: a.description, projectId: project.id, projectName: project.name, ...role })
      } else {
        activitiesUnresolved.push({ id: a.id, description: a.description, projectId: project.id, projectName: project.name, reason: 'project_without_role' })
      }
      continue
    }
    activitiesUnresolved.push({ id: a.id, description: a.description, projectId: a.projectId, projectName: null, reason: 'no_owner' })
  }

  const folds: BackfillReport['folds'] = []
  const foldsSkipped: BackfillReport['foldsSkipped'] = []
  const nearDuplicates: BackfillReport['nearDuplicates'] = []
  for (const e of input.experiences) {
    const mine = input.activities.filter((a) => a.kind === 'responsibility' && effectiveRole.get(a.id) === e.id && a.description.trim())
    if (!mine.length) continue
    // "Already there" means the same line is in the Overview, not merely somewhere in the note: text under a
    // Responsibilities heading still has to reach the Overview.
    const inOverview = overviewLines(e.summary)
    const achievements = input.activities.filter((a) => a.kind === 'achievement' && effectiveRole.get(a.id) === e.id)
    const seen = new Set<string>()
    const toAdd: string[] = []
    const alreadyInNote: string[] = []
    for (const a of mine) {
      const text = a.description.trim()
      const key = normalize(text)
      if (seen.has(key)) continue
      seen.add(key)
      if (inOverview.has(key)) { alreadyInNote.push(text); continue }
      const twin = achievements.find((x) => isNearDuplicate(text, x.description))
      if (twin) {
        nearDuplicates.push({ experienceId: e.id, company: e.company, role: e.role, responsibility: text, achievementId: twin.id, achievement: twin.description })
        continue
      }
      toAdd.push(text)
    }
    if (!toAdd.length) continue
    if (e.summary.includes(FOLD_LEAD_IN)) {
      foldsSkipped.push({ experienceId: e.id, company: e.company, role: e.role, reason: 'already_folded', responsibilities: toAdd })
      continue
    }
    const { addition, after, placement } = foldIntoOverview(e.summary, toAdd)
    folds.push({ experienceId: e.id, company: e.company, role: e.role, responsibilities: toAdd, alreadyInNote, placement, addition, before: e.summary, after })
  }

  return {
    projectsWithoutRole,
    activitiesToAssign,
    activitiesUnresolved,
    activitiesMismatched,
    folds,
    foldsSkipped,
    nearDuplicates,
    counts: {
      experiences: input.experiences.length,
      independentExperiences: input.experiences.filter((e) => e.type === 'independent').length,
      projects: input.projects.length,
      activities: input.activities.length,
      responsibilities: input.activities.filter((a) => a.kind === 'responsibility').length,
      achievements: input.activities.filter((a) => a.kind === 'achievement').length,
    },
  }
}

const clip = (t: string, n = 110) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t)
const roleLabel = (r: { company: string; role: string }) => `${r.role} at ${r.company}`

/** The report as text for the owner to read. Nothing in it is applied. */
export function formatReport(r: BackfillReport): string {
  const out: string[] = []
  const c = r.counts
  out.push('PROFILE MODEL BACKFILL: DRY RUN (nothing has been changed)')
  out.push(`${c.experiences} experiences, ${c.projects} projects, ${c.activities} activities (${c.achievements} achievements, ${c.responsibilities} responsibilities)`)
  out.push('')

  out.push(`1. Projects with no role: ${r.projectsWithoutRole.length}`)
  if (r.projectsWithoutRole.length) out.push('   You choose where each goes. Default offered: "Independent projects".')
  for (const p of r.projectsWithoutRole) {
    out.push(`   - ${p.name} (${p.activityCount} activities${p.activitiesWithRole ? `, ${p.activitiesWithRole} already have a role of their own: check it matches the role you choose` : ''})`)
  }
  out.push('')

  out.push(`2. Activities owned only by a project (will take the project's role): ${r.activitiesToAssign.length}`)
  for (const a of r.activitiesToAssign) out.push(`   - [${a.projectName}] ${clip(a.description)}  →  ${roleLabel(a)}`)
  out.push('')

  out.push(`3. Activities that cannot get a role from the data: ${r.activitiesUnresolved.length}`)
  for (const a of r.activitiesUnresolved) {
    out.push(`   - ${clip(a.description)}  (${a.reason === 'project_without_role' ? `project "${a.projectName}" has no role` : 'no role and no project'})`)
  }
  out.push('')

  out.push(`4. Activities whose role and project's role disagree: ${r.activitiesMismatched.length}`)
  for (const a of r.activitiesMismatched) out.push(`   - [${a.projectName}] ${clip(a.description)}  (you decide which role is right)`)
  out.push('')

  out.push(`5. Responsibilities to fold into a role's Overview: ${r.folds.reduce((n, f) => n + f.responsibilities.length, 0)} in ${r.folds.length} roles`)
  for (const f of r.folds) {
    const where = f.placement === 'existing_overview' ? 'added to the end of its existing ## Overview' : 'a new ## Overview section added at the end of the note'
    out.push(`   ${roleLabel(f)}: ${where}${f.alreadyInNote.length ? ` (${f.alreadyInNote.length} already in the Overview, skipped)` : ''}`)
    for (const line of f.addition.split('\n')) out.push(`   | ${line}`)
  }
  for (const f of r.foldsSkipped) {
    out.push(`   ${roleLabel(f)}: NOT folded, its note was already folded once; ${f.responsibilities.length} newer responsibilities are not in the Overview`)
  }
  out.push('')
  out.push(`6. Responsibilities left out because an achievement already says almost the same: ${r.nearDuplicates.length}`)
  for (const d of r.nearDuplicates) {
    out.push(`   ${roleLabel(d)}`)
    out.push(`   | responsibility: ${clip(d.responsibility, 140)}`)
    out.push(`   | achievement:    ${clip(d.achievement, 140)}`)
  }
  return out.join('\n')
}
