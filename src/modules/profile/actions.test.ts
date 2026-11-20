import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ requireProfile: vi.fn().mockResolvedValue({ profile: { id: 'p1' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const prismaMock = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/lib/db', () => ({
  prisma: {
    experience: { findFirst: vi.fn(), create: vi.fn(async () => ({ id: 'ind-new' })), deleteMany: vi.fn((x) => x) },
    project: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn(async (x) => x), updateMany: vi.fn(), deleteMany: vi.fn((x) => x) },
    roleActivity: { count: vi.fn(), create: vi.fn(async (x) => x), findFirst: vi.fn(), update: vi.fn(async (x) => x), deleteMany: vi.fn(async (x) => x), updateMany: vi.fn() },
    skill: { create: vi.fn(async (x) => x), update: vi.fn(async (x) => x) },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(async (arg) => (typeof arg === 'function' ? arg(prismaMock.current) : arg)),
  },
}))

import { prisma } from '@/lib/db'
import { acceptSuggestions, createActivity, createProject, deleteActivity, deleteExperience, deleteProject, getExperienceDeleteImpact, moveActivity, updateActivity } from './actions'

const data = { kind: 'achievement', description: 'Shipped A' }
const OWNED = { OR: [{ experience: { profileId: 'p1' } }, { project: { profileId: 'p1' } }] }

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.current = prisma
})

describe('createActivity', () => {
  it('labels evidence with the profile\'s own project and gives it the project\'s role', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: 'pr1', experienceId: 'e1' } as never)
    await createActivity({ projectId: 'pr1' }, data)
    expect(prisma.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pr1', profileId: 'p1' } }))
    expect(prisma.roleActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: 'pr1', experienceId: 'e1', description: 'Shipped A' }),
    })
  })

  it('gives evidence of a project with no role no role', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: 'pr1', experienceId: null } as never)
    await createActivity({ projectId: 'pr1' }, data)
    expect(vi.mocked(prisma.roleActivity.create).mock.calls[0][0].data).toMatchObject({ projectId: 'pr1', experienceId: null })
  })

  it('creates role-owned evidence for the profile\'s own experience', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'e1' } as never)
    await createActivity({ experienceId: 'e1' }, data)
    expect(prisma.experience.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'e1', profileId: 'p1' } }))
    expect(vi.mocked(prisma.roleActivity.create).mock.calls[0][0].data).toMatchObject({ experienceId: 'e1', projectId: null })
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
    expect(prisma.roleActivity.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'a9', experienceId: 'e1', projectId: null } }))
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

  it('keep: MOVES the role\'s projects and their evidence to Independent projects (found), then deletes only the role', async () => {
    vi.mocked(prisma.experience.findFirst)
      .mockResolvedValueOnce({ id: 'e1', type: 'employment' } as never) // the role being deleted
      .mockResolvedValueOnce({ id: 'ind' } as never) // the existing independent experience
    await deleteExperience('e1', { projects: 'keep' })
    expect(prisma.experience.create).not.toHaveBeenCalled()
    expect(prisma.roleActivity.updateMany).toHaveBeenCalledWith({ where: { experienceId: 'e1', project: { experienceId: 'e1', profileId: 'p1' } }, data: { experienceId: 'ind' } })
    expect(prisma.roleActivity.updateMany).toHaveBeenCalledWith({ where: { experienceId: null, project: { experienceId: 'e1', profileId: 'p1' } }, data: { experienceId: 'ind' } })
    expect(prisma.project.updateMany).toHaveBeenCalledWith({ where: { experienceId: 'e1', profileId: 'p1' }, data: { experienceId: 'ind' } })
    expect(prisma.experience.deleteMany).toHaveBeenCalledWith({ where: { id: 'e1', profileId: 'p1' } })
    expect(prisma.project.deleteMany).not.toHaveBeenCalled()
    const order = [prisma.project.updateMany, prisma.experience.deleteMany].map((f) => vi.mocked(f).mock.invocationCallOrder.at(-1)!)
    expect(order[0]).toBeLessThan(order[1])
  })

  it('keep: creates Independent projects when the profile has none', async () => {
    vi.mocked(prisma.experience.findFirst)
      .mockResolvedValueOnce({ id: 'e1', type: 'employment' } as never)
      .mockResolvedValueOnce(null)
    await deleteExperience('e1', { projects: 'keep' })
    expect(prisma.experience.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ profileId: 'p1', type: 'independent', company: 'Independent projects', role: 'Independent projects' }) }))
    expect(prisma.project.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { experienceId: 'ind-new' } }))
  })

  it('keep is refused for Independent projects itself (nowhere to move to), and nothing is written', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'ind', type: 'independent' } as never)
    await expect(deleteExperience('ind', { projects: 'keep' })).rejects.toThrow(/Independent projects/)
    expect(prisma.experience.deleteMany).not.toHaveBeenCalled()
    expect(prisma.project.updateMany).not.toHaveBeenCalled()
  })

  it('delete: removes the role\'s projects and the role in one transaction', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'e1', type: 'employment' } as never)
    await deleteExperience('e1', { projects: 'delete' })
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.project.deleteMany).toHaveBeenCalledWith({ where: { experienceId: 'e1', profileId: 'p1' } })
    expect(prisma.experience.deleteMany).toHaveBeenCalledWith({ where: { id: 'e1', profileId: 'p1' } })
    // Not the keep-step: nothing is detached from the role in this branch.
    expect(prisma.roleActivity.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: { experienceId: 'ind' } }))
    expect(prisma.project.updateMany).not.toHaveBeenCalled()
  })

  it('when the projects are deleted, another role\'s evidence under them keeps its role and loses only the label; when kept, it is left alone', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'e1' } as never)
    const detach = {
      where: { project: { experienceId: 'e1', profileId: 'p1' }, AND: [{ experienceId: { not: null } }, { experienceId: { not: 'e1' } }] },
      data: { projectId: null },
    }
    await deleteExperience('e1', { projects: 'delete' })
    expect(prisma.roleActivity.updateMany).toHaveBeenCalledWith(detach)
    vi.mocked(prisma.roleActivity.updateMany).mockClear()
    vi.mocked(prisma.experience.findFirst).mockResolvedValueOnce({ id: 'e1', type: 'employment' } as never).mockResolvedValueOnce({ id: 'ind' } as never)
    await deleteExperience('e1', { projects: 'keep' })
    expect(prisma.roleActivity.updateMany).not.toHaveBeenCalledWith(detach)
  })

  it('locks the role first, so a concurrent write into its projects waits instead of landing between the steps', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValueOnce({ id: 'e1', type: 'employment' } as never).mockResolvedValueOnce({ id: 'ind' } as never)
    await deleteExperience('e1', { projects: 'keep' })
    const lock = vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]
    expect(lock).toBeLessThan(vi.mocked(prisma.roleActivity.updateMany).mock.invocationCallOrder[0])
    expect(lock).toBeLessThan(vi.mocked(prisma.experience.deleteMany).mock.invocationCallOrder[0])
  })
})

describe('deleteProject', () => {
  it('detaches evidence of another role before deleting the project, and is a no-op for a missing project', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null)
    await deleteProject('gone')
    expect(prisma.project.deleteMany).not.toHaveBeenCalled()

    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: 'pr1', experienceId: 'e1' } as never)
    await deleteProject('pr1')
    expect(prisma.roleActivity.updateMany).toHaveBeenCalledWith({
      where: { projectId: 'pr1', AND: [{ experienceId: { not: null } }, { experienceId: { not: 'e1' } }] },
      data: { projectId: null },
    })
    expect(prisma.project.deleteMany).toHaveBeenCalledWith({ where: { id: 'pr1', profileId: 'p1' } })
  })
  it('for a project with no role, any activity carrying a role is detached', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: 'pr1', experienceId: null } as never)
    await deleteProject('pr1')
    expect(prisma.roleActivity.updateMany).toHaveBeenCalledWith({ where: { projectId: 'pr1', AND: [{ experienceId: { not: null } }] }, data: { projectId: null } })
  })
})

describe('getExperienceDeleteImpact', () => {
  it('counts what goes either way, the projects, and what goes only with the projects, scoped to the profile', async () => {
    vi.mocked(prisma.roleActivity.count).mockResolvedValueOnce(4).mockResolvedValueOnce(7)
    vi.mocked(prisma.project.count).mockResolvedValue(2)
    await expect(getExperienceDeleteImpact('e1')).resolves.toEqual({ evidence: 4, projects: 2, projectEvidence: 7 })
    expect(prisma.roleActivity.count).toHaveBeenCalledWith({
      where: {
        experienceId: 'e1',
        experience: { profileId: 'p1' },
        OR: [{ projectId: null }, { project: { is: { experienceId: null } } }, { project: { is: { experienceId: { not: 'e1' } } } }],
      },
    })
    expect(prisma.roleActivity.count).toHaveBeenCalledWith({ where: { project: { experienceId: 'e1', profileId: 'p1' }, OR: [{ experienceId: null }, { experienceId: 'e1' }] } })
    expect(prisma.project.count).toHaveBeenCalledWith({ where: { experienceId: 'e1', profileId: 'p1' } })
  })
})

describe('evidence order', () => {
  it('puts new evidence after the owner\'s last item instead of tying at 0', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: 'pr1', experienceId: 'e1' } as never)
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValue({ order: 4 } as never)
    await createActivity({ projectId: 'pr1' }, data)
    expect(prisma.roleActivity.findFirst).toHaveBeenCalledWith({ where: { projectId: 'pr1' }, orderBy: { order: 'desc' }, select: { order: true } })
    expect(vi.mocked(prisma.roleActivity.create).mock.calls[0][0].data).toMatchObject({ order: 5 })
  })

  it('starts at 0 when the owner has none', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'e1' } as never)
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValue(null)
    await createActivity({ experienceId: 'e1' }, data)
    // A role's own list leaves out the activities labelled with a project (they are ordered within the project).
    expect(prisma.roleActivity.findFirst).toHaveBeenCalledWith({ where: { experienceId: 'e1', projectId: null }, orderBy: { order: 'desc' }, select: { order: true } })
    expect(vi.mocked(prisma.roleActivity.create).mock.calls[0][0].data).toMatchObject({ order: 0 })
  })
})

describe('acceptSuggestions into a project', () => {
  const accepted = { kind: 'achievement', description: 'Cut hotfix time', impact: null }

  it('labels new evidence with the project and its role, after the project\'s last item, in the order accepted', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: 'pr1', experienceId: 'e1' } as never)
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValue({ order: 2 } as never)
    await acceptSuggestions({ projectId: 'pr1', activities: [accepted, { ...accepted, description: 'Second' }], skills: [] })
    expect(prisma.project.findFirst).toHaveBeenCalledWith({ where: { id: 'pr1', profileId: 'p1' }, select: { id: true, experienceId: true } })
    const created = vi.mocked(prisma.roleActivity.create).mock.calls.map(c => c[0].data)
    expect(created).toEqual([
      expect.objectContaining({ projectId: 'pr1', experienceId: 'e1', description: 'Cut hotfix time', order: 3 }),
      expect.objectContaining({ projectId: 'pr1', experienceId: 'e1', description: 'Second', order: 4 }),
    ])
  })

  it('replaces only the project\'s own evidence', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: 'pr1', experienceId: 'e1' } as never)
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
    expect(prisma.roleActivity.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'a1', experienceId: 'e1', projectId: null } }))
    expect(vi.mocked(prisma.roleActivity.create).mock.calls[0][0].data).toMatchObject({ experienceId: 'e1', projectId: null, order: 0 })
  })
})

describe('moveActivity', () => {
  beforeEach(() => {
    vi.mocked(prisma.roleActivity.findFirst).mockReset()
    vi.mocked(prisma.project.findFirst).mockReset()
    vi.mocked(prisma.experience.findFirst).mockReset()
    vi.mocked(prisma.project.count).mockReset().mockResolvedValue(0)
  })

  it('moves evidence to the profile\'s own project, taking the project\'s role and going to the end of its list', async () => {
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValueOnce({ id: 'a1' } as never).mockResolvedValueOnce({ order: 3 } as never)
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: 'pr1', experienceId: 'e9' } as never)
    await moveActivity('a1', { projectId: 'pr1' })
    expect(prisma.roleActivity.findFirst).toHaveBeenCalledWith({ where: { id: 'a1', ...OWNED }, select: { id: true } })
    expect(prisma.project.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pr1', profileId: 'p1' } }))
    expect(prisma.roleActivity.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { experienceId: 'e9', projectId: 'pr1', order: 4 } })
  })

  it('moves evidence from a project back to a role, clearing the project', async () => {
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValueOnce({ id: 'a1' } as never).mockResolvedValueOnce(null)
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'e1' } as never)
    await moveActivity('a1', { experienceId: 'e1' })
    expect(prisma.roleActivity.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { experienceId: 'e1', projectId: null, order: 0 } })
  })

  it('moving into a project with no role leaves the activity with no role', async () => {
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValueOnce({ id: 'a1' } as never).mockResolvedValueOnce(null)
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: 'pr1', experienceId: null } as never)
    await moveActivity('a1', { projectId: 'pr1' })
    expect(prisma.roleActivity.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { experienceId: null, projectId: 'pr1', order: 0 } })
  })

  it('refuses an archived project and a target with no id', async () => {
    vi.mocked(prisma.roleActivity.findFirst).mockResolvedValue({ id: 'a1' } as never)
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: 'pr1', experienceId: 'e1' } as never)
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

describe('createProject', () => {
  it('a project with no role goes under Independent projects (found)', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'ind' } as never)
    await createProject({ name: 'Side tool', description: '' })
    expect(prisma.experience.create).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.project.create).mock.calls.at(-1)![0].data).toMatchObject({ profileId: 'p1', experienceId: 'ind' })
  })
  it('creates Independent projects on first use', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue(null)
    await createProject({ name: 'Side tool', description: '' })
    expect(prisma.experience.create).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.project.create).mock.calls.at(-1)![0].data).toMatchObject({ experienceId: 'ind-new' })
  })
  it('a project with a role keeps it, and the role must be the profile\'s own', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'e1' } as never)
    await createProject({ name: 'Launch', description: '', experienceId: 'e1' })
    expect(prisma.experience.create).not.toHaveBeenCalled()
    expect(vi.mocked(prisma.project.create).mock.calls.at(-1)![0].data).toMatchObject({ experienceId: 'e1' })
    vi.mocked(prisma.experience.findFirst).mockResolvedValue(null)
    await expect(createProject({ name: 'X', description: '', experienceId: 'foreign' })).rejects.toThrow('Experience not found')
  })
})
