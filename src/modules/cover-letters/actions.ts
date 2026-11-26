'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { nanoid } from 'nanoid'

type CoverLetterSection = { id: string; content: string }

function parseSections(raw: string): CoverLetterSection[] {
  try { return JSON.parse(raw) } catch { return [] }
}

function deriveSections(
  newContent: string,
  existing: CoverLetterSection[],
): CoverLetterSection[] {
  const paragraphs = newContent.split(/\n\n+/).filter(p => p.trim())
  const usedIds = new Set<string>()
  return paragraphs.map(content => {
    const match = existing.find(s => s.content === content && !usedIds.has(s.id))
    if (match) { usedIds.add(match.id); return match }
    return { id: nanoid(), content }
  })
}

export async function linkJobToCoverLetter(
  id: string,
  jobApplicationId: string,
): Promise<{ jobTitle: string | null; company: string | null }> {
  const { profile } = await requireProfile()

  const job = await prisma.jobApplication.findFirst({
    where: { id: jobApplicationId, profileId: profile.id },
    select: { title: true, company: true },
  })
  if (!job) throw new Error('Job not found')

  const jobTitle = job.title
  const company = job.company ?? null

  const updated = await prisma.coverLetterDocument.updateMany({
    where: { id, profileId: profile.id },
    data: { jobApplicationId, jobTitle, company },
  })
  if (updated.count === 0) throw new Error('Cover letter not found')

  revalidatePath(`/dashboard/cover-letters/${id}`)
  return { jobTitle, company }
}

export async function updateCoverLetterContent(id: string, content: string): Promise<void> {
  const { profile } = await requireProfile()
  const existing = await prisma.coverLetterDocument.findFirst({
    where: { id, profileId: profile.id },
    select: { sections: true },
  })
  if (!existing) throw new Error('Cover letter not found')
  const sections = deriveSections(content, parseSections(existing.sections))
  const updated = await prisma.coverLetterDocument.updateMany({
    where: { id, profileId: profile.id },
    data: { content, sections: JSON.stringify(sections) },
  })
  if (updated.count === 0) throw new Error('Cover letter not found')
  revalidatePath('/dashboard/cover-letters')
}

export async function updateCoverLetterSection(
  letterId: string,
  sectionId: string,
  newContent: string,
): Promise<string> {
  const { profile } = await requireProfile()
  const letter = await prisma.coverLetterDocument.findFirst({
    where: { id: letterId, profileId: profile.id },
    select: { sections: true },
  })
  if (!letter) throw new Error('Cover letter not found')
  const sections = parseSections(letter.sections)
  const idx = sections.findIndex(s => s.id === sectionId)
  if (idx === -1) throw new Error('Section not found')
  sections[idx] = { id: sectionId, content: newContent }
  const content = sections.map(s => s.content).join('\n\n')
  await prisma.coverLetterDocument.updateMany({
    where: { id: letterId, profileId: profile.id },
    data: { content, sections: JSON.stringify(sections) },
  })
  revalidatePath('/dashboard/cover-letters')
  revalidatePath(`/dashboard/cover-letters/${letterId}`)
  return content
}

export async function deleteCoverLetter(id: string): Promise<void> {
  const { profile } = await requireProfile()

  const deleted = await prisma.coverLetterDocument.deleteMany({
    where: { id, profileId: profile.id },
  })

  if (deleted.count === 0) throw new Error('Cover letter not found')

  revalidatePath('/dashboard/cover-letters')
}
