// Guided merge of a standalone project into the role project it is an earlier
// copy of. Session-free: every function takes the caller's profileId first and
// only touches projects that belong to it. Nothing here runs without a call
// from the UI; finding pairs never writes.

import { prisma } from '@/lib/db'
import { lockRow } from './activity-roles'
import { belongsToProject } from './ownership'
import { normalizeName } from '@/modules/profile-map/format'

/** Bodies match when their first this-many normalised characters do. */
const BODY_PREFIX_CHARS = 300

export type ProjectBody = { name: string; description: string; notes: string }

/** Description and notes as one text, the same collapse the profile vault uses. */
export function projectBody(p: Pick<ProjectBody, 'description' | 'notes'>): string {
  return [p.description.trim(), p.notes.trim()].filter(Boolean).join('\n\n')
}

const bodyKey = (p: ProjectBody) => normalizeName(projectBody(p))

type Pairable = ProjectBody & { id: string; experienceId: string | null }

/**
 * Pairs each standalone project with at most one role project of the same
 * profile: same name once normalised, or the same first 300 characters of body.
 * Strongest matches are assigned first (a name match outranks a body match), so
 * a weak match cannot take a project a stronger one needs; each role project
 * is used once. Input order breaks ties, so callers sort by creation time.
 */
export function pairDuplicateProjects<T extends Pairable>(projects: T[]): { standalone: T; roleProject: T }[] {
  const roleProjects = projects.filter((p) => p.experienceId)
  const candidates: { standalone: T; roleProject: T; score: number }[] = []
  for (const standalone of projects.filter((p) => !p.experienceId)) {
    const name = normalizeName(standalone.name)
    const body = bodyKey(standalone).slice(0, BODY_PREFIX_CHARS)
    for (const roleProject of roleProjects) {
      const sameName = normalizeName(roleProject.name) === name
      const sameBody = body !== '' && bodyKey(roleProject).slice(0, BODY_PREFIX_CHARS) === body
      const score = (sameName ? 2 : 0) + (sameBody ? 1 : 0)
      if (score > 0) candidates.push({ standalone, roleProject, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score) // stable: ties keep input order
  const usedStandalone = new Set<string>()
  const usedRole = new Set<string>()
  const pairs: { standalone: T; roleProject: T }[] = []
  for (const { standalone, roleProject } of candidates) {
    if (usedStandalone.has(standalone.id) || usedRole.has(roleProject.id)) continue
    usedStandalone.add(standalone.id)
    usedRole.add(roleProject.id)
    pairs.push({ standalone, roleProject })
  }
  return pairs
}

export type DuplicateProject = {
  id: string
  name: string
  body: string
  evidenceCount: number
}

export type DuplicateProjectPair = {
  standalone: DuplicateProject
  /** The project that survives a merge. */
  roleProject: DuplicateProject & { role: string }
  /** Both bodies are the same text, so a merge needs no body choice. */
  sameBody: boolean
}

/** Standalone projects that look like earlier copies of a role project. Read-only. */
export async function findDuplicateProjects(profileId: string): Promise<DuplicateProjectPair[]> {
  const rows = await prisma.project.findMany({
    where: { profileId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, name: true, description: true, notes: true, experienceId: true,
      experience: { select: { role: true, company: true } },
      _count: { select: { activities: true } },
    },
  })
  const summary = (p: (typeof rows)[number]): DuplicateProject => ({
    id: p.id, name: p.name, body: projectBody(p), evidenceCount: p._count.activities,
  })
  return pairDuplicateProjects(rows).map(({ standalone, roleProject }) => ({
    standalone: summary(standalone),
    roleProject: {
      ...summary(roleProject),
      role: roleProject.experience ? `${roleProject.experience.role} at ${roleProject.experience.company}` : '',
    },
    sameBody: bodyKey(standalone) === bodyKey(roleProject),
  }))
}

export type MergeProjectsInput = {
  /** The project that survives. */
  keepId: string
  /** The project that is merged in and deleted. */
  removeId: string
  /** Whose description and notes the survivor ends up with. */
  body: 'keep' | 'remove'
}

const isEmpty = (v: string | Date | null | undefined) => v == null || v === ''

/**
 * Moves the removed project's evidence and capability links onto the kept one,
 * fills the kept project's empty dates and URLs from it, applies the chosen
 * body, and deletes it, in one transaction. Evidence whose text the kept
 * project already has is not moved twice: its confirmed links go to the
 * existing item and the duplicate is deleted with the project.
 */
export async function mergeProjects(profileId: string, { keepId, removeId, body }: MergeProjectsInput): Promise<void> {
  if (keepId === removeId) throw new Error('Choose two different projects')
  await prisma.$transaction(async (tx) => {
    // Locked in a fixed order, so two merges of the same pair cannot deadlock.
    for (const id of [keepId, removeId].sort()) await lockRow(tx, 'Project', id, profileId)
    const projects = await tx.project.findMany({
      where: { id: { in: [keepId, removeId] }, profileId },
      include: { activities: { orderBy: { order: 'asc' }, select: { id: true, description: true, order: true, result: true, experienceId: true } } },
    })
    const keep = projects.find((p) => p.id === keepId)
    const remove = projects.find((p) => p.id === removeId)
    if (!keep || !remove) throw new Error('Project not found')

    // An item is a duplicate only when the same role holds both: both read as their project's evidence, or both
    // carry the same other role. Otherwise it is a different role's evidence and is moved, never merged away.
    const holder = (a: { experienceId: string | null }, role: string | null) => (belongsToProject(a, role) ? 'project' : a.experienceId)
    const existing = new Map(keep.activities.map((a) => [`${holder(a, keep.experienceId)}|${normalizeName(a.description)}`, a]))
    let nextOrder = keep.activities.reduce((max, a) => Math.max(max, a.order), -1) + 1
    for (const activity of remove.activities) {
      const twin = existing.get(`${holder(activity, remove.experienceId)}|${normalizeName(activity.description)}`)
      if (twin) {
        // A result on the duplicate is not lost when the kept item has none.
        if (activity.result != null && twin.result == null) {
          await tx.roleActivity.update({ where: { id: twin.id }, data: { result: activity.result } })
        }
        const links = await tx.roleActivitySkill.findMany({ where: { roleActivityId: activity.id, status: 'confirmed' } })
        if (links.length) {
          await tx.roleActivitySkill.createMany({
            data: links.map((l) => ({ roleActivityId: twin.id, skillId: l.skillId, status: 'confirmed', source: l.source, reason: l.reason })),
            skipDuplicates: true,
          })
        }
        continue
      }
      if (belongsToProject(activity, remove.experienceId)) {
        // The project's own evidence takes the kept project's role.
        await tx.roleActivity.update({ where: { id: activity.id }, data: { projectId: keepId, experienceId: keep.experienceId, order: nextOrder++ } })
      } else if (activity.experienceId === keep.experienceId) {
        // Another role's evidence whose role is the kept project's: the label is consistent there.
        await tx.roleActivity.update({ where: { id: activity.id }, data: { projectId: keepId, order: nextOrder++ } })
      } else {
        // Another role's own evidence: it keeps its role and loses the label, so it never disagrees with the project it sits in.
        await tx.roleActivity.update({ where: { id: activity.id }, data: { projectId: null } })
      }
    }

    const skills = await tx.projectSkill.findMany({ where: { projectId: removeId }, select: { skillId: true } })
    if (skills.length) {
      await tx.projectSkill.createMany({ data: skills.map((s) => ({ projectId: keepId, skillId: s.skillId })), skipDuplicates: true })
    }

    await tx.project.update({
      where: { id: keepId },
      data: {
        // A changed note bumps its revision, so an editor open on the kept project sees the conflict.
        ...(body === 'remove' ? { description: remove.description, notes: remove.notes, revision: { increment: 1 } } : {}),
        ...(isEmpty(keep.startDate) && remove.startDate ? { startDate: remove.startDate } : {}),
        ...(isEmpty(keep.endDate) && remove.endDate ? { endDate: remove.endDate } : {}),
        ...(isEmpty(keep.url) && remove.url ? { url: remove.url } : {}),
        ...(isEmpty(keep.repoUrl) && remove.repoUrl ? { repoUrl: remove.repoUrl } : {}),
      },
    })
    await tx.project.delete({ where: { id: removeId } })
  })
}
