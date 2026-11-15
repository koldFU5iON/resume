// Saves for the Properties tab: a role's facts and a project's facts. Session-
// free: every function takes the caller's profileId first. Input is validated
// here, not trusted from the form, and a cleared field is written as null (a
// role with no end date is a current role; a project with no role stands alone).

import { prisma } from '@/lib/db'
import { ExperiencePropertiesSchema, ProjectPropertiesSchema, type ExperienceProperties, type ProjectProperties } from './properties-schema'

export type { ExperienceProperties, ProjectProperties }

/** Saves a role's facts. Throws when the role isn't the caller's or the input is invalid. */
export async function saveExperienceProperties(profileId: string, id: string, input: ExperienceProperties): Promise<void> {
  const data = ExperiencePropertiesSchema.parse(input)
  const updated = await prisma.experience.updateMany({ where: { id, profileId }, data })
  if (updated.count === 0) throw new Error('Experience not found')
}

/**
 * Saves a project's facts, including which role it is part of. Its evidence
 * belongs to the project, so moving it between roles moves the evidence too,
 * and its note keeps its address.
 */
export async function saveProjectProperties(profileId: string, id: string, input: ProjectProperties): Promise<void> {
  const data = ProjectPropertiesSchema.parse(input)
  if (data.experienceId) {
    const role = await prisma.experience.findFirst({ where: { id: data.experienceId, profileId }, select: { id: true } })
    if (!role) throw new Error('Experience not found')
  }
  const updated = await prisma.project.updateMany({ where: { id, profileId }, data })
  if (updated.count === 0) throw new Error('Project not found')
}
