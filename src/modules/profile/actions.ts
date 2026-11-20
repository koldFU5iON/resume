'use server'

import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { revalidatePath } from 'next/cache'
import * as z from 'zod'
import { Prisma } from '@prisma/client'
import { activityFieldsFor, deleteExperienceRow, deleteProjectRow, experienceDeleteImpact, nextActivityOrder, projectActivityLabel, withActivityOwnership, type ActivityOwner } from './activity-roles'
import type { ExtractionOwner } from './extract'
import { activityOwnedBy } from './ownership'
import { saveExperienceProperties, saveProjectProperties, type ExperienceProperties, type ProjectProperties } from './properties'
import { readNote, saveExperienceNote, saveProjectNote, type NoteSaveResult } from './note-revision'
import { mergeProjects } from './project-merge'
import type { ResultInput } from './result'
import { ActivityInputSchema, ACTIVITY_KINDS, DEFAULT_SKILL_CATEGORY, MAX_SUMMARY_LENGTH, SkillInputSchema, normalizeSkillLevel } from './schema'

export type ContactField = 'name' | 'email' | 'phone' | 'location' | 'website' | 'linkedIn' | 'github' | 'headline'

export async function updateContactField(field: ContactField, value: string) {
  const { profile } = await requireProfile()
  const trimmed = value.trim()
  // `name` is a required column: refuse to blank it rather than write null.
  if (field === 'name' && !trimmed) throw new Error('Name is required')
  await prisma.profile.update({
    where: { id: profile.id },
    data: { [field]: trimmed || null },
  })
  revalidatePath('/dashboard/profile', 'layout')
}

export async function updateProfileSummary(summary: string) {
  const { profile } = await requireProfile()
  if (summary.trim().length > MAX_SUMMARY_LENGTH) {
    throw new Error(`Summary must be ${MAX_SUMMARY_LENGTH} characters or fewer`)
  }
  await prisma.profile.update({
    where: { id: profile.id },
    data: { summary: summary.trim() || null },
  })
  revalidatePath('/dashboard/profile', 'layout')
}

const CONTACT_FIELDS: ContactField[] = ['name', 'email', 'phone', 'location', 'website', 'linkedIn', 'github', 'headline']

// Used by the AI chat assistant when applying a proposed profile field update.
export async function patchProfileField(field: string, value: string): Promise<void> {
  if (field === 'summary') return updateProfileSummary(value)
  if ((CONTACT_FIELDS as string[]).includes(field)) {
    return updateContactField(field as ContactField, value)
  }
  throw new Error(`"${field}" is not an editable profile field. Supported fields: ${CONTACT_FIELDS.join(', ')}, summary.`)
}

// ── Activities ────────────────────────────────────────────────────────────────

type ActivityData = { kind: string; description: string; impact?: string | null; result?: ResultInput | null }

/** The row fields of an activity: `result: null` clears the Json column, undefined leaves it. */
function activityRow(data: ActivityData) {
  const { result, ...rest } = ActivityInputSchema.parse(data)
  return { ...rest, ...(result === undefined ? {} : { result: result === null ? Prisma.JsonNull : result }) }
}

export type { ActivityOwner }

export async function createActivity(owner: ActivityOwner, data: ActivityData) {
  const { profile } = await requireProfile()
  const activity = await withActivityOwnership(profile.id, async (tx) => {
    const fields = await activityFieldsFor(tx, profile.id, owner, true)
    return tx.roleActivity.create({
      data: { ...activityRow(data), ...fields, tags: '[]', order: await nextActivityOrder(tx, fields) },
    })
  })
  revalidatePath('/dashboard/profile', 'layout')
  return activity
}

/** Text edits keep their order. Changing the role or label puts the evidence at the end of its new group. */
async function saveActivity(id: string, target: ActivityOwner | null, data?: ActivityData) {
  const { profile } = await requireProfile()
  if (typeof id !== 'string' || !id) throw new Error('Activity not found')
  const where = { id, ...activityOwnedBy(profile.id) }
  const activity = await withActivityOwnership(profile.id, async (tx) => {
    const existing = await tx.roleActivity.findFirst({ where, select: { experienceId: true, projectId: true } })
    if (!existing) throw new Error('Activity not found')
    const fields = target ? await activityFieldsFor(tx, profile.id, target) : existing
    const changedGroup = existing.experienceId !== fields.experienceId || existing.projectId !== fields.projectId
    return tx.roleActivity.update({
      where,
      data: { ...(data ? activityRow(data) : {}), ...(changedGroup ? { ...fields, order: await nextActivityOrder(tx, fields) } : {}) },
    })
  })
  revalidatePath('/dashboard/profile', 'layout')
  return activity
}

export async function moveActivity(id: string, target: ActivityOwner) {
  await saveActivity(id, target)
}

export async function updateActivity(id: string, owner: ActivityOwner | null, data: ActivityData) {
  return saveActivity(id, owner, data)
}

export async function deleteActivity(id: string) {
  const { profile } = await requireProfile()
  if (typeof id !== 'string' || !id) throw new Error('Activity not found')
  await prisma.roleActivity.deleteMany({
    where: { id, ...activityOwnedBy(profile.id) },
  })
  revalidatePath('/dashboard/profile', 'layout')
}

// ── Experience ────────────────────────────────────────────────────────────────

type ExperienceData = {
  company: string
  role: string
  location?: string
  remote: boolean
  startDate: Date
  endDate?: Date
  summary: string
}

export async function createExperience(data: ExperienceData) {
  const { profile } = await requireProfile()
  const { company, role, location, remote, startDate, endDate, summary } = data
  const experience = await prisma.experience.create({
    data: { company, role, location, remote, startDate, endDate, summary, profileId: profile.id },
  })
  revalidatePath('/dashboard/profile', 'layout')
  return experience
}

const DeleteExperienceOptionsSchema = z.object({ projects: z.enum(['keep', 'delete']) })

/** What deleting a role takes with it, counted from the database rather than client state. */
export async function getExperienceDeleteImpact(id: string) {
  const { profile } = await requireProfile()
  return experienceDeleteImpact(profile.id, id)
}

/**
 * `projects: 'keep'` moves the role's projects and their evidence to Independent projects; `'delete'` removes them, and
 * their evidence, too. No default: the caller must choose. Idempotent: a role that is already gone (a double
 * click, another tab) is a no-op, not an error.
 */
export async function deleteExperience(id: string, options: { projects: 'keep' | 'delete' }) {
  const { projects } = DeleteExperienceOptionsSchema.parse(options)
  const { profile } = await requireProfile()
  await deleteExperienceRow(profile.id, id, projects)
  revalidatePath('/dashboard/profile', 'layout')
}

/** Saves a role's facts from the Properties tab. Refused input throws with a message the form shows. */
export async function updateExperienceProperties(id: string, input: ExperienceProperties) {
  const { profile } = await requireProfile()
  await saveExperienceProperties(profile.id, id, input)
  revalidatePath('/dashboard/profile', 'layout')
}

/** Saves a role's note. Refused (not overwritten) when the note moved on since `expectedRevision`. */
export async function updateExperienceNotes(id: string, summary: string, expectedRevision: number): Promise<NoteSaveResult> {
  const { profile } = await requireProfile()
  const result = await saveExperienceNote(profile.id, id, summary, expectedRevision)
  if (result.ok) {
    revalidatePath('/dashboard/profile', 'layout')
  }
  return result
}

// ── Accept suggestions (bulk transactional) ───────────────────────────────────

type AcceptedActivity = {
  kind: string
  description: string
  impact: string | null
  replaceId?: string // if set, update existing row instead of creating
}

type AcceptedSkill = {
  name: string
  category: string | null
  level: string | null
  replaceId?: string // if set, update existing row instead of creating
}

export type AcceptSuggestionsPayload = ExtractionOwner & {
  activities: AcceptedActivity[]
  skills: AcceptedSkill[]
}

export async function acceptSuggestions(payload: AcceptSuggestionsPayload) {
  const { profile } = await requireProfile()

  if (payload.activities.some((a) => !(ACTIVITY_KINDS as readonly string[]).includes(a.kind))) {
    throw new Error('Invalid activity kind')
  }

  await withActivityOwnership(profile.id, async (tx) => {
    let fields
    if ('projectId' in payload) {
      const project = await projectActivityLabel(tx, profile.id, payload.projectId)
      fields = { experienceId: project.experienceId, projectId: project.id }
    } else {
      if (typeof payload.experienceId !== 'string') throw new Error('Experience not found')
      fields = await activityFieldsFor(tx, profile.id, { experienceId: payload.experienceId })
    }
    let order = await nextActivityOrder(tx, fields)
    for (const a of payload.activities) {
      const data = { kind: a.kind, description: a.description, impact: a.impact ?? undefined }
      if (a.replaceId) {
        await tx.roleActivity.update({ where: { id: a.replaceId, ...fields }, data })
      } else {
        await tx.roleActivity.create({ data: { ...data, ...fields, tags: '[]', order: order++ } })
      }
    }
    for (const s of payload.skills) {
      if (s.replaceId) {
        await tx.skill.update({
          where: { id: s.replaceId, profileId: profile.id },
          data: {
            name: s.name,
            ...(s.category ? { category: s.category } : {}),
            ...(s.level ? { level: normalizeSkillLevel(s.level) } : {}),
          },
        })
      } else {
        await tx.skill.create({
          data: {
            profileId: profile.id,
            name: s.name,
            category: s.category ?? DEFAULT_SKILL_CATEGORY,
            level: normalizeSkillLevel(s.level),
            tags: '[]',
          },
        })
      }
    }
  })

  revalidatePath('/dashboard/profile', 'layout')
}

// ── Skills ────────────────────────────────────────────────────────────────────

type SkillData = { name: string; category: string; level: string; yearsOfExperience?: number }

export async function createSkill(data: SkillData) {
  const { profile } = await requireProfile()
  const skill = await prisma.skill.create({
    data: { ...SkillInputSchema.parse(data), profileId: profile.id, tags: '[]' },
  })
  revalidatePath('/dashboard/profile', 'layout')
  return skill
}

export async function updateSkill(id: string, data: SkillData) {
  const { profile } = await requireProfile()
  const skill = await prisma.skill.update({ where: { id, profileId: profile.id }, data: SkillInputSchema.parse(data) })
  revalidatePath('/dashboard/profile', 'layout')
  return skill
}

export async function deleteSkill(id: string) {
  const { profile } = await requireProfile()
  await prisma.skill.deleteMany({ where: { id, profileId: profile.id } })
  revalidatePath('/dashboard/profile', 'layout')
}

// ── Languages ─────────────────────────────────────────────────────────────────

type LanguageData = { name: string; proficiency?: string }

export async function createLanguage(data: LanguageData) {
  const { profile } = await requireProfile()
  const language = await prisma.language.create({
    data: { ...data, proficiency: data.proficiency?.trim() || null, profileId: profile.id },
  })
  revalidatePath('/dashboard/profile', 'layout')
  return language
}

export async function updateLanguage(id: string, data: LanguageData) {
  const { profile } = await requireProfile()
  const language = await prisma.language.update({
    where: { id, profileId: profile.id },
    data: { ...data, proficiency: data.proficiency?.trim() || null },
  })
  revalidatePath('/dashboard/profile', 'layout')
  return language
}

export async function deleteLanguage(id: string) {
  const { profile } = await requireProfile()
  await prisma.language.deleteMany({ where: { id, profileId: profile.id } })
  revalidatePath('/dashboard/profile', 'layout')
}

// ── Tools and competencies ───────────────────────────────────────────────────
// Stored in Skill with a kind, so evidence can link to them like any skill.
// Returned in the legacy Tool / Competency shapes the profile UI uses.

type ToolData = { name: string; category?: string }
type CompetencyData = { name: string }

type CapabilityRow = { id: string; profileId: string; name: string; category: string | null; order: number; origin: string | null; createdAt: Date; updatedAt: Date }

function asTool(row: CapabilityRow) {
  const { id, profileId, name, category, order, createdAt, updatedAt } = row
  return { id, profileId, name, category, order, createdAt, updatedAt }
}

function asCompetency(row: CapabilityRow) {
  const { id, profileId, name, order, origin, createdAt, updatedAt } = row
  return { id, profileId, name, order, origin: origin ?? 'manual', createdAt, updatedAt }
}

async function nextOrder(profileId: string, kind: 'tool' | 'competency'): Promise<number> {
  const last = await prisma.skill.findFirst({ where: { profileId, kind }, orderBy: { order: 'desc' }, select: { order: true } })
  return (last?.order ?? -1) + 1
}

export async function createTool(data: ToolData) {
  const { profile } = await requireProfile()
  const tool = await prisma.skill.create({
    data: { profileId: profile.id, kind: 'tool', name: data.name, category: data.category ?? null, order: await nextOrder(profile.id, 'tool') },
  })
  revalidatePath('/dashboard/profile', 'layout')
  return asTool(tool)
}

export async function updateTool(id: string, data: ToolData) {
  const { profile } = await requireProfile()
  const tool = await prisma.skill.update({
    where: { id, profileId: profile.id, kind: 'tool' },
    data: { name: data.name, category: data.category ?? null },
  })
  revalidatePath('/dashboard/profile', 'layout')
  return asTool(tool)
}

export async function deleteTool(id: string) {
  const { profile } = await requireProfile()
  await prisma.skill.deleteMany({ where: { id, profileId: profile.id, kind: 'tool' } })
  revalidatePath('/dashboard/profile', 'layout')
}

export async function createCompetency(data: CompetencyData) {
  const { profile } = await requireProfile()
  const competency = await prisma.skill.create({
    data: { profileId: profile.id, kind: 'competency', name: data.name, origin: 'manual', order: await nextOrder(profile.id, 'competency') },
  })
  revalidatePath('/dashboard/profile', 'layout')
  return asCompetency(competency)
}

export async function updateCompetency(id: string, data: CompetencyData) {
  const { profile } = await requireProfile()
  const competency = await prisma.skill.update({
    where: { id, profileId: profile.id, kind: 'competency' },
    data: { name: data.name },
  })
  revalidatePath('/dashboard/profile', 'layout')
  return asCompetency(competency)
}

export async function deleteCompetency(id: string) {
  const { profile } = await requireProfile()
  await prisma.skill.deleteMany({ where: { id, profileId: profile.id, kind: 'competency' } })
  revalidatePath('/dashboard/profile', 'layout')
}

// ── Projects ─────────────────────────────────────────────────────────────────

type ProjectData = {
  name: string
  description: string
  experienceId?: string
  url?: string
  repoUrl?: string
  startDate?: Date
  endDate?: Date
  status?: string
}

export async function createProject(data: ProjectData) {
  const { profile } = await requireProfile()
  const { experienceId, name, description, url, repoUrl, startDate, endDate, status } = data

  const project = await withActivityOwnership(profile.id, async (tx) => {
    const owner = await activityFieldsFor(tx, profile.id, { experienceId: experienceId ?? null })
    return tx.project.create({ data: { name, description, url, repoUrl, startDate, endDate, status, experienceId: owner.experienceId, profileId: profile.id } })
  })
  revalidatePath('/dashboard/profile', 'layout')
  return project
}

/** Saves a project's facts from the Properties tab, including which role it is part of. */
export async function updateProjectProperties(id: string, input: ProjectProperties) {
  const { profile } = await requireProfile()
  await saveProjectProperties(profile.id, id, input)
  revalidatePath('/dashboard/profile', 'layout')
}

/** The note's current saved version, so an editor can tell a restored page is stale. */
export async function getNoteLiveState(kind: 'experience' | 'project', id: string) {
  const { profile } = await requireProfile()
  return readNote(profile.id, kind, id)
}

/** Saves a project's note. Refused (not overwritten) when the note moved on since `expectedRevision`. */
export async function updateProjectNotes(id: string, notes: string, expectedRevision: number): Promise<NoteSaveResult> {
  const { profile } = await requireProfile()
  const result = await saveProjectNote(profile.id, id, notes, expectedRevision)
  if (result.ok) revalidatePath('/dashboard/profile', 'layout')
  return result
}

export async function deleteProject(id: string) {
  const { profile } = await requireProfile()
  await deleteProjectRow(profile.id, id)
  revalidatePath('/dashboard/profile', 'layout')
}

// ── Education ─────────────────────────────────────────────────────────────────

type EducationData = {
  institution: string
  qualification: string
  field?: string
  startDate: Date
  endDate?: Date
  grade?: string
}

export async function createEducation(data: EducationData) {
  const { profile } = await requireProfile()
  const education = await prisma.education.create({
    data: { ...data, profileId: profile.id, tags: '[]' },
  })
  revalidatePath('/dashboard/profile', 'layout')
  return education
}

export async function updateEducation(id: string, data: EducationData) {
  const { profile } = await requireProfile()
  const education = await prisma.education.update({ where: { id, profileId: profile.id }, data })
  revalidatePath('/dashboard/profile', 'layout')
  return education
}

export async function deleteEducation(id: string) {
  const { profile } = await requireProfile()
  await prisma.education.deleteMany({ where: { id, profileId: profile.id } })
  revalidatePath('/dashboard/profile', 'layout')
}

// ── Certifications ────────────────────────────────────────────────────────────

type CertificationData = {
  name: string
  issuer: string
  issueDate: Date
  expiryDate?: Date
  credentialUrl?: string
}

export async function createCertification(data: CertificationData) {
  const { profile } = await requireProfile()
  const cert = await prisma.certification.create({
    data: { ...data, profileId: profile.id, tags: '[]' },
  })
  revalidatePath('/dashboard/profile', 'layout')
  return cert
}

export async function updateCertification(id: string, data: CertificationData) {
  const { profile } = await requireProfile()
  const cert = await prisma.certification.update({ where: { id, profileId: profile.id }, data })
  revalidatePath('/dashboard/profile', 'layout')
  return cert
}

export async function deleteCertification(id: string) {
  const { profile } = await requireProfile()
  await prisma.certification.deleteMany({ where: { id, profileId: profile.id } })
  revalidatePath('/dashboard/profile', 'layout')
}

// ── Duplicate project merge ───────────────────────────────────────────────────

const MergeProjectsSchema = z.object({
  keepId: z.string().min(1),
  removeId: z.string().min(1),
  body: z.enum(['keep', 'remove']),
})

/** Merges one standalone project into the role project it copies. Only ever called from a click. */
export async function mergeDuplicateProjects(input: { keepId: string; removeId: string; body: 'keep' | 'remove' }) {
  const parsed = MergeProjectsSchema.parse(input)
  const { profile } = await requireProfile()
  await mergeProjects(profile.id, parsed)
  revalidatePath('/dashboard/profile', 'layout')
}
