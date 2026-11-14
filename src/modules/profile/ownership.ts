import type { Prisma } from '@prisma/client'

/** Evidence belongs to a role or a project; either way it must trace back to the profile. */
export function activityOwnedBy(profileId: string): Prisma.RoleActivityWhereInput {
  return { OR: [{ experience: { profileId } }, { project: { profileId } }] }
}
