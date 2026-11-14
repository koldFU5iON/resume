'use server'

import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { revalidatePath } from 'next/cache'
import * as z from 'zod'
import { activityOwnedBy } from './ownership'
import { saveExperienceNote, saveProjectNote, type NoteSaveResult } from './note-revision'
import { mergeProjects } from './project-merge'
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
  revalidatePath('/dashboard/profile')
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
  revalidatePath('/dashboard/profile')
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

type ActivityData = { kind: string; description: string; impact?: string }

/** Evidence belongs to exactly one owner: a role or a project. */
export type ActivityOwner = { experienceId: string } | { projectId: string }

export async function createActivity(owner: ActivityOwner, data: ActivityData) {
  const { profile } = await requireProfile()
  let ownerData: ActivityOwner
  if ('projectId' in owner) {
    const project = await prisma.project.findFirst({ where: { id: owner.projectId, profileId: profile.id }, select: { id: true } })
    if (!project) throw new Error('Project not found')
    ownerData = { projectId: project.id }
  } else {
    const experience = await prisma.experience.findFirst({ where: { id: owner.experienceId, profileId: profile.id }, select: { id: true } })
    if (!experience) throw new Error('Experience not found')
    ownerData = { experienceId: experience.id }
  }
  const activity = await prisma.roleActivity.create({
    data: { ...ActivityInputSchema.parse(data), ...ownerData, tags: '[]', order: 0 },
  })
  revalidatePath('/dashboard/profile')
  return activity
}

export async function updateActivity(id: string, data: ActivityData) {
  const { profile } = await requireProfile()
  const existing = await prisma.roleActivity.findFirst({
    where: { id, ...activityOwnedBy(profile.id) },
  })
  if (!existing) throw new Error('Activity not found')
  const activity = await prisma.roleActivity.update({ where: { id }, data: ActivityInputSchema.parse(data) })
  revalidatePath('/dashboard/profile')
  return activity
}

export async function deleteActivity(id: string) {
  const { profile } = await requireProfile()
  await prisma.roleActivity.deleteMany({
    where: { id, ...activityOwnedBy(profile.id) },
  })
  revalidatePath('/dashboard/profile')
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
  const experience = await prisma.experience.create({
    data: { ...data, profileId: profile.id },
  })
  revalidatePath('/dashboard/profile')
  return experience
}

export async function updateExperience(id: string, data: ExperienceData) {
  const { profile } = await requireProfile()
  const existing = await prisma.experience.findFirst({
    where: { id, profileId: profile.id },
    select: { summary: true },
  })
  const notesChanged = existing?.summary !== data.summary
  const experience = await prisma.experience.update({
    where: { id, profileId: profile.id },
    data: {
      ...data,
      ...(notesChanged ? { notesUpdatedAt: new Date(), revision: { increment: 1 } } : {}),
    },
  })
  revalidatePath('/dashboard/profile')
  revalidatePath(`/dashboard/profile/experience/${id}`)
  return experience
}

const DeleteExperienceOptionsSchema = z.object({ projects: z.enum(['keep', 'delete']) })

/** What deleting a role takes with it, counted from the database rather than client state. */
export async function getExperienceDeleteImpact(id: string) {
  const { profile } = await requireProfile()
  const [evidence, projects, projectEvidence] = await Promise.all([
    prisma.roleActivity.count({ where: { experienceId: id, experience: { profileId: profile.id } } }),
    prisma.project.count({ where: { experienceId: id, profileId: profile.id } }),
    prisma.roleActivity.count({ where: { project: { experienceId: id, profileId: profile.id } } }),
  ])
  return { evidence, projects, projectEvidence }
}

/**
 * `projects: 'keep'` leaves the role's projects standalone (experienceId set
 * null by the foreign key); `'delete'` removes them, and their evidence, too.
 * No default: the caller must choose. Idempotent: a role that is already gone
 * (a double click, another tab) is a no-op, not an error.
 */
export async function deleteExperience(id: string, options: { projects: 'keep' | 'delete' }) {
  const { projects } = DeleteExperienceOptionsSchema.parse(options)
  const { profile } = await requireProfile()
  const experience = await prisma.experience.findFirst({ where: { id, profileId: profile.id }, select: { id: true } })
  if (experience) {
    if (projects === 'delete') {
      await prisma.$transaction([
        prisma.project.deleteMany({ where: { experienceId: id, profileId: profile.id } }),
        prisma.experience.deleteMany({ where: { id, profileId: profile.id } }),
      ])
    } else {
      await prisma.experience.deleteMany({ where: { id, profileId: profile.id } })
    }
  }
  revalidatePath('/dashboard/profile')
}

type ExperienceDetailsData = {
  company: string
  role: string
  location?: string
  remote: boolean
  startDate: Date
  endDate?: Date
}

export async function updateExperienceDetails(id: string, data: ExperienceDetailsData) {
  const { profile } = await requireProfile()
  const experience = await prisma.experience.update({
    where: { id, profileId: profile.id },
    data,
  })
  revalidatePath('/dashboard/profile')
  revalidatePath(`/dashboard/profile/experience/${id}`)
  return experience
}

/** Saves a role's note. Refused (not overwritten) when the note moved on since `expectedRevision`. */
export async function updateExperienceNotes(id: string, summary: string, expectedRevision: number): Promise<NoteSaveResult> {
  const { profile } = await requireProfile()
  const result = await saveExperienceNote(profile.id, id, summary, expectedRevision)
  if (result.ok) {
    revalidatePath('/dashboard/profile')
    revalidatePath(`/dashboard/profile/experience/${id}`)
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

export type AcceptSuggestionsPayload = {
  experienceId: string
  activities: AcceptedActivity[]
  skills: AcceptedSkill[]
}

export async function acceptSuggestions(payload: AcceptSuggestionsPayload) {
  const { profile } = await requireProfile()

  // Verify ownership before writing anything
  const experience = await prisma.experience.findFirst({
    where: { id: payload.experienceId, profileId: profile.id },
    select: { id: true },
  })
  if (!experience) throw new Error('Experience not found')
  if (payload.activities.some((a) => !(ACTIVITY_KINDS as readonly string[]).includes(a.kind))) {
    throw new Error('Invalid activity kind')
  }

  await prisma.$transaction([
    ...payload.activities.map((a) =>
      a.replaceId
        ? prisma.roleActivity.update({
            where: { id: a.replaceId, experienceId: payload.experienceId },
            data: { description: a.description, impact: a.impact ?? undefined, kind: a.kind },
          })
        : prisma.roleActivity.create({
            data: {
              experienceId: payload.experienceId,
              kind: a.kind,
              description: a.description,
              impact: a.impact ?? undefined,
              tags: '[]',
              order: 0,
            },
          }),
    ),
    ...payload.skills.map((s) =>
      s.replaceId
        ? prisma.skill.update({
            where: { id: s.replaceId, profileId: profile.id },
            data: {
              name: s.name,
              ...(s.category ? { category: s.category } : {}),
              ...(s.level ? { level: normalizeSkillLevel(s.level) } : {}),
            },
          })
        : prisma.skill.create({
            data: {
              profileId: profile.id,
              name: s.name,
              category: s.category ?? DEFAULT_SKILL_CATEGORY,
              level: normalizeSkillLevel(s.level),
              tags: '[]',
            },
          }),
    ),
  ])

  revalidatePath('/dashboard/profile')
  revalidatePath(`/dashboard/profile/experience/${payload.experienceId}`)
}

// ── Skills ────────────────────────────────────────────────────────────────────

type SkillData = { name: string; category: string; level: string; yearsOfExperience?: number }

export async function createSkill(data: SkillData) {
  const { profile } = await requireProfile()
  const skill = await prisma.skill.create({
    data: { ...SkillInputSchema.parse(data), profileId: profile.id, tags: '[]' },
  })
  revalidatePath('/dashboard/profile')
  return skill
}

export async function updateSkill(id: string, data: SkillData) {
  const { profile } = await requireProfile()
  const skill = await prisma.skill.update({ where: { id, profileId: profile.id }, data: SkillInputSchema.parse(data) })
  revalidatePath('/dashboard/profile')
  return skill
}

export async function deleteSkill(id: string) {
  const { profile } = await requireProfile()
  await prisma.skill.deleteMany({ where: { id, profileId: profile.id } })
  revalidatePath('/dashboard/profile')
}

// ── Languages ─────────────────────────────────────────────────────────────────

type LanguageData = { name: string; proficiency?: string }

export async function createLanguage(data: LanguageData) {
  const { profile } = await requireProfile()
  const language = await prisma.language.create({
    data: { ...data, proficiency: data.proficiency?.trim() || null, profileId: profile.id },
  })
  revalidatePath('/dashboard/profile')
  return language
}

export async function updateLanguage(id: string, data: LanguageData) {
  const { profile } = await requireProfile()
  const language = await prisma.language.update({
    where: { id, profileId: profile.id },
    data: { ...data, proficiency: data.proficiency?.trim() || null },
  })
  revalidatePath('/dashboard/profile')
  return language
}

export async function deleteLanguage(id: string) {
  const { profile } = await requireProfile()
  await prisma.language.deleteMany({ where: { id, profileId: profile.id } })
  revalidatePath('/dashboard/profile')
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
  revalidatePath('/dashboard/profile')
  return asTool(tool)
}

export async function updateTool(id: string, data: ToolData) {
  const { profile } = await requireProfile()
  const tool = await prisma.skill.update({
    where: { id, profileId: profile.id, kind: 'tool' },
    data: { name: data.name, category: data.category ?? null },
  })
  revalidatePath('/dashboard/profile')
  return asTool(tool)
}

export async function deleteTool(id: string) {
  const { profile } = await requireProfile()
  await prisma.skill.deleteMany({ where: { id, profileId: profile.id, kind: 'tool' } })
  revalidatePath('/dashboard/profile')
}

export async function createCompetency(data: CompetencyData) {
  const { profile } = await requireProfile()
  const competency = await prisma.skill.create({
    data: { profileId: profile.id, kind: 'competency', name: data.name, origin: 'manual', order: await nextOrder(profile.id, 'competency') },
  })
  revalidatePath('/dashboard/profile')
  return asCompetency(competency)
}

export async function updateCompetency(id: string, data: CompetencyData) {
  const { profile } = await requireProfile()
  const competency = await prisma.skill.update({
    where: { id, profileId: profile.id, kind: 'competency' },
    data: { name: data.name },
  })
  revalidatePath('/dashboard/profile')
  return asCompetency(competency)
}

export async function deleteCompetency(id: string) {
  const { profile } = await requireProfile()
  await prisma.skill.deleteMany({ where: { id, profileId: profile.id, kind: 'competency' } })
  revalidatePath('/dashboard/profile')
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
  highlights?: string[]
  tags?: string[]
}

export async function createProject(data: ProjectData) {
  const { profile } = await requireProfile()
  const { highlights, tags, experienceId, ...rest } = data

  if (experienceId) {
    const experience = await prisma.experience.findFirst({
      where: { id: experienceId, profileId: profile.id },
      select: { id: true },
    })
    if (!experience) throw new Error('Experience not found')
  }

  const project = await prisma.project.create({
    data: {
      ...rest,
      experienceId,
      profileId: profile.id,
      highlights: JSON.stringify(highlights ?? []),
      tags: JSON.stringify(tags ?? []),
    },
  })
  revalidatePath('/dashboard/profile')
  return project
}

export async function updateProject(id: string, data: ProjectData) {
  const { profile } = await requireProfile()
  const { highlights, tags, ...rest } = data
  // Re-linking a project must stay within the caller's own experiences.
  if (rest.experienceId) {
    const experience = await prisma.experience.findFirst({
      where: { id: rest.experienceId, profileId: profile.id },
      select: { id: true },
    })
    if (!experience) throw new Error('Experience not found')
  }
  const project = await prisma.project.update({
    where: { id, profileId: profile.id },
    data: {
      ...rest,
      ...(highlights !== undefined ? { highlights: JSON.stringify(highlights) } : {}),
      ...(tags !== undefined ? { tags: JSON.stringify(tags) } : {}),
    },
  })
  revalidatePath('/dashboard/profile')
  return project
}

/** Saves a project's note. Refused (not overwritten) when the note moved on since `expectedRevision`. */
export async function updateProjectNotes(id: string, notes: string, expectedRevision: number): Promise<NoteSaveResult> {
  const { profile } = await requireProfile()
  const result = await saveProjectNote(profile.id, id, notes, expectedRevision)
  if (result.ok) revalidatePath('/dashboard/profile')
  return result
}

export async function deleteProject(id: string) {
  const { profile } = await requireProfile()
  await prisma.project.deleteMany({ where: { id, profileId: profile.id } })
  revalidatePath('/dashboard/profile')
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
  revalidatePath('/dashboard/profile')
  return education
}

export async function updateEducation(id: string, data: EducationData) {
  const { profile } = await requireProfile()
  const education = await prisma.education.update({ where: { id, profileId: profile.id }, data })
  revalidatePath('/dashboard/profile')
  return education
}

export async function deleteEducation(id: string) {
  const { profile } = await requireProfile()
  await prisma.education.deleteMany({ where: { id, profileId: profile.id } })
  revalidatePath('/dashboard/profile')
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
  revalidatePath('/dashboard/profile')
  return cert
}

export async function updateCertification(id: string, data: CertificationData) {
  const { profile } = await requireProfile()
  const cert = await prisma.certification.update({ where: { id, profileId: profile.id }, data })
  revalidatePath('/dashboard/profile')
  return cert
}

export async function deleteCertification(id: string) {
  const { profile } = await requireProfile()
  await prisma.certification.deleteMany({ where: { id, profileId: profile.id } })
  revalidatePath('/dashboard/profile')
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
  revalidatePath('/dashboard/profile')
}
