// Applies the Overview fold of the profile model backfill
// (docs/superpowers/specs/2026-11-19-profile-model-simplification-design.md, §6) for one profile:
// each role's responsibilities are written into its Overview text. Used by
// scripts/profile-model-backfill-apply.ts, which the owner runs after reading the dry-run report.
//
// A responsibility that belongs only to a project goes into that project's note (Project.notes), not
// the role's. This changes ONLY Experience.summary and Project.notes (and their revisions). It does not touch
// RoleActivity rows. Giving project-only activities a role is a separate step that lands with the
// code that reads and writes the new ownership (the design's later PR), because changing those
// rows first would break deleting a role, moving a project and the vault counts.
//
// Guards:
//  - One transaction: a failed guard leaves nothing changed.
//  - The owner approves a fingerprint of exactly what will be written (printed by the dry run).
//    The plan is rebuilt inside the transaction and must produce the same fingerprint, so a note or
//    responsibility edited after the owner read the report stops the run.
//  - A note is only changed if its revision is unchanged (the check the editor uses).
//  - Afterwards the plan is rebuilt from the changed rows and must have nothing left to fold.
//  - No row is deleted, and no wording is changed.

import { createHash } from 'node:crypto'
import { planBackfill, type BackfillInput, type BackfillReport } from './model-backfill'

/** The slice of a Prisma transaction client this needs, so it can be tested without a database. */
export type BackfillTx = {
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

export type ApplyResult = { notesFolded: number; responsibilitiesFolded: number }

/** What applying would change, without touching anything. */
export function summarisePlan(report: BackfillReport): ApplyResult {
  const all = [...report.folds, ...report.projectFolds]
  return { notesFolded: all.length, responsibilitiesFolded: all.reduce((n, f) => n + f.responsibilities.length, 0) }
}

/** A short hash of exactly what a run would write: which notes, from which revision, to which text. */
export function foldFingerprint(report: BackfillReport, input: BackfillInput): string {
  const roleRevision = new Map(input.experiences.map((e) => [e.id, e.revision]))
  const projectRevision = new Map(input.projects.map((p) => [p.id, p.revision]))
  const parts = [
    ...report.folds.map((f) => ({ id: `role:${f.experienceId}`, revision: roleRevision.get(f.experienceId) ?? null, after: f.after })),
    ...report.projectFolds.map((f) => ({ id: `project:${f.projectId}`, revision: projectRevision.get(f.projectId) ?? null, after: f.after })),
  ].sort((a, b) => a.id.localeCompare(b.id))
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 12)
}

export async function applyFold(
  tx: BackfillTx,
  profileId: string,
  input: BackfillInput,
  report: BackfillReport,
  approvedFingerprint: string,
  now: Date = new Date(),
): Promise<ApplyResult> {
  const fingerprint = foldFingerprint(report, input)
  if (fingerprint !== approvedFingerprint) {
    throw new Error(`What would be written (${fingerprint}) is not what you approved (${approvedFingerprint}): something changed since the dry run. Nothing was applied; read the new dry run first.`)
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

  // The same plan, rebuilt from the notes as they now are, must have nothing left to fold.
  const after = planBackfill({
    experiences: input.experiences.map((e) => ({ ...e, summary: folded.get(e.id) ?? e.summary })),
    projects: input.projects.map((p) => ({ ...p, notes: foldedProjects.get(p.id) ?? p.notes })),
    activities: input.activities,
  })
  if (after.folds.length || after.projectFolds.length) throw new Error('The result was not stable on a second pass. Nothing was applied.')
  return summarisePlan(report)
}
