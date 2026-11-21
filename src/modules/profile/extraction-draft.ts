import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { activityFieldsFor, lockRow, nextActivityOrder, withActivityOwnership } from './activity-roles'
import { findAchievementMatch, findSkillMatch, normalizeClaim } from './duplicate-detect'
import { DraftChangeSchema, DraftContentSchema, DraftStampSchema, ExtractionOwnerSchema, type DraftItem, type ExtractionOwner } from './extract-schema'
import { ACTIVITY_ORDER } from './activity-order'
import { noNotesMessage, projectSubject, roleSubject } from './extraction-context'
import { hashExtractionValue, proposeDraft } from './extraction-proposals'
import { DEFAULT_SKILL_CATEGORY, normalizeSkillLevel } from './schema'
import { cleanClaim } from './tag-parser'
import { parseResult } from './result'
import { extractionResultsConflict, mergeExtractionResult } from './extraction-result'

export class ExtractionDraftError extends Error {}

type Tx = Prisma.TransactionClient
const roleFields = { id: true, type: true, role: true, company: true, summary: true, revision: true, startDate: true, endDate: true } as const
const draftFields = { id: true, sourceVersion: true, version: true, content: true } as const

async function readSource(db: Tx, profileId: string, owner: ExtractionOwner) {
  if ('projectId' in owner) {
    const project = await db.project.findFirst({
      where: { id: owner.projectId, profileId, experience: { profileId } },
      select: {
        id: true, experienceId: true, name: true, description: true, notes: true, revision: true, status: true,
        experience: { select: roleFields }, extractionDraft: { select: draftFields },
      },
    })
    if (!project) return null
    return {
      revision: project.revision,
      sourceVersion: hashExtractionValue([project.experienceId, project.revision, project.description, project.notes]),
      experienceId: project.experienceId, projectId: project.id, archived: project.status === 'archived',
      note: project.notes, subject: projectSubject({ ...project, role: project.experience }), draft: project.extractionDraft,
    }
  }
  const role = await db.experience.findFirst({
    where: { id: owner.experienceId, profileId },
    select: { ...roleFields, extractionDraft: { select: draftFields } },
  })
  if (!role) return null
  return {
    revision: role.revision,
    sourceVersion: hashExtractionValue([role.id, role.revision, role.summary]),
    experienceId: role.id, projectId: null, archived: false, note: role.summary,
    subject: roleSubject(role), draft: role.extractionDraft,
  }
}

type Source = NonNullable<Awaited<ReturnType<typeof readSource>>>
const emptyContent = { items: [], resolved: [], notice: null }
const contentOf = (source: Source) => source.draft ? DraftContentSchema.parse(source.draft.content) : emptyContent

async function lockedSource(tx: Tx, profileId: string, owner: ExtractionOwner) {
  if ('projectId' in owner) await lockRow(tx, 'Project', owner.projectId, profileId)
  else await lockRow(tx, 'Experience', owner.experienceId, profileId)
  const source = await readSource(tx, profileId, owner)
  if (!source) throw new ExtractionDraftError('This note could not be found.')
  return source
}

async function readProjects(db: Tx, profileId: string, experienceId: string) {
  return db.project.findMany({
    where: { profileId, experienceId },
    select: { id: true, name: true, status: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  })
}

async function readAchievements(db: Tx, profileId: string, experienceId: string) {
  return db.roleActivity.findMany({
    where: { experienceId, experience: { profileId }, kind: 'achievement' },
    select: {
      id: true, description: true, impact: true, result: true, projectId: true, updatedAt: true,
      project: { select: { name: true, status: true, experienceId: true, profileId: true } },
    },
    orderBy: [...ACTIVITY_ORDER, { id: 'asc' }],
  })
}

async function readSkills(db: Tx, profileId: string) {
  return db.skill.findMany({
    where: { profileId },
    select: { id: true, name: true, kind: true, updatedAt: true },
    orderBy: { id: 'asc' },
  })
}

function achievementMatch(item: Extract<DraftItem, { kind: 'achievement' }>, achievements: Awaited<ReturnType<typeof readAchievements>>) {
  const original = cleanClaim(item.original?.split('\n', 1)[0].replace(/^\s*(?:[-*+] |\d+\. )/, '') ?? '')
  return achievements.find((row) => [item.description, original].some((text) => normalizeClaim(text) === normalizeClaim(row.description)))
    ?? findAchievementMatch(item.description, achievements) ?? (original ? findAchievementMatch(original, achievements) : undefined)
}

function exactAchievementMatch(item: Extract<DraftItem, { kind: 'achievement' }>, match: { description: string }) {
  const original = cleanClaim(item.original.split('\n', 1)[0].replace(/^\s*(?:[-*+] |\d+\. )/, ''))
  return [item.description, original].some((text) => normalizeClaim(text) === normalizeClaim(match.description))
}

function replaceable(match: Awaited<ReturnType<typeof readAchievements>>[number], source: Source, profileId: string) {
  return !match.project || (match.project.profileId === profileId && match.project.experienceId === source.experienceId && match.project.status !== 'archived')
}

export async function loadExtractionReview(profileId: string, owner: ExtractionOwner) {
  const source = await readSource(prisma, profileId, owner)
  if (!source) return null
  const content = contentOf(source)
  const [projects, achievements, skills] = await Promise.all([
    readProjects(prisma, profileId, source.experienceId),
    content.items.some((item) => item.kind === 'achievement') ? readAchievements(prisma, profileId, source.experienceId) : [],
    content.items.some((item) => item.kind === 'skill') ? readSkills(prisma, profileId) : [],
  ])
  return {
    version: source.draft?.version ?? 0,
    sourceVersion: source.sourceVersion,
    stale: Boolean(source.draft && source.draft.sourceVersion !== source.sourceVersion),
    archived: source.archived,
    notice: content.notice,
    evidence: achievements.map((match) => ({
      id: match.id, text: match.description, version: match.updatedAt.toISOString(),
      project: match.project?.profileId === profileId ? match.project.name : null,
      replaceable: replaceable(match, source, profileId), impact: match.impact, result: parseResult(match.result),
    })),
    projects: projects.filter((project) => project.status !== 'archived').map(({ id, name }) => ({ id, name })),
    items: content.items.map((item) => {
      if (item.kind === 'achievement') {
        const match = achievementMatch(item, achievements)
        return { item, match: match ? {
          id: match.id, text: match.description, version: match.updatedAt.toISOString(),
          project: match.project?.profileId === profileId ? match.project.name : null,
          replaceable: replaceable(match, source, profileId), exact: exactAchievementMatch(item, match),
          impact: match.impact, result: parseResult(match.result),
          resultConflict: extractionResultsConflict(parseResult(match.result), item.result),
        } : null }
      }
      const match = item.kind === 'skill' ? findSkillMatch(item.name, skills) : undefined
      return { item, match: match ? {
        id: match.id, text: match.name, version: match.updatedAt.toISOString(), project: null, replaceable: match.kind === 'skill', exact: true, impact: null, result: null, resultConflict: false,
      } : null }
    }),
  }
}
export type ExtractionReview = NonNullable<Awaited<ReturnType<typeof loadExtractionReview>>>

function checkStamp(source: Source, expected: { version: number; sourceVersion: string }) {
  if (source.sourceVersion !== expected.sourceVersion) throw new ExtractionDraftError('The saved note changed. Reload the draft to continue.')
  if ((source.draft?.version ?? 0) !== expected.version) throw new ExtractionDraftError('This draft changed elsewhere. Reload it to continue.')
}

export async function regenerateExtractionDraft(profileId: string, input: ExtractionOwner, stamp: unknown, replacePending: boolean) {
  const owner = ExtractionOwnerSchema.parse(input)
  const expected = DraftStampSchema.parse(stamp)
  const source = await readSource(prisma, profileId, owner)
  if (!source) throw new ExtractionDraftError('This note could not be found.')
  checkStamp(source, expected)
  if (source.archived) throw new ExtractionDraftError('This project is archived.')
  if (!source.subject.body.trim()) throw new ExtractionDraftError(noNotesMessage(source.subject.noun))
  const current = contentOf(source)
  if (current.items.length && replacePending !== true) throw new ExtractionDraftError('Confirm that you want to replace the pending suggestions.')
  const projects = (await readProjects(prisma, profileId, source.experienceId)).filter((project) => project.status !== 'archived')
  const proposed = await proposeDraft(profileId, source.subject, projects, source.projectId)
  if (proposed.failed && current.items.length) {
    throw new ExtractionDraftError(`${proposed.notice} Your saved suggestions are still available.`)
  }
  const resolved = new Set(current.resolved)
  const currentIds = new Map(current.items.map((item) => [item.key, item.id]))
  const items = proposed.items.filter((item) => !resolved.has(item.key))
    .map((item) => ({ ...item, id: currentIds.get(item.key) ?? item.id }))
  if (proposed.failed && !items.length) throw new ExtractionDraftError(`${proposed.notice} No new suggestions are available to review.`)
  if (!items.length && current.items.length) throw new ExtractionDraftError('No new suggestions were found. Your saved draft is still available.')

  await withActivityOwnership(profileId, async (tx) => {
    const live = await lockedSource(tx, profileId, owner)
    checkStamp(live, expected)
    if (live.archived) throw new ExtractionDraftError('This project is archived.')
    const content = { items, resolved: current.resolved, notice: proposed.notice }
    if (live.draft) {
      await tx.profileExtractionDraft.update({
        where: { id: live.draft.id },
        data: { sourceVersion: live.sourceVersion, version: { increment: 1 }, content },
      })
    } else {
      await tx.profileExtractionDraft.create({ data: { ...owner, sourceVersion: live.sourceVersion, content } })
    }
  })
}

/** Inserts a bullet without removing or rewriting any of the existing note. */
export function addScope(note: string, description: string) {
  const newline = note.includes('\r\n') ? '\r\n' : '\n'
  const headings = [...note.matchAll(/^#{1,2}[ \t]+([^\r\n]+)$/gm)]
  const overview = headings.findIndex((heading) => heading[1].trim().toLowerCase() === 'overview')
  const bullet = `- ${description.replace(/\s+/g, ' ')}`
  if (overview === -1) return `${note}${note ? newline.repeat(2) : ''}## Overview${newline.repeat(2)}${bullet}${newline}`
  const next = headings[overview + 1]?.index ?? note.length
  const body = note.slice(headings[overview].index + headings[overview][0].length, next)
  if (body.split(/\r?\n/).some((line) => line.trim() === bullet)) return note
  const before = note.slice(0, next)
  const gap = before.endsWith(newline.repeat(2)) ? '' : before.endsWith(newline) ? newline : newline.repeat(2)
  return `${before}${gap}${bullet}${newline}${next < note.length ? newline : ''}${note.slice(next)}`
}

async function acceptAchievement(tx: Tx, profileId: string, source: Source, item: Extract<DraftItem, { kind: 'achievement' }>, target?: { id: string; version: string; resultChoice?: 'existing' | 'suggestion' }, distinct = false) {
  const achievements = await readAchievements(tx, profileId, source.experienceId)
  const found = achievementMatch(item, achievements)
  if (found && !target && (!distinct || exactAchievementMatch(item, found))) throw new ExtractionDraftError('Similar evidence already exists in this role. Reload the draft to review the match.')
  const match = target ? achievements.find((row) => row.id === target.id) : undefined
  if (target && (!match || match.id !== target.id || match.updatedAt.toISOString() !== target.version || !replaceable(match, source, profileId))) {
    throw new ExtractionDraftError('This match can no longer be replaced. Reload the draft to see current evidence.')
  }
  if (target && achievements.some((row) => row.id !== target.id && exactAchievementMatch(item, row))) {
    throw new ExtractionDraftError('Exact evidence already exists in this role. Reload the draft to review it.')
  }
  const existingResult = match ? parseResult(match.result) : null
  if (match && extractionResultsConflict(existingResult, item.result) && !target?.resultChoice) {
    throw new ExtractionDraftError('Choose which result to keep when replacing this evidence.')
  }
  const result = target?.resultChoice === 'existing' ? existingResult : mergeExtractionResult(existingResult, item.result)
  let projectId = item.project?.kind === 'existing' ? item.project.id : null
  if (match && !item.projectEdited) {
    projectId = match.projectId
  } else if (item.project?.kind === 'new') {
    const name = item.project.name
    const project = (await readProjects(tx, profileId, source.experienceId)).find((p) => p.name.trim().toLowerCase() === name.toLowerCase())
    if (project?.status === 'archived') throw new ExtractionDraftError('A project with that name is archived. Choose a different label.')
    projectId = project?.id ?? (await tx.project.create({
      data: { profileId, experienceId: source.experienceId, name, description: '' },
    })).id
  }
  if (projectId) {
    const project = await tx.project.findFirst({ where: { id: projectId, profileId, experienceId: source.experienceId }, select: { status: true } })
    if (!project || project.status === 'archived') throw new ExtractionDraftError('Choose an active project from this role.')
  }
  const fields = await activityFieldsFor(tx, profileId, { experienceId: source.experienceId, projectId })
  const data = {
    description: item.description,
    ...(item.impact?.trim() ? { impact: item.impact } : {}),
    ...(item.result && target?.resultChoice !== 'existing' && result ? { result } : {}),
  }
  if (match) {
    await tx.roleActivity.update({
      where: { id: match.id, experienceId: source.experienceId, kind: 'achievement', updatedAt: match.updatedAt },
      data: { ...data, ...(projectId !== match.projectId ? { projectId, order: await nextActivityOrder(tx, fields) } : {}) },
    })
  } else {
    await tx.roleActivity.create({ data: { ...data, ...fields, kind: 'achievement', order: await nextActivityOrder(tx, fields) } })
  }
}

export async function changeExtractionDraft(profileId: string, input: ExtractionOwner, change: unknown) {
  const owner = ExtractionOwnerSchema.parse(input)
  const { itemId, edit, decision, target, ...expected } = DraftChangeSchema.parse(change)
  await withActivityOwnership(profileId, async (tx) => {
    const source = await lockedSource(tx, profileId, owner)
    checkStamp(source, expected)
    const { draft } = source
    if (!draft || draft.version !== expected.version) throw new ExtractionDraftError('Reload the draft to continue.')
    if (decision !== 'save' && decision !== 'skip') {
      if (draft.sourceVersion !== source.sourceVersion) throw new ExtractionDraftError('Extract again from the current note before accepting.')
      if (source.archived) throw new ExtractionDraftError('This project is archived.')
    }
    const content = contentOf(source)
    const saved = content.items.find((item) => item.id === itemId)
    if (!saved || (edit && edit.kind !== saved.kind)) throw new ExtractionDraftError('This suggestion is no longer available.')
    // Keep provenance and identity server-owned. Only the item’s editable fields can change.
    const item = { ...saved, ...edit } as DraftItem
    let sourceVersion = draft.sourceVersion
    if (decision === 'replace' || decision === 'accept' || decision === 'add-distinct') {
      const replacement = decision === 'replace' ? target : undefined
      if (item.kind === 'achievement') {
        await acceptAchievement(tx, profileId, source, item, replacement, decision === 'add-distinct')
      } else if (item.kind === 'skill') {
        if (decision === 'add-distinct') throw new ExtractionDraftError('Only distinct achievements can be added alongside a match.')
        const match = findSkillMatch(item.name, await readSkills(tx, profileId))
        if (replacement && (!match || match.kind !== 'skill' || match.id !== replacement.id || match.updatedAt.toISOString() !== replacement.version)) {
          throw new ExtractionDraftError('This skill match changed. Reload the draft to continue.')
        }
        if (match && !replacement) throw new ExtractionDraftError('This capability is already in your profile.')
        if (match) {
          await tx.skill.update({ where: { id: match.id, profileId, updatedAt: match.updatedAt }, data: {
            name: item.name,
            ...(item.category ? { category: item.category } : {}),
            ...(item.level ? { level: normalizeSkillLevel(item.level) } : {}),
          } })
        } else {
          await tx.skill.create({ data: { profileId, name: item.name, category: item.category || DEFAULT_SKILL_CATEGORY, level: normalizeSkillLevel(item.level) } })
        }
      } else {
        if (replacement || decision === 'add-distinct') throw new ExtractionDraftError('Scope can only be added or skipped.')
        const note = addScope(source.note, item.description)
        if (note !== source.note) {
          const revision = { increment: 1 }
          if ('projectId' in owner) {
            await tx.project.update({ where: { id: owner.projectId, profileId, revision: source.revision }, data: { notes: note, revision } })
          } else {
            await tx.experience.update({ where: { id: owner.experienceId, profileId, revision: source.revision }, data: { summary: note, revision, notesUpdatedAt: new Date() } })
          }
          sourceVersion = (await readSource(tx, profileId, owner))!.sourceVersion
        }
      }
    }

    const items = decision === 'save'
      ? content.items.map((candidate) => candidate.id === itemId ? item : candidate)
      : content.items.filter((candidate) => candidate.id !== itemId)
    await tx.profileExtractionDraft.update({ where: { id: draft.id }, data: {
      version: { increment: 1 },
      sourceVersion,
      content: { ...content, items, resolved: decision === 'save' ? content.resolved : [...content.resolved, item.key] },
    } })
  })
}
