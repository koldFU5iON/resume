// Applies the profile model backfill (docs/superpowers/specs/2026-11-19-profile-model-simplification-design.md, §6)
// for one profile: gives project-only activities their project's role, and folds
// responsibilities into each role's Overview. Used by scripts/profile-model-backfill-apply.ts,
// which the owner runs after reading the dry-run report.
//
// Guards:
//  - Everything runs in the caller's transaction, so a failure leaves nothing changed.
//  - A role's note is only changed if its revision is still the one the report was built from
//    (the same check the editor uses), so a note edited meanwhile is never overwritten.
//  - An activity is only assigned if it still has no role.
//  - Afterwards the plan is rebuilt from the changed rows and must be empty (idempotent);
//    if not, the transaction is rolled back.
//  - No row is deleted, and no wording is changed.

import { planBackfill, type BackfillInput, type BackfillReport } from './model-backfill'

/** The slice of a Prisma transaction client this needs, so it can be tested without a database. */
export type BackfillTx = {
  roleActivity: {
    updateMany(args: { where: { id: string; experienceId: null }; data: { experienceId: string } }): Promise<{ count: number }>
  }
  experience: {
    updateMany(args: {
      where: { id: string; profileId: string; revision: number }
      data: { summary: string; notesUpdatedAt: Date; revision: { increment: number } }
    }): Promise<{ count: number }>
  }
}

export type ApplyResult = { activitiesAssigned: number; notesFolded: number }

/** What applying would change, without touching anything. */
export function summarisePlan(report: BackfillReport): ApplyResult {
  return { activitiesAssigned: report.activitiesToAssign.length, notesFolded: report.folds.length }
}

/** Why a plan must not be applied, or null when it can be. Only the owner can resolve these. */
export function blockers(report: BackfillReport): string | null {
  const parts: string[] = []
  if (report.projectsWithoutRole.length) parts.push(`${report.projectsWithoutRole.length} projects have no role`)
  if (report.activitiesUnresolved.length) parts.push(`${report.activitiesUnresolved.length} activities cannot get a role`)
  if (report.activitiesMismatched.length) parts.push(`${report.activitiesMismatched.length} activities disagree with their project's role`)
  return parts.length ? `Not applying: ${parts.join('; ')}. Resolve these first (see the report).` : null
}

export async function applyBackfill(
  tx: BackfillTx,
  profileId: string,
  input: BackfillInput,
  report: BackfillReport,
  now: Date = new Date(),
): Promise<ApplyResult> {
  const blocked = blockers(report)
  if (blocked) throw new Error(blocked)

  const revisionOf = new Map(input.experiences.map((e) => [e.id, e.revision]))

  for (const a of report.activitiesToAssign) {
    const res = await tx.roleActivity.updateMany({ where: { id: a.id, experienceId: null }, data: { experienceId: a.experienceId } })
    if (res.count !== 1) throw new Error('An activity changed since the report was made. Nothing was applied; run the report again.')
  }

  const folded = new Map<string, string>()
  for (const f of report.folds) {
    const revision = revisionOf.get(f.experienceId)
    if (revision === undefined) throw new Error('A role is missing. Nothing was applied; run the report again.')
    const res = await tx.experience.updateMany({
      where: { id: f.experienceId, profileId, revision },
      data: { summary: f.after, notesUpdatedAt: now, revision: { increment: 1 } },
    })
    if (res.count !== 1) throw new Error(`The note for ${f.role} at ${f.company} changed since the report was made. Nothing was applied; run the report again.`)
    folded.set(f.experienceId, f.after)
  }

  // The same plan, rebuilt from the rows as they now are, must have nothing left to do.
  const assigned = new Map(report.activitiesToAssign.map((a) => [a.id, a.experienceId]))
  const after = planBackfill({
    experiences: input.experiences.map((e) => ({ ...e, summary: folded.get(e.id) ?? e.summary })),
    projects: input.projects,
    activities: input.activities.map((a) => ({ ...a, experienceId: assigned.get(a.id) ?? a.experienceId })),
  })
  if (after.activitiesToAssign.length || after.folds.length) {
    throw new Error('The result was not stable on a second pass. Nothing was applied.')
  }
  return summarisePlan(report)
}
