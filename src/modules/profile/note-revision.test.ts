import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    experience: { updateMany: vi.fn(), findFirst: vi.fn() },
    project: { updateMany: vi.fn(), findFirst: vi.fn() },
  },
}))

import { prisma } from '@/lib/db'
import { readNote, saveExperienceNote, saveProjectNote } from './note-revision'

beforeEach(() => vi.clearAllMocks())

describe('saveExperienceNote', () => {
  it('writes only when the revision matches, scoped to the profile, and bumps it', async () => {
    vi.mocked(prisma.experience.updateMany).mockResolvedValue({ count: 1 })
    const result = await saveExperienceNote('p1', 'e1', 'new text', 4)
    expect(result).toEqual({ ok: true, revision: 5 })
    expect(prisma.experience.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', profileId: 'p1', revision: 4 },
      data: { summary: 'new text', notesUpdatedAt: expect.any(Date), revision: { increment: 1 } },
    })
    expect(prisma.experience.findFirst).not.toHaveBeenCalled()
  })

  it('returns the saved version when the note moved on', async () => {
    vi.mocked(prisma.experience.updateMany).mockResolvedValue({ count: 0 })
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ revision: 7, summary: 'saved elsewhere' } as never)
    const result = await saveExperienceNote('p1', 'e1', 'mine', 4)
    expect(result).toEqual({ ok: false, reason: 'conflict', revision: 7, content: 'saved elsewhere' })
    expect(prisma.experience.findFirst).toHaveBeenCalledWith({
      where: { id: 'e1', profileId: 'p1' },
      select: { revision: true, summary: true },
    })
  })

  it('throws, rather than reporting a conflict, for a role that is not the caller\'s', async () => {
    vi.mocked(prisma.experience.updateMany).mockResolvedValue({ count: 0 })
    vi.mocked(prisma.experience.findFirst).mockResolvedValue(null)
    await expect(saveExperienceNote('p1', 'foreign', 'x', 1)).rejects.toThrow('Experience not found')
  })
})

describe('saveProjectNote', () => {
  it('writes only when the revision matches, scoped to the profile, and bumps it', async () => {
    vi.mocked(prisma.project.updateMany).mockResolvedValue({ count: 1 })
    const result = await saveProjectNote('p1', 'pr1', 'notes', 1)
    expect(result).toEqual({ ok: true, revision: 2 })
    expect(prisma.project.updateMany).toHaveBeenCalledWith({
      where: { id: 'pr1', profileId: 'p1', revision: 1 },
      data: { notes: 'notes', revision: { increment: 1 } },
    })
  })

  it('returns the saved version when the note moved on', async () => {
    vi.mocked(prisma.project.updateMany).mockResolvedValue({ count: 0 })
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ revision: 3, notes: 'other tab' } as never)
    expect(await saveProjectNote('p1', 'pr1', 'mine', 1)).toEqual({
      ok: false, reason: 'conflict', revision: 3, content: 'other tab',
    })
  })

  it('throws for a project that is not the caller\'s', async () => {
    vi.mocked(prisma.project.updateMany).mockResolvedValue({ count: 0 })
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null)
    await expect(saveProjectNote('p1', 'foreign', 'x', 1)).rejects.toThrow('Project not found')
  })
})

describe('readNote', () => {
  it('reads a role\'s text and revision, scoped to the profile', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ summary: 'role text', revision: 3 } as never)
    expect(await readNote('p1', 'experience', 'e1')).toEqual({ content: 'role text', revision: 3 })
    expect(prisma.experience.findFirst).toHaveBeenCalledWith({ where: { id: 'e1', profileId: 'p1' }, select: { summary: true, revision: true } })
  })

  it('reads a project\'s notes and revision', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ notes: 'project text', revision: 2 } as never)
    expect(await readNote('p1', 'project', 'pr1')).toEqual({ content: 'project text', revision: 2 })
  })

  it('is null for a note that is not the caller\'s', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null)
    expect(await readNote('p1', 'experience', 'x')).toBeNull()
    expect(await readNote('p1', 'project', 'x')).toBeNull()
  })
})
