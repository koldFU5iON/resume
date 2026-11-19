// Dry-run plan for the profile model simplification (design doc
// docs/superpowers/specs/2026-11-19-profile-model-simplification-design.md, §6).
//
// Pure: takes rows, returns what a later migration would do and what only the
// owner can decide. It writes nothing and calls no database. The script
// scripts/profile-model-backfill-report.ts feeds it real rows and prints the
// result; the constraints and the Overview fold are applied in a later PR,
// only after the owner has read this report.

export type BackfillExperience = { id: string; company: string; role: string; type: string; summary: string }
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
  projectsWithoutRole: { id: string; name: string; activityCount: number }[]
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
    /** The exact text appended to the note. */
    addition: string
    /** The note after the fold. */
    after: string
  } & Role)[]
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

/**
 * Adds a block of responsibilities to the Overview section of a note: at the end
 * of an existing `## Overview` section, or as a new `## Overview` section at the
 * end of the note. Wording is never changed. Returns the appended text and the
 * resulting note.
 */
export function foldIntoOverview(summary: string, responsibilities: string[]): { addition: string; after: string } {
  const block = `${FOLD_LEAD_IN}\n${responsibilities.map((r) => `- ${r}`).join('\n')}`
  const lines = summary.split('\n')
  const start = lines.findIndex((l) => OVERVIEW_HEADING.test(l.trim()))
  if (start === -1) {
    const addition = `## Overview\n\n${block}`
    return { addition, after: summary.trim() ? `${summary.replace(/\s+$/, '')}\n\n${addition}\n` : `${addition}\n` }
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
  return { addition: block, after }
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
    .map((p) => ({ id: p.id, name: p.name, activityCount: input.activities.filter((a) => a.projectId === p.id).length }))

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
  for (const e of input.experiences) {
    if (e.summary.includes(FOLD_LEAD_IN)) continue
    const mine = input.activities.filter((a) => a.kind === 'responsibility' && effectiveRole.get(a.id) === e.id && a.description.trim())
    if (!mine.length) continue
    const note = normalize(e.summary)
    const seen = new Set<string>()
    const toAdd: string[] = []
    const alreadyInNote: string[] = []
    for (const a of mine) {
      const text = a.description.trim()
      const key = normalize(text)
      if (seen.has(key)) continue
      seen.add(key)
      ;(note.includes(key) ? alreadyInNote : toAdd).push(text)
    }
    if (!toAdd.length) continue
    const { addition, after } = foldIntoOverview(e.summary, toAdd)
    folds.push({ experienceId: e.id, company: e.company, role: e.role, responsibilities: toAdd, alreadyInNote, addition, after })
  }

  return {
    projectsWithoutRole,
    activitiesToAssign,
    activitiesUnresolved,
    activitiesMismatched,
    folds,
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
  for (const p of r.projectsWithoutRole) out.push(`   - ${p.name} (${p.activityCount} activities)`)
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
    out.push(`   ${roleLabel(f)}${f.alreadyInNote.length ? ` (${f.alreadyInNote.length} already in the note, skipped)` : ''}`)
    for (const line of f.addition.split('\n')) out.push(`   | ${line}`)
  }
  return out.join('\n')
}
