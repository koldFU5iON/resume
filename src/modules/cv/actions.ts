'use server'

import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { revalidatePath } from 'next/cache'
import { parseCVContent, mergeSectionData, CVSectionSchema, type CVSection, type CVDocumentContent } from './schema'
import { generateCVContent } from './generate'

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
    const { content, masterUpdatedAt } = await generateCVContent(profile.id, jobApplicationId)
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

export async function regenerateCVContent(cvId: string): Promise<CVDocumentContent> {
  const { profile } = await requireProfile()
  const doc = await prisma.cVDocument.findFirst({
    where: { id: cvId, profileId: profile.id },
    select: { id: true, jobApplicationId: true },
  })
  if (!doc) throw new Error('CV not found')

  await prisma.cVDocument.update({
    where: { id: cvId },
    data: { status: 'generating' },
  })

  try {
    const { content, masterUpdatedAt } = await generateCVContent(profile.id, doc.jobApplicationId ?? undefined)
    await prisma.cVDocument.update({
      where: { id: cvId },
      data: {
        generatedContent: JSON.stringify(content),
        status: 'draft',
        masterCvUpdatedAt: masterUpdatedAt,
      },
    })
    revalidatePath(`/dashboard/cv-builder/${cvId}`)
    return content
  } catch (err) {
    await prisma.cVDocument.update({
      where: { id: cvId },
      data: { status: 'failed' },
    })
    throw err
  }
}
