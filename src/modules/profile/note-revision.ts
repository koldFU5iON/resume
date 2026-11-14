// Revision-checked saves for a role's note (Experience.summary) and a
// project's note (Project.notes). Session-free: every function takes the
// caller's profileId first. A save carries the revision it was based on and is
// refused when the note has moved on, mirroring WritingDeskSaveResult so the
// shared document editor handles both the same way.

import { prisma } from '@/lib/db'

export type NoteSaveResult =
  | { ok: true; revision: number }
  | { ok: false; reason: 'conflict'; revision: number; content: string }

/** Saves a role's note. Throws when the role isn't the caller's. */
export async function saveExperienceNote(
  profileId: string,
  id: string,
  content: string,
  expectedRevision: number,
): Promise<NoteSaveResult> {
  const updated = await prisma.experience.updateMany({
    where: { id, profileId, revision: expectedRevision },
    data: { summary: content, notesUpdatedAt: new Date(), revision: { increment: 1 } },
  })
  if (updated.count === 1) return { ok: true, revision: expectedRevision + 1 }
  const current = await prisma.experience.findFirst({
    where: { id, profileId },
    select: { revision: true, summary: true },
  })
  if (!current) throw new Error('Experience not found')
  return { ok: false, reason: 'conflict', revision: current.revision, content: current.summary }
}

/** Saves a project's note. Throws when the project isn't the caller's. */
export async function saveProjectNote(
  profileId: string,
  id: string,
  content: string,
  expectedRevision: number,
): Promise<NoteSaveResult> {
  const updated = await prisma.project.updateMany({
    where: { id, profileId, revision: expectedRevision },
    data: { notes: content, revision: { increment: 1 } },
  })
  if (updated.count === 1) return { ok: true, revision: expectedRevision + 1 }
  const current = await prisma.project.findFirst({
    where: { id, profileId },
    select: { revision: true, notes: true },
  })
  if (!current) throw new Error('Project not found')
  return { ok: false, reason: 'conflict', revision: current.revision, content: current.notes }
}

/** A note's current saved text and revision, or null when it isn't the caller's. Read-only. */
export async function readNote(
  profileId: string,
  kind: 'experience' | 'project',
  id: string,
): Promise<{ content: string; revision: number } | null> {
  if (kind === 'experience') {
    const row = await prisma.experience.findFirst({ where: { id, profileId }, select: { summary: true, revision: true } })
    return row ? { content: row.summary, revision: row.revision } : null
  }
  const row = await prisma.project.findFirst({ where: { id, profileId }, select: { notes: true, revision: true } })
  return row ? { content: row.notes, revision: row.revision } : null
}
