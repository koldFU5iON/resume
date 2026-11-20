// The writes that keep an activity's role and project consistent (design doc §13, step 3b).
// Session-free: every function takes the caller's profileId first.
//
// The model: a role owns an activity, a project may label it. An activity that names a project carries
// that project's role (or none, while the project has none). Every write below keeps that true, so no
// activity is left with a role that disagrees with its project's role, and no delete takes evidence the
// owner chose to keep. Readers (src/modules/profile/ownership.ts) already cope with both shapes.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { INDEPENDENT_EXPERIENCE_TYPE } from './experience-type'
import { ensureIndependentExperience } from './independent-experience'

/** The slice of a transaction client `lockRow` needs. */
type RawTx = { $queryRaw: (q: TemplateStringsArray | Prisma.Sql, ...v: unknown[]) => Promise<unknown> }

/**
 * Locks a role or project row until the transaction ends. A write that names it (an insert that references it
 * takes a key-share lock) then waits, and fails cleanly if the row is gone, instead of landing between this
 * transaction's steps and being cascaded away or left on a stale role.
 */
export async function lockRow(tx: RawTx, table: 'Experience' | 'Project', id: string, profileId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE "id" = ${id} AND "profileId" = ${profileId} FOR UPDATE`)
}

/** Where an activity goes: a role, or a project (which also gives it the project's role). */
export type ActivityOwner = { experienceId: string } | { projectId: string }

/** The row fields that set an owner, checked against the profile. */
export type ActivityFields = { experienceId: string | null; projectId: string | null }

/** The slot after the owner's last evidence, so new items land at the end instead of tying at 0. */
export async function nextActivityOrder(owner: ActivityOwner): Promise<number> {
  // A role's own list is the activities it holds directly; those labelled with a project are ordered within the project.
  const where = 'projectId' in owner ? { projectId: owner.projectId } : { experienceId: owner.experienceId, projectId: null }
  const last = await prisma.roleActivity.findFirst({ where, orderBy: { order: 'desc' }, select: { order: true } })
  return (last?.order ?? -1) + 1
}

/**
 * The fields the profile's own owner sets. A project gives its role too (null for a project with none);
 * a role gives no project. Throws when the role or project is not the profile's.
 */
export async function activityFieldsFor(profileId: string, owner: ActivityOwner): Promise<ActivityFields> {
  // A missing id must not match "any row of the profile" (Prisma ignores an undefined filter).
  const id = 'projectId' in owner ? owner.projectId : owner.experienceId
  if (typeof id !== 'string' || !id) throw new Error('projectId' in owner ? 'Project not found' : 'Experience not found')
  if ('projectId' in owner) {
    const project = await prisma.project.findFirst({ where: { id: owner.projectId, profileId }, select: { id: true, experienceId: true } })
    if (!project) throw new Error('Project not found')
    return { experienceId: project.experienceId, projectId: project.id }
  }
  const experience = await prisma.experience.findFirst({ where: { id: owner.experienceId, profileId }, select: { id: true } })
  if (!experience) throw new Error('Experience not found')
  return { experienceId: experience.id, projectId: null }
}

/** The owner a set of fields names, for ordering. */
export const ownerOf = (f: ActivityFields): ActivityOwner => (f.projectId ? { projectId: f.projectId } : { experienceId: f.experienceId! })

/**
 * What deleting a role takes with it, counted from the rows. `evidence` goes either way; `projectEvidence` is
 * the extra that goes only when the role's projects are deleted too. Evidence of another role that sits
 * under one of this role's projects is neither: it is kept.
 */
export async function experienceDeleteImpact(profileId: string, id: string) {
  const [evidence, projects, projectEvidence] = await Promise.all([
    prisma.roleActivity.count({
      where: {
        experienceId: id,
        experience: { profileId },
        // Carries the role and is not held by one of the role's own projects (those are kept when the projects are).
        OR: [{ projectId: null }, { project: { is: { experienceId: null } } }, { project: { is: { experienceId: { not: id } } } }],
      },
    }),
    prisma.project.count({ where: { experienceId: id, profileId } }),
    prisma.roleActivity.count({ where: { project: { experienceId: id, profileId }, OR: [{ experienceId: null }, { experienceId: id }] } }),
  ])
  return { evidence, projects, projectEvidence }
}

/**
 * Deletes a role. `keep` MOVES its projects, with their evidence, to the independent experience ("Independent
 * projects", created if need be), so nothing the owner chose to keep is lost or left homeless; `delete` removes
 * the projects and their evidence too. Evidence of another role that sits under one of these projects is always
 * kept, as that role's own. The independent experience itself cannot be deleted with `keep` (there is nowhere to
 * move to). One transaction. A role that is already gone is a no-op.
 */
export async function deleteExperienceRow(profileId: string, id: string, projects: 'keep' | 'delete'): Promise<void> {
  const experience = await prisma.experience.findFirst({ where: { id, profileId }, select: { id: true, type: true } })
  if (!experience) return
  if (projects === 'keep' && experience.type === INDEPENDENT_EXPERIENCE_TYPE) {
    throw new Error('Independent projects is where kept projects live: delete its projects too, or move them to a role first.')
  }
  await prisma.$transaction(async (tx) => {
    await lockRow(tx, 'Experience', id, profileId)
    if (projects === 'keep') {
      const home = await ensureIndependentExperience(tx, profileId)
      // This role's evidence under its projects moves with them (the cascade from the role would delete it)...
      await tx.roleActivity.updateMany({ where: { experienceId: id, project: { experienceId: id, profileId } }, data: { experienceId: home } })
      // A legacy project-only row takes the role the project is moving to, like every write keeps it (a project's
      // evidence carries the project's role).
      await tx.roleActivity.updateMany({ where: { experienceId: null, project: { experienceId: id, profileId } }, data: { experienceId: home } })
      // ...and the projects themselves.
      await tx.project.updateMany({ where: { experienceId: id, profileId }, data: { experienceId: home } })
    } else {
      // The projects are going: another role's evidence under them must not go with them. It keeps its role and
      // loses only the label. (When the projects are kept it keeps the label too; readers trust its own role.)
      await tx.roleActivity.updateMany({
        where: { project: { experienceId: id, profileId }, AND: [{ experienceId: { not: null } }, { experienceId: { not: id } }] },
        data: { projectId: null },
      })
      await tx.project.deleteMany({ where: { experienceId: id, profileId } })
    }
    await tx.experience.deleteMany({ where: { id, profileId } })
  })
}

/**
 * Deletes a project and its evidence. An activity of another role that is labelled with it (its role differs
 * from the project's) is not the project's: it keeps its role and loses only the label.
 */
export async function deleteProjectRow(profileId: string, id: string): Promise<void> {
  const project = await prisma.project.findFirst({ where: { id, profileId }, select: { id: true, experienceId: true } })
  if (!project) return
  await prisma.$transaction(async (tx) => {
    await lockRow(tx, 'Project', id, profileId)
    await tx.roleActivity.updateMany({
      where: { projectId: id, AND: [{ experienceId: { not: null } }, ...(project.experienceId ? [{ experienceId: { not: project.experienceId } }] : [])] },
      data: { projectId: null },
    })
    await tx.project.deleteMany({ where: { id, profileId } })
  })
}
