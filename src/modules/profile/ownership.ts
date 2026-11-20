/** The role is the authority for access to evidence. */
export function activityOwnedBy(profileId: string) {
  return { experience: { profileId } }
}

/** A project's role by project id, for the profile's own projects. */
export type ProjectRoles = ReadonlyMap<string, string | null>

/**
 * Whether an activity that names a project is read as that project's evidence.
 *
 * An activity can carry both a role and a project (the role owns it, the project labels it). Readers keep
 * the hierarchy role → project → evidence: a labelled activity is shown, counted and offered under its
 * project, which sits inside the role, so it never appears twice. Without this, giving a project-only
 * activity its role would double it in the vault, the readiness counts, the profile page and the CV menu.
 *
 * It is the project's when it has no role of its own (legacy snapshots) or the same role as
 * the project. If the two roles disagree, the activity's own role is trusted and it stays the role's: it is
 * never hidden under a project of another role.
 */
export function belongsToProject(a: { experienceId: string | null }, projectRole: string | null): boolean {
  return a.experienceId === null || a.experienceId === projectRole
}

/** The role-side view of the same rule: does this activity of a role read as one of the profile's projects' evidence? */
export function isProjectEvidence(a: { projectId: string | null; experienceId: string | null }, projectRoles: ProjectRoles): boolean {
  if (!a.projectId || !projectRoles.has(a.projectId)) return false
  return belongsToProject(a, projectRoles.get(a.projectId) ?? null)
}

/** The evidence a role holds directly: its activities that are not read as a project's. */
export function roleOwnEvidence<T extends { projectId: string | null; experienceId: string | null }>(activities: readonly T[], projectRoles: ProjectRoles): T[] {
  return activities.filter((a) => !isProjectEvidence(a, projectRoles))
}

/** A project's evidence: the activities of its own list that are read as its own (not a role's, when the two roles disagree). */
export function projectEvidenceOf<T extends { experienceId: string | null }>(activities: readonly T[], projectRole: string | null): T[] {
  return activities.filter((a) => belongsToProject(a, projectRole))
}
