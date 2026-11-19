// Dry-run plan for the profile model simplification (design doc
// docs/superpowers/specs/2026-11-19-profile-model-simplification-design.md, §6).
//
// Pure: takes rows, returns what a later migration would do and what only the
// owner can decide. It writes nothing and calls no database. The script
// scripts/profile-model-backfill-report.ts feeds it real rows and prints the
// result; the constraints and the Overview fold are applied in a later PR,
// only after the owner has read this report.

export type BackfillExperience = { id: string; company: string; role: string; type: string; summary: string; revision: number }
export type BackfillProject = { id: string; name: string; experienceId: string | null; notes: string; revision: number }
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
  /** Roles whose own responsibilities would be folded into the Overview text. */
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
  /**
   * Responsibilities that belong only to a project (no role of their own) are folded into that project's
   * note, not into the role's: they describe the project. The same rules apply as for a role.
   */
  projectFolds: {
    projectId: string
    name: string
    responsibilities: string[]
    alreadyInNote: string[]
    placement: 'existing_overview' | 'new_section'
    addition: string
    before: string
    after: string
  }[]
  /** Responsibilities left out of the fold because an achievement of the same role or project already says almost the same thing. Nothing is lost: the achievement keeps the wording. */
  nearDuplicates: { owner: string; experienceId?: string; projectId?: string; responsibility: string; achievementId: string; achievement: string }[]
  /** Notes left out of the fold because they were already folded once; they still have responsibilities not in the Overview. */
  foldsSkipped: { owner: string; experienceId?: string; projectId?: string; reason: 'already_folded'; responsibilities: string[] }[]
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

const OVERVIEW_HEADING = /^#{1,2}\s+overview\s*$/i // matched on the raw line, as the note parser does
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
  const start = lines.findIndex((l) => OVERVIEW_HEADING.test(l.trimEnd()))
  const found = new Set<string>()
  if (start === -1) return found
  for (let i = start + 1; i < lines.length; i++) {
    if (ANY_HEADING.test(lines[i])) break
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
  // A description that runs over several lines stays one bullet: continuation lines are indented, so a line
  // that starts with "#" in the owner's text can never be read as a heading.
  const block = `${FOLD_LEAD_IN}\n${responsibilities.map((r) => `- ${r.replace(/\r\n?/g, '\n').split('\n').join('\n  ')}`).join('\n')}`
  const lines = summary.replace(/\r\n?/g, '\n').split('\n')
  const start = lines.findIndex((l) => OVERVIEW_HEADING.test(l.trimEnd()))
  if (start === -1) {
    const addition = `## Overview\n\n${block}`
    return { addition, placement: 'new_section', after: summary.trim() ? `${summary.replace(/\s+$/, '')}\n\n${addition}\n` : `${addition}\n` }
  }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (ANY_HEADING.test(lines[i])) { end = i; break }
  }
  // Trim trailing blank lines of the section so the block sits right after the last content.
  let insertAt = end
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === '') insertAt--
  const before = lines.slice(0, insertAt)
  const rest = lines.slice(insertAt)
  const after = [...before, '', ...block.split('\n'), ...(rest.length && rest[0].trim() !== '' ? [''] : []), ...rest].join('\n')
  return { addition: block, after, placement: 'existing_overview' }
}

type FoldPlan =
  | { skip: 'nothing' }
  | { skip: 'already_folded'; responsibilities: string[] }
  | { skip?: undefined; responsibilities: string[]; alreadyInNote: string[]; placement: 'existing_overview' | 'new_section'; addition: string; after: string }

/**
 * What to do with one note: which responsibilities go into its Overview, which are already there,
 * and which an achievement (of the same role or project) already restates.
 */
function planNoteFold(
  note: string,
  responsibilities: { description: string }[],
  achievements: { id: string; description: string }[],
  onNearDuplicate: (d: { responsibility: string; achievementId: string; achievement: string }) => void,
): FoldPlan {
  // "Already there" means the same line is in the Overview, not merely somewhere in the note: text under a
  // Responsibilities heading still has to reach the Overview.
  const inOverview = overviewLines(note)
  const seen = new Set<string>()
  const toAdd: string[] = []
  const alreadyInNote: string[] = []
  for (const a of responsibilities) {
    const text = a.description.trim()
    if (!text) continue
    const key = normalize(text)
    if (seen.has(key)) continue
    seen.add(key)
    if (inOverview.has(key)) { alreadyInNote.push(text); continue }
    const twin = achievements.find((x) => isNearDuplicate(text, x.description))
    if (twin) { onNearDuplicate({ responsibility: text, achievementId: twin.id, achievement: twin.description }); continue }
    toAdd.push(text)
  }
  if (!toAdd.length) return { skip: 'nothing' }
  if (note.includes(FOLD_LEAD_IN)) return { skip: 'already_folded', responsibilities: toAdd }
  const { addition, after, placement } = foldIntoOverview(note, toAdd)
  return { responsibilities: toAdd, alreadyInNote, placement, addition, after }
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
  // The role each activity will end up with (for matching achievements), and the activities that have a role of their own.
  const effectiveRole = new Map<string, string>()
  const ownRole = new Map<string, string>()

  for (const a of input.activities) {
    const project = a.projectId ? projectById.get(a.projectId) ?? null : null
    const owner = a.experienceId && experienceById.has(a.experienceId) ? a.experienceId : null
    if (owner) {
      effectiveRole.set(a.id, owner)
      ownRole.set(a.id, owner)
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
  const projectFolds: BackfillReport['projectFolds'] = []
  const foldsSkipped: BackfillReport['foldsSkipped'] = []
  const nearDuplicates: BackfillReport['nearDuplicates'] = []

  for (const e of input.experiences) {
    const owner = `${e.role} at ${e.company}`
    const mine = input.activities.filter((a) => a.kind === 'responsibility' && ownRole.get(a.id) === e.id)
    if (!mine.length) continue
    const achievements = input.activities.filter((a) => a.kind === 'achievement' && effectiveRole.get(a.id) === e.id)
    const plan = planNoteFold(e.summary, mine, achievements, (d) => nearDuplicates.push({ owner, experienceId: e.id, ...d }))
    if (plan.skip === 'already_folded') foldsSkipped.push({ owner, experienceId: e.id, reason: 'already_folded', responsibilities: plan.responsibilities })
    else if (!plan.skip) folds.push({ experienceId: e.id, company: e.company, role: e.role, responsibilities: plan.responsibilities, alreadyInNote: plan.alreadyInNote, placement: plan.placement, addition: plan.addition, before: e.summary, after: plan.after })
  }

  for (const p of input.projects) {
    const owner = `project "${p.name}"`
    // Only responsibilities that have no role of their own: those belong to the project.
    const mine = input.activities.filter((a) => a.kind === 'responsibility' && a.projectId === p.id && !ownRole.has(a.id))
    if (!mine.length) continue
    const achievements = input.activities.filter((a) => a.kind === 'achievement' && a.projectId === p.id)
    const plan = planNoteFold(p.notes, mine, achievements, (d) => nearDuplicates.push({ owner, projectId: p.id, ...d }))
    if (plan.skip === 'already_folded') foldsSkipped.push({ owner, projectId: p.id, reason: 'already_folded', responsibilities: plan.responsibilities })
    else if (!plan.skip) projectFolds.push({ projectId: p.id, name: p.name, responsibilities: plan.responsibilities, alreadyInNote: plan.alreadyInNote, placement: plan.placement, addition: plan.addition, before: p.notes, after: plan.after })
  }

  return {
    projectsWithoutRole,
    activitiesToAssign,
    activitiesUnresolved,
    activitiesMismatched,
    folds,
    projectFolds,
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

  out.push(`5. Responsibilities to fold into an Overview: ${r.folds.reduce((n, f) => n + f.responsibilities.length, 0)} in ${r.folds.length} roles, ${r.projectFolds.reduce((n, f) => n + f.responsibilities.length, 0)} in ${r.projectFolds.length} projects`)
  for (const f of r.folds) {
    const where = f.placement === 'existing_overview' ? 'added to the end of its existing ## Overview' : 'a new ## Overview section added at the end of the note'
    out.push(`   ${roleLabel(f)}: ${where}${f.alreadyInNote.length ? ` (${f.alreadyInNote.length} already in the Overview, skipped)` : ''}`)
    for (const line of f.addition.split('\n')) out.push(`   | ${line}`)
  }
  for (const f of r.projectFolds) {
    const where = f.placement === 'existing_overview' ? 'added to the end of its existing ## Overview' : 'a new ## Overview section added at the end of the note'
    out.push(`   project "${f.name}": ${where}${f.alreadyInNote.length ? ` (${f.alreadyInNote.length} already in the Overview, skipped)` : ''}`)
    for (const line of f.addition.split('\n')) out.push(`   | ${line}`)
  }
  for (const f of r.foldsSkipped) {
    out.push(`   ${f.owner}: NOT folded, its note was already folded once; ${f.responsibilities.length} newer responsibilities are not in the Overview`)
  }
  out.push('')
  out.push(`6. Responsibilities left out because an achievement already says almost the same: ${r.nearDuplicates.length}`)
  for (const d of r.nearDuplicates) {
    out.push(`   ${d.owner}`)
    out.push(`   | responsibility: ${clip(d.responsibility, 140)}`)
    out.push(`   | achievement:    ${clip(d.achievement, 140)}`)
  }
  return out.join('\n')
}
