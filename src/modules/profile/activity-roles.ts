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

/** A null role selection creates or reuses Independent projects on demand. */
export type ActivityOwner = { experienceId: string | null; projectId?: string | null }
type ActivityFields = { experienceId: string; projectId: string | null }
type ActivityTx = Pick<Prisma.TransactionClient, '$executeRaw' | 'experience' | 'project' | 'roleActivity'>

/** Serialize ownership changes so a project or its role cannot move between validation and write. */
export async function withActivityOwnership<T>(profileId: string, write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`profile-ownership:${profileId}`}))`
    return write(tx)
  })
}

export async function nextActivityOrder(tx: ActivityTx, fields: ActivityFields): Promise<number> {
  const last = await tx.roleActivity.findFirst({ where: fields, orderBy: { order: 'desc' }, select: { order: true } })
  return (last?.order ?? -1) + 1
}

/** Resolve a project note's current role inside the ownership transaction. */
export async function projectActivityLabel(tx: ActivityTx, profileId: string, projectId: string) {
  if (typeof projectId !== 'string' || !projectId) throw new Error('Project not found')
  const project = await tx.project.findFirst({ where: { id: projectId, profileId, experience: { profileId } }, select: { id: true, experienceId: true, status: true } })
  if (!project) throw new Error('Project not found')
  return project
}

export async function activityFieldsFor(tx: ActivityTx, profileId: string, owner: ActivityOwner, allowArchived = false): Promise<ActivityFields> {
  const { projectId = null } = owner
  if (owner.experienceId === null && projectId === null) {
    return { experienceId: await ensureIndependentExperience(tx, profileId), projectId: null }
  }
  const { experienceId } = owner
  if (typeof experienceId !== 'string' || !experienceId) throw new Error('Experience not found')
  const experience = await tx.experience.findFirst({ where: { id: experienceId, profileId }, select: { id: true } })
  if (!experience) throw new Error('Experience not found')
  if (projectId !== null) {
    const project = await projectActivityLabel(tx, profileId, projectId)
    if (project.experienceId !== experienceId) throw new Error('That project belongs to another role')
    if (!allowArchived && project.status === 'archived') throw new Error('That project is archived')
  }
  return { experienceId, projectId }
}

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
        OR: [{ projectId: null }, { project: { is: { experienceId: { not: id } } } }],
      },
    }),
    prisma.project.count({ where: { experienceId: id, profileId } }),
    prisma.roleActivity.count({ where: { project: { experienceId: id, profileId }, experienceId: id } }),
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
  await withActivityOwnership(profileId, async (tx) => {
    await lockRow(tx, 'Experience', id, profileId)
    if (projects === 'keep') {
      // Lock projects before touching their evidence: a concurrent Properties move must finish first.
      const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "Project" WHERE "experienceId" = ${id} AND "profileId" = ${profileId}
        ORDER BY "id" FOR UPDATE
      `)
      const projectIds = locked.map((p) => p.id)
      if (projectIds.length > 0) {
        const home = await ensureIndependentExperience(tx, profileId)
        // Move the projects' own evidence (only evidence that carries this role); other roles' evidence stays.
        await tx.roleActivity.updateMany({
          where: { projectId: { in: projectIds }, experienceId: id },
          data: { experienceId: home },
        })
        await tx.project.updateMany({ where: { id: { in: projectIds }, profileId }, data: { experienceId: home } })
      }
    } else {
      // The projects are going: another role's evidence under them must not go with them. It keeps its role and
      // loses only the label. (When the projects are kept it keeps the label too; readers trust its own role.)
      await tx.roleActivity.updateMany({
        where: { project: { experienceId: id, profileId }, experienceId: { not: id } },
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
  await withActivityOwnership(profileId, async (tx) => {
    await lockRow(tx, 'Project', id, profileId)
    const project = await tx.project.findFirst({ where: { id, profileId }, select: { experienceId: true } })
    if (!project) return
    await tx.roleActivity.updateMany({
      where: { projectId: id, experienceId: { not: project.experienceId } },
      data: { projectId: null },
    })
    await tx.project.deleteMany({ where: { id, profileId } })
  })
}
