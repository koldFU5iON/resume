import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ requireProfile: vi.fn().mockResolvedValue({ profile: { id: 'p1' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db', () => ({
  prisma: {
    experience: { findFirst: vi.fn(), deleteMany: vi.fn((x) => x) },
    project: { findFirst: vi.fn(), count: vi.fn(), deleteMany: vi.fn((x) => x) },
    roleActivity: { count: vi.fn(), create: vi.fn(async (x) => x), findFirst: vi.fn(), update: vi.fn(async (x) => x), deleteMany: vi.fn(async (x) => x), updateMany: vi.fn() },
    $transaction: vi.fn(async (ops) => ops),
  },
}))

import { prisma } from '@/lib/db'
import { acceptSuggestions, createActivity, deleteActivity, deleteExperience, getExperienceDeleteImpact, updateActivity } from './actions'

const data = { kind: 'achievement', description: 'Shipped A' }
const OWNED = { OR: [{ experience: { profileId: 'p1' } }, { project: { profileId: 'p1' } }] }

beforeEach(() => vi.clearAllMocks())

describe('createActivity', () => {
  it('creates project-owned evidence for the profile\'s own project', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: 'pr1' } as never)
    await createActivity({ projectId: 'pr1' }, data)
    expect(prisma.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pr1', profileId: 'p1' } }))
    expect(prisma.roleActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: 'pr1', description: 'Shipped A' }),
    })
    expect(vi.mocked(prisma.roleActivity.create).mock.calls[0][0].data).not.toHaveProperty('experienceId')
  })

  it('creates role-owned evidence for the profile\'s own experience', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'e1' } as never)
    await createActivity({ experienceId: 'e1' }, data)
    expect(prisma.experience.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'e1', profileId: 'p1' } }))
    expect(vi.mocked(prisma.roleActivity.create).mock.calls[0][0].data).toMatchObject({ experienceId: 'e1' })
    expect(vi.mocked(prisma.roleActivity.create).mock.calls[0][0].data).not.toHaveProperty('projectId')
  })

  it('refuses a foreign project or experience', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.experience.findFirst).mockResolvedValue(null)
    await expect(createActivity({ projectId: 'foreign' }, data)).rejects.toThrow('Project not found')
    await expect(createActivity({ experienceId: 'foreign' }, data)).rejects.toThrow('Experience not found')
    expect(prisma.roleActivity.create).not.toHaveBeenCalled()
  })
})

describe('updateActivity / deleteActivity', () => {
  it('filter by ownership through a role or a project', async () => {
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValue({ id: 'a1' } as never)
    await updateActivity('a1', data)
    expect(prisma.roleActivity.findFirst).toHaveBeenCalledWith({ where: { id: 'a1', ...OWNED } })
    await deleteActivity('a1')
    expect(prisma.roleActivity.deleteMany).toHaveBeenCalledWith({ where: { id: 'a1', ...OWNED } })
  })

  it('refuses to update a foreign activity', async () => {
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValue(null)
    await expect(updateActivity('foreign', data)).rejects.toThrow('Activity not found')
    expect(prisma.roleActivity.update).not.toHaveBeenCalled()
  })
})

describe('acceptSuggestions', () => {
  it('refuses a foreign experience and scopes replaced rows to the experience', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue(null)
    await expect(acceptSuggestions({ experienceId: 'foreign', activities: [], skills: [] })).rejects.toThrow('Experience not found')

    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'e1' } as never)
    await acceptSuggestions({ experienceId: 'e1', activities: [{ kind: 'achievement', description: 'x', impact: null, replaceId: 'a9' }], skills: [] })
    expect(prisma.roleActivity.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'a9', experienceId: 'e1' } }))
  })
})

describe('deleteExperience', () => {
  it('requires an explicit projects choice', async () => {
    await expect(deleteExperience('e1', {} as never)).rejects.toThrow()
    await expect(deleteExperience('e1', { projects: 'nope' } as never)).rejects.toThrow()
    expect(prisma.experience.deleteMany).not.toHaveBeenCalled()
  })

  it('is a no-op for a missing or foreign experience, and deletes nothing', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue(null)
    await expect(deleteExperience('foreign', { projects: 'delete' })).resolves.toBeUndefined()
    expect(prisma.project.deleteMany).not.toHaveBeenCalled()
    expect(prisma.experience.deleteMany).not.toHaveBeenCalled()
  })

  it('keep: deletes only the role, leaving projects to the SetNull foreign key', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'e1' } as never)
    await deleteExperience('e1', { projects: 'keep' })
    expect(prisma.experience.deleteMany).toHaveBeenCalledWith({ where: { id: 'e1', profileId: 'p1' } })
    expect(prisma.project.deleteMany).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('delete: removes the role\'s projects and the role in one transaction', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'e1' } as never)
    await deleteExperience('e1', { projects: 'delete' })
    expect(prisma.$transaction).toHaveBeenCalledWith([
      { where: { experienceId: 'e1', profileId: 'p1' } },
      { where: { id: 'e1', profileId: 'p1' } },
    ])
    expect(prisma.project.deleteMany).toHaveBeenCalledWith({ where: { experienceId: 'e1', profileId: 'p1' } })
  })
})

describe('getExperienceDeleteImpact', () => {
  it('counts the role\'s evidence, projects and project evidence, scoped to the profile', async () => {
    vi.mocked(prisma.roleActivity.count).mockResolvedValueOnce(4).mockResolvedValueOnce(7)
    vi.mocked(prisma.project.count).mockResolvedValue(2)
    await expect(getExperienceDeleteImpact('e1')).resolves.toEqual({ evidence: 4, projects: 2, projectEvidence: 7 })
    expect(prisma.roleActivity.count).toHaveBeenCalledWith({ where: { experienceId: 'e1', experience: { profileId: 'p1' } } })
    expect(prisma.roleActivity.count).toHaveBeenCalledWith({ where: { project: { experienceId: 'e1', profileId: 'p1' } } })
    expect(prisma.project.count).toHaveBeenCalledWith({ where: { experienceId: 'e1', profileId: 'p1' } })
  })
})
