// Applies the profile model backfill (docs/superpowers/specs/2026-11-19-profile-model-simplification-design.md, §6,
// §13 step 3c) for one profile, in one transaction:
//  - gives each project-only activity its project's role (the project stays as its label), and
//  - folds responsibilities into each role's or project's Overview (already applied on production; a
//    profile with nothing left to fold simply has an empty fold step).
// Used by scripts/profile-model-backfill-apply.ts, which the owner runs after reading the dry-run report.
//
// Guards:
//  - Refuses while the data has things only the owner can resolve (a project with no role, an activity with
//    no usable owner, an activity whose role disagrees with its project's role).
//  - One transaction: a failed guard leaves nothing changed.
//  - The owner approves a fingerprint of exactly what will be written (printed by the dry run). The plan is
//    rebuilt inside the transaction and must produce the same fingerprint, so anything edited after the dry
//    run stops it.
//  - An activity is only assigned if it still has no role, still names the same project, and that project
//    still has the same role. A note is only changed if its revision is unchanged (the editor's own check).
//  - Afterwards the plan is rebuilt from the changed rows and must have nothing left to do.
//  - No row is deleted, and no wording is changed.
//
// The database accepts an activity with both a role and a project since migration 20261119230000, and every
// reader treats such an activity as its project's evidence (src/modules/profile/ownership.ts), so the
// assignment changes nothing a reader sees: `npm run profile:golden-check` shows it before and after.

import { createHash } from 'node:crypto'
import { planBackfill, type BackfillInput, type BackfillReport } from './model-backfill'

/** The slice of a Prisma transaction client this needs, so it can be tested without a database. */
export type BackfillTx = {
  roleActivity: {
    updateMany(args: {
      where: { id: string; experienceId: null; projectId: string; project: { is: { profileId: string; experienceId: string } } }
      data: { experienceId: string }
    }): Promise<{ count: number }>
  }
  project: {
    updateMany(args: {
      where: { id: string; profileId: string; revision: number }
      data: { notes: string; revision: { increment: number } }
    }): Promise<{ count: number }>
  }
  experience: {
    updateMany(args: {
      where: { id: string; profileId: string; revision: number }
      data: { summary: string; notesUpdatedAt: Date; revision: { increment: number } }
    }): Promise<{ count: number }>
  }
}

export type ApplyResult = { activitiesAssigned: number; notesFolded: number; responsibilitiesFolded: number }

/** What applying would change, without touching anything. */
export function summarisePlan(report: BackfillReport): ApplyResult {
  const all = [...report.folds, ...report.projectFolds]
  return { activitiesAssigned: report.activitiesToAssign.length, notesFolded: all.length, responsibilitiesFolded: all.reduce((n, f) => n + f.responsibilities.length, 0) }
}

/** Why a plan must not be applied, or null when it can be. Only the owner can resolve these. */
export function blockers(report: BackfillReport): string | null {
  const parts: string[] = []
  if (report.projectsWithoutRole.length) parts.push(`${report.projectsWithoutRole.length} projects have no role`)
  if (report.activitiesUnresolved.length) parts.push(`${report.activitiesUnresolved.length} activities cannot get a role`)
  if (report.activitiesMismatched.length) parts.push(`${report.activitiesMismatched.length} activities disagree with their project's role`)
  return parts.length ? `Not applying: ${parts.join('; ')}. Resolve these first (see the report).` : null
}

/** A short hash of exactly what a run would write: which activities get which role, and which notes, from which revision, to which text. */
export function planFingerprint(report: BackfillReport, input: BackfillInput): string {
  const roleRevision = new Map(input.experiences.map((e) => [e.id, e.revision]))
  const projectRevision = new Map(input.projects.map((p) => [p.id, p.revision]))
  const parts = [
    ...report.activitiesToAssign.map((a) => ({ id: `activity:${a.id}`, revision: null, after: `${a.projectId}>${a.experienceId}` })),
    ...report.folds.map((f) => ({ id: `role:${f.experienceId}`, revision: roleRevision.get(f.experienceId) ?? null, after: f.after })),
    ...report.projectFolds.map((f) => ({ id: `project:${f.projectId}`, revision: projectRevision.get(f.projectId) ?? null, after: f.after })),
  ].sort((a, b) => a.id.localeCompare(b.id))
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 12)
}

export async function applyPlan(
  tx: BackfillTx,
  profileId: string,
  input: BackfillInput,
  report: BackfillReport,
  approvedFingerprint: string,
  now: Date = new Date(),
): Promise<ApplyResult> {
  const fingerprint = planFingerprint(report, input)
  if (fingerprint !== approvedFingerprint) {
    throw new Error(`What would be written (${fingerprint}) is not what you approved (${approvedFingerprint}): something changed since the dry run. Nothing was applied; read the new dry run first.`)
  }
  const blocked = blockers(report)
  if (blocked) throw new Error(blocked)

  for (const a of report.activitiesToAssign) {
    const res = await tx.roleActivity.updateMany({
      where: { id: a.id, experienceId: null, projectId: a.projectId, project: { is: { profileId, experienceId: a.experienceId } } },
      data: { experienceId: a.experienceId },
    })
    if (res.count !== 1) throw new Error('An activity changed since the dry run (its role, its project, or its project\'s role). Nothing was applied; run the dry run again.')
  }

  const revisionOf = new Map(input.experiences.map((e) => [e.id, e.revision]))
  const projectRevisionOf = new Map(input.projects.map((p) => [p.id, p.revision]))
  const folded = new Map<string, string>()
  const foldedProjects = new Map<string, string>()
  for (const f of report.folds) {
    const revision = revisionOf.get(f.experienceId)
    if (revision === undefined) throw new Error('A role is missing. Nothing was applied; run the dry run again.')
    const res = await tx.experience.updateMany({
      where: { id: f.experienceId, profileId, revision },
      data: { summary: f.after, notesUpdatedAt: now, revision: { increment: 1 } },
    })
    if (res.count !== 1) throw new Error(`The note for ${f.role} at ${f.company} changed since it was read. Nothing was applied; run the dry run again.`)
    folded.set(f.experienceId, f.after)
  }
  for (const f of report.projectFolds) {
    const revision = projectRevisionOf.get(f.projectId)
    if (revision === undefined) throw new Error('A project is missing. Nothing was applied; run the dry run again.')
    const res = await tx.project.updateMany({
      where: { id: f.projectId, profileId, revision },
      data: { notes: f.after, revision: { increment: 1 } },
    })
    if (res.count !== 1) throw new Error(`The note for project "${f.name}" changed since it was read. Nothing was applied; run the dry run again.`)
    foldedProjects.set(f.projectId, f.after)
  }

  // The same plan, rebuilt from the rows as they now are, must have nothing left to do.
  const assigned = new Map(report.activitiesToAssign.map((a) => [a.id, a.experienceId]))
  const after = planBackfill({
    experiences: input.experiences.map((e) => ({ ...e, summary: folded.get(e.id) ?? e.summary })),
    projects: input.projects.map((p) => ({ ...p, notes: foldedProjects.get(p.id) ?? p.notes })),
    activities: input.activities.map((a) => ({ ...a, experienceId: assigned.get(a.id) ?? a.experienceId })),
  })
  if (after.activitiesToAssign.length || after.folds.length || after.projectFolds.length) throw new Error('The result was not stable on a second pass. Nothing was applied.')
  return summarisePlan(report)
}
