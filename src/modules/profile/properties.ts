// Saves for the Properties tab: a role's facts and a project's facts. Session-
// free: every function takes the caller's profileId first. Input is validated
// here, not trusted from the form, and a cleared field is written as null (a
// role with no end date is a current role; a project with no role stands alone).

import { prisma } from '@/lib/db'
import { lockRow } from './activity-roles'
import { ExperiencePropertiesSchema, ProjectPropertiesSchema, type ExperienceProperties, type ProjectProperties } from './properties-schema'

export type { ExperienceProperties, ProjectProperties }

/** Saves a role's facts. Throws when the role isn't the caller's or the input is invalid. */
export async function saveExperienceProperties(profileId: string, id: string, input: ExperienceProperties): Promise<void> {
  const data = ExperiencePropertiesSchema.parse(input)
  const updated = await prisma.experience.updateMany({ where: { id, profileId }, data })
  if (updated.count === 0) throw new Error('Experience not found')
}

/**
 * Saves a project's facts, including which role it is part of. Its evidence carries the project's role, so
 * moving the project between roles (or to none) moves that evidence with it. Evidence that carries a
 * different role (it is another role's own) is left alone. One transaction.
 */
export async function saveProjectProperties(profileId: string, id: string, input: ProjectProperties): Promise<void> {
  const data = ProjectPropertiesSchema.parse(input)
  await prisma.$transaction(async (tx) => {
    // Two moves of the same project must not interleave: the second reads the role the first left.
    await lockRow(tx, 'Project', id, profileId)
    const current = await tx.project.findFirst({ where: { id, profileId }, select: { experienceId: true } })
    if (!current) throw new Error('Project not found')
    if (data.experienceId) {
      const role = await tx.experience.findFirst({ where: { id: data.experienceId, profileId }, select: { id: true } })
      if (!role) throw new Error('Experience not found')
    }
    await tx.project.update({ where: { id }, data })
    if (current.experienceId !== data.experienceId) {
      await tx.roleActivity.updateMany({ where: { projectId: id, experienceId: current.experienceId }, data: { experienceId: data.experienceId } })
    }
  })
}
