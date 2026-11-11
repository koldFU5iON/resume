'use server'

import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { revalidatePath } from 'next/cache'
import { parseCVContent, mergeSectionData, CVSectionSchema, type CVSection, type CVDocumentContent } from './schema'
import { generateCVContent } from './generate'
import { acceptCV, unacceptCV, CV_STATUS } from './acceptance'

export async function createAndGenerateCV({
  jobApplicationId,
}: {
  jobApplicationId?: string
}): Promise<{ id: string }> {
  const { profile } = await requireProfile()

  // If a CV already exists for this job, return it without regenerating
  if (jobApplicationId) {
    const existing = await prisma.cVDocument.findFirst({
      where: { profileId: profile.id, jobApplicationId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (existing) return { id: existing.id }
  }

  // Fetch job details if applicable
  const jobApp = jobApplicationId
    ? await prisma.jobApplication.findFirst({
        where: { id: jobApplicationId, profileId: profile.id },
        select: { title: true, company: true },
      })
    : null
  // Never link a CV to a job the profile doesn't own.
  if (jobApplicationId && !jobApp) throw new Error('Job not found')

  // Find or bootstrap the default template — safe to run on first use in prod
  const template = await prisma.cVTemplate.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      name: 'Default',
      description: 'Standard CV template',
      isDefault: true,
      isBuiltIn: true,
    },
    select: { id: true },
  })

  const doc = await prisma.cVDocument.create({
    data: {
      profileId: profile.id,
      jobApplicationId: jobApplicationId ?? null,
      templateId: template.id,
      generatedContent: '{}',
      status: 'generating',
      jobTitle: jobApp?.title ?? null,
      company: jobApp?.company ?? null,
    },
  })

  try {
    const { content, masterUpdatedAt } = await generateCVContent(profile.id, jobApplicationId, { cvDocumentId: doc.id })
    await prisma.cVDocument.update({
      where: { id: doc.id },
      data: { generatedContent: JSON.stringify(content), status: 'draft', masterCvUpdatedAt: masterUpdatedAt },
    })
    if (jobApplicationId) {
      await prisma.jobApplication.updateMany({
        where: { id: jobApplicationId, profileId: profile.id, status: 'not started' },
        data: { status: 'in-progress' },
      })
      revalidatePath('/dashboard/job-applications')
    }
  } catch (err) {
    await prisma.cVDocument.update({
      where: { id: doc.id },
      data: { status: 'failed' },
    })
    throw err
  }

  return { id: doc.id }
}

export async function updateSection(cvId: string, section: CVSection): Promise<void> {
  const { profile } = await requireProfile()
  const doc = await prisma.cVDocument.findFirst({
    where: { id: cvId, profileId: profile.id },
    select: { id: true, generatedContent: true },
  })
  if (!doc) throw new Error('CV not found')

  const content = parseCVContent(doc.generatedContent)
  const idx = content.sections.findIndex(s => s.id === section.id)
  if (idx === -1) throw new Error('Section not found')

  // Validate the incoming section before writing so a bad payload can never
  // corrupt the stored CV document.
  const parsed = CVSectionSchema.safeParse(section)
  if (!parsed.success) {
    console.error('[updateSection] invalid section rejected', parsed.error.issues)
    throw new Error('Invalid section data. No changes were saved.')
  }
  content.sections[idx] = parsed.data

  await prisma.cVDocument.update({
    where: { id: cvId },
    data: { generatedContent: JSON.stringify(content) },
  })
  revalidatePath(`/dashboard/cv-builder/${cvId}`)
}

// Used by the AI chat assistant when applying a proposed section update.
// Merges the LLM-proposed fields onto the current section data and validates
// the result BEFORE persisting, so a partial/malformed proposal can never
// corrupt the stored CV document.
export async function patchCVSectionData(
  cvId: string,
  sectionId: string,
  data: Record<string, unknown>,
): Promise<CVSection> {
  const { profile } = await requireProfile()
  const doc = await prisma.cVDocument.findFirst({
    where: { id: cvId, profileId: profile.id },
    select: { id: true, generatedContent: true },
  })
  if (!doc) throw new Error('CV not found')

  const content = parseCVContent(doc.generatedContent)
  const idx = content.sections.findIndex(s => s.id === sectionId)
  if (idx === -1) throw new Error('Section not found')

  // Merge only the data field — preserves id, type, visible from the existing
  // section. mergeSectionData validates; it throws rather than write bad data.
  const merged = mergeSectionData(content.sections[idx], data)
  content.sections[idx] = merged

  await prisma.cVDocument.update({
    where: { id: cvId },
    data: { generatedContent: JSON.stringify(content) },
  })
  revalidatePath(`/dashboard/cv-builder/${cvId}`)
  return merged
}

export async function toggleVisibility(cvId: string, sectionId: string): Promise<void> {
  const { profile } = await requireProfile()
  const doc = await prisma.cVDocument.findFirst({
    where: { id: cvId, profileId: profile.id },
    select: { id: true, generatedContent: true },
  })
  if (!doc) throw new Error('CV not found')

  const content = parseCVContent(doc.generatedContent)
  const section = content.sections.find(s => s.id === sectionId)
  if (!section) throw new Error('Section not found')
  section.visible = !section.visible

  await prisma.cVDocument.update({
    where: { id: cvId },
    data: { generatedContent: JSON.stringify(content) },
  })
  revalidatePath(`/dashboard/cv-builder/${cvId}`)
}

export async function deleteCV(cvId: string): Promise<void> {
  const { profile } = await requireProfile()
  await prisma.cVDocument.deleteMany({ where: { id: cvId, profileId: profile.id } })
  revalidatePath('/dashboard/cv-builder')
}

export async function addCustomSection(
  cvId: string,
  heading: string,
  subtype: 'text' | 'list',
  insertIndex?: number,
): Promise<CVSection> {
  const { profile } = await requireProfile()
  const doc = await prisma.cVDocument.findFirst({
    where: { id: cvId, profileId: profile.id },
    select: { id: true, generatedContent: true },
  })
  if (!doc) throw new Error('CV not found')

  const content = parseCVContent(doc.generatedContent)
  const newSection: CVSection = {
    id: crypto.randomUUID(),
    type: 'custom',
    visible: true,
    data: {
      heading,
      subtype,
      content: subtype === 'text' ? '' : null,
      items: subtype === 'list' ? [] : null,
    },
  }
  const idx = Math.max(0, Math.min(insertIndex ?? content.sections.length, content.sections.length))
  content.sections.splice(idx, 0, newSection)

  await prisma.cVDocument.update({
    where: { id: cvId },
    data: { generatedContent: JSON.stringify(content) },
  })
  revalidatePath(`/dashboard/cv-builder/${cvId}`)
  return newSection
}

export async function reorderSections(cvId: string, orderedSectionIds: string[]): Promise<void> {
  const { profile } = await requireProfile()
  const doc = await prisma.cVDocument.findFirst({
    where: { id: cvId, profileId: profile.id },
    select: { id: true, generatedContent: true },
  })
  if (!doc) throw new Error('CV not found')

  const content = parseCVContent(doc.generatedContent)
  const byId = new Map(content.sections.map(s => [s.id, s]))
  const isPermutation =
    orderedSectionIds.length === content.sections.length &&
    new Set(orderedSectionIds).size === orderedSectionIds.length &&
    orderedSectionIds.every(id => byId.has(id))
  if (!isPermutation) throw new Error('Section list out of sync')

  content.sections = orderedSectionIds.map(id => byId.get(id)!)

  await prisma.cVDocument.update({
    where: { id: cvId },
    data: { generatedContent: JSON.stringify(content) },
  })
  revalidatePath(`/dashboard/cv-builder/${cvId}`)
}

/**
 * Regenerates a CV's content. A draft (or failed) CV is overwritten in place.
 * An accepted CV is left exactly as it is, so the record of what was sent
 * survives: the new content goes into a new draft CV for the same job, and
 * its id is returned so the editor can switch to it.
 */
export async function regenerateCVContent(cvId: string): Promise<{ id: string; content: CVDocumentContent }> {
  const { profile } = await requireProfile()
  const doc = await prisma.cVDocument.findFirst({
    where: { id: cvId, profileId: profile.id },
    select: {
      id: true, status: true, jobApplicationId: true, careerVerticalId: true,
      templateId: true, jobDescription: true, jobTitle: true, company: true,
    },
  })
  if (!doc) throw new Error('CV not found')

  const target = doc.status === CV_STATUS.Accepted
    ? await prisma.cVDocument.create({
        data: {
          profileId: profile.id,
          jobApplicationId: doc.jobApplicationId,
          careerVerticalId: doc.careerVerticalId,
          templateId: doc.templateId,
          jobDescription: doc.jobDescription,
          jobTitle: doc.jobTitle,
          company: doc.company,
          generatedContent: '{}',
          status: CV_STATUS.Generating,
        },
        select: { id: true },
      })
    : await prisma.cVDocument.update({
        where: { id: doc.id, profileId: profile.id },
        data: { status: CV_STATUS.Generating },
        select: { id: true },
      })

  try {
    const { content, masterUpdatedAt } = await generateCVContent(profile.id, doc.jobApplicationId ?? undefined, { cvDocumentId: target.id })
    await prisma.cVDocument.update({
      where: { id: target.id, profileId: profile.id },
      data: {
        generatedContent: JSON.stringify(content),
        status: CV_STATUS.Draft,
        masterCvUpdatedAt: masterUpdatedAt,
      },
    })
    revalidatePath(`/dashboard/cv-builder/${target.id}`)
    revalidatePath('/dashboard/cv-builder')
    return { id: target.id, content }
  } catch (err) {
    await prisma.cVDocument.update({
      where: { id: target.id, profileId: profile.id },
      data: { status: CV_STATUS.Failed },
    })
    throw err
  }
}

const ACCEPT_ERRORS = {
  not_found: 'CV not found',
  no_job: 'Only a CV for a job can be accepted.',
  not_ready: 'This CV is not ready to accept yet.',
  already_accepted: 'This CV is already accepted.',
} as const

/** Marks a job CV as accepted (the one used to apply). */
export async function markCVAccepted(cvId: string): Promise<{ acceptedAt: Date }> {
  const { profile } = await requireProfile()
  const res = await acceptCV(profile.id, cvId)
  if (!res.ok) throw new Error(ACCEPT_ERRORS[res.reason])
  revalidatePath(`/dashboard/cv-builder/${cvId}`)
  revalidatePath('/dashboard/cv-builder')
  return { acceptedAt: res.acceptedAt }
}

/** Undoes an acceptance: the CV goes back to draft. */
export async function unmarkCVAccepted(cvId: string): Promise<void> {
  const { profile } = await requireProfile()
  if (!(await unacceptCV(profile.id, cvId))) throw new Error('This CV is not accepted.')
  revalidatePath(`/dashboard/cv-builder/${cvId}`)
  revalidatePath('/dashboard/cv-builder')
}
