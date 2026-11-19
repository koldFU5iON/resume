import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ requireProfile: vi.fn().mockResolvedValue({ profile: { id: 'p1' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db', () => ({
  prisma: {
    experience: { findFirst: vi.fn(), deleteMany: vi.fn((x) => x) },
    project: { findFirst: vi.fn(), count: vi.fn(), deleteMany: vi.fn((x) => x) },
    roleActivity: { count: vi.fn(), create: vi.fn(async (x) => x), findFirst: vi.fn(), update: vi.fn(async (x) => x), deleteMany: vi.fn(async (x) => x), updateMany: vi.fn() },
    skill: { create: vi.fn(async (x) => x), update: vi.fn(async (x) => x) },
    $transaction: vi.fn(async (ops) => ops),
  },
}))

import { prisma } from '@/lib/db'
import { acceptSuggestions, createActivity, deleteActivity, deleteExperience, getExperienceDeleteImpact, moveActivity, updateActivity } from './actions'

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

describe('evidence order', () => {
  it('puts new evidence after the owner\'s last item instead of tying at 0', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: 'pr1' } as never)
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValue({ order: 4 } as never)
    await createActivity({ projectId: 'pr1' }, data)
    expect(prisma.roleActivity.findFirst).toHaveBeenCalledWith({ where: { projectId: 'pr1' }, orderBy: { order: 'desc' }, select: { order: true } })
    expect(vi.mocked(prisma.roleActivity.create).mock.calls[0][0].data).toMatchObject({ order: 5 })
  })

  it('starts at 0 when the owner has none', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'e1' } as never)
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValue(null)
    await createActivity({ experienceId: 'e1' }, data)
    expect(vi.mocked(prisma.roleActivity.create).mock.calls[0][0].data).toMatchObject({ order: 0 })
  })
})

describe('acceptSuggestions into a project', () => {
  const accepted = { kind: 'achievement', description: 'Cut hotfix time', impact: null }

  it('creates project-owned evidence after the project\'s last item, in the order accepted', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: 'pr1' } as never)
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValue({ order: 2 } as never)
    await acceptSuggestions({ projectId: 'pr1', activities: [accepted, { ...accepted, description: 'Second' }], skills: [] })
    expect(prisma.project.findFirst).toHaveBeenCalledWith({ where: { id: 'pr1', profileId: 'p1' }, select: { id: true } })
    const created = vi.mocked(prisma.roleActivity.create).mock.calls.map(c => c[0].data)
    expect(created).toEqual([
      expect.objectContaining({ projectId: 'pr1', description: 'Cut hotfix time', order: 3 }),
      expect.objectContaining({ projectId: 'pr1', description: 'Second', order: 4 }),
    ])
    expect(created[0]).not.toHaveProperty('experienceId')
  })

  it('replaces only the project\'s own evidence', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: 'pr1' } as never)
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValue(null)
    await acceptSuggestions({ projectId: 'pr1', activities: [{ ...accepted, replaceId: 'a9' }], skills: [] })
    expect(prisma.roleActivity.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'a9', projectId: 'pr1' } }))
  })

  it('refuses a project that is not the caller\'s and writes nothing', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null)
    await expect(acceptSuggestions({ projectId: 'foreign', activities: [accepted], skills: [] })).rejects.toThrow('Project not found')
    expect(prisma.roleActivity.create).not.toHaveBeenCalled()
  })

  it('still accepts into a role, scoped to the role', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'e1' } as never)
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValue(null)
    await acceptSuggestions({ experienceId: 'e1', activities: [{ ...accepted, replaceId: 'a1' }, accepted], skills: [] })
    expect(prisma.roleActivity.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'a1', experienceId: 'e1' } }))
    expect(vi.mocked(prisma.roleActivity.create).mock.calls[0][0].data).toMatchObject({ experienceId: 'e1', order: 0 })
  })
})

describe('moveActivity', () => {
  beforeEach(() => {
    vi.mocked(prisma.roleActivity.findFirst).mockReset()
    vi.mocked(prisma.project.findFirst).mockReset()
    vi.mocked(prisma.experience.findFirst).mockReset()
    vi.mocked(prisma.project.count).mockReset().mockResolvedValue(0)
  })

  it('moves evidence from a role to the profile\'s own project, clearing the role and going to the end of the list', async () => {
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValueOnce({ id: 'a1' } as never).mockResolvedValueOnce({ order: 3 } as never)
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: 'pr1' } as never)
    await moveActivity('a1', { projectId: 'pr1' })
    expect(prisma.roleActivity.findFirst).toHaveBeenCalledWith({ where: { id: 'a1', ...OWNED }, select: { id: true } })
    expect(prisma.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pr1', profileId: 'p1' } }))
    expect(prisma.roleActivity.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { experienceId: null, projectId: 'pr1', order: 4 } })
  })

  it('moves evidence from a project back to a role, clearing the project', async () => {
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValueOnce({ id: 'a1' } as never).mockResolvedValueOnce(null)
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'e1' } as never)
    await moveActivity('a1', { experienceId: 'e1' })
    expect(prisma.roleActivity.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { experienceId: 'e1', projectId: null, order: 0 } })
  })

  it('refuses an archived project and a target with no id', async () => {
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValue({ id: 'a1' } as never)
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: 'pr1' } as never)
    vi.mocked(prisma.project.count).mockResolvedValueOnce(1)
    await expect(moveActivity('a1', { projectId: 'pr1' })).rejects.toThrow('archived')
    await expect(moveActivity('a1', {} as never)).rejects.toThrow('Experience not found')
    expect(prisma.roleActivity.update).not.toHaveBeenCalled()
  })

  it('refuses a foreign activity or a foreign target, and changes nothing', async () => {
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValueOnce(null)
    await expect(moveActivity('foreign', { projectId: 'pr1' })).rejects.toThrow('Activity not found')
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValueOnce({ id: 'a1' } as never)
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null)
    await expect(moveActivity('a1', { projectId: 'foreign' })).rejects.toThrow('Project not found')
    expect(prisma.roleActivity.update).not.toHaveBeenCalled()
  })
})
