import type { Prisma } from '@prisma/client'

/** Evidence belongs to a role or a project; either way it must trace back to the profile. */
export function activityOwnedBy(profileId: string): Prisma.RoleActivityWhereInput {
  return { OR: [{ experience: { profileId } }, { project: { profileId } }] }
}

/**
 * The evidence a role holds directly: activities not labelled with one of the profile's projects.
 *
 * An activity can carry both a role and a project (the role owns it, the project labels it). Readers
 * keep the hierarchy role → project → evidence: a labelled activity is shown, counted and offered
 * under its project, which sits inside the role, so it never appears twice. Without this, giving a
 * project-only activity its role would double it in the vault, the readiness counts, the profile page
 * and the CV menu.
 */
export function roleOwnEvidence<T extends { projectId: string | null }>(activities: readonly T[], projectIds: ReadonlySet<string>): T[] {
  return activities.filter((a) => !(a.projectId && projectIds.has(a.projectId)))
}
