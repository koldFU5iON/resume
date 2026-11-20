// Folds responsibilities into Overview after the owner approves the dry-run fingerprint.
// Required role assignments are handled by the 3e migration.

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

/** Why a plan must not be applied, or null when it can be. Only the owner can resolve these. */
export function blockers(report: BackfillReport): string | null {
  const parts: string[] = []
  if (report.activitiesToAssign.length) parts.push('the required profile roles migration is needed')
  if (report.projectsWithoutRole.length) parts.push(`${report.projectsWithoutRole.length} projects have no role`)
  if (report.activitiesUnresolved.length) parts.push(`${report.activitiesUnresolved.length} activities cannot get a role`)
  if (report.activitiesMismatched.length) parts.push(`${report.activitiesMismatched.length} activities disagree with their project's role`)
  return parts.length ? `Not applying: ${parts.join('; ')}. Resolve these first (see the report).` : null
}

/** A short hash of exactly what a run would write: which notes, from which revision, to which text. */
export function planFingerprint(report: BackfillReport, input: BackfillInput): string {
  const roleRevision = new Map(input.experiences.map((e) => [e.id, e.revision]))
  const projectRevision = new Map(input.projects.map((p) => [p.id, p.revision]))
  const parts = [
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
  const after = planBackfill({
    experiences: input.experiences.map((e) => ({ ...e, summary: folded.get(e.id) ?? e.summary })),
    projects: input.projects.map((p) => ({ ...p, notes: foldedProjects.get(p.id) ?? p.notes })),
    activities: input.activities,
  })
  if (after.activitiesToAssign.length || after.folds.length || after.projectFolds.length) throw new Error('The result was not stable on a second pass. Nothing was applied.')
  return summarisePlan(report)
}
