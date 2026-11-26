'use server'

import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { revalidatePath } from 'next/cache'
import { parseCVContent, mergeSectionData, CVSectionSchema, type CVSection } from './schema'
import { acceptCV, unacceptCV } from './acceptance'

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
