import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => {
  const prisma: Record<string, unknown> = {
    experience: { updateMany: vi.fn(), findFirst: vi.fn() },
    project: { findFirst: vi.fn(), update: vi.fn() },
    roleActivity: { updateMany: vi.fn() },
  }
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma))
  return { prisma }
})

import { prisma } from '@/lib/db'
import { saveExperienceProperties, saveProjectProperties } from './properties'

beforeEach(() => vi.clearAllMocks())

const role = { company: 'Acme', role: 'Lead', location: '', remote: false, startDate: '2020-01-05', endDate: '' }

describe('saveExperienceProperties', () => {
  it('writes validated values scoped to the profile, with cleared fields as null', async () => {
    vi.mocked(prisma.experience.updateMany).mockResolvedValue({ count: 1 })
    await saveExperienceProperties('p1', 'e1', { ...role, company: '  Acme  ', endDate: null })
    expect(prisma.experience.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', profileId: 'p1' },
      data: { company: 'Acme', role: 'Lead', location: null, remote: false, startDate: new Date('2020-01-05'), endDate: null },
    })
  })

  it('refuses a blank company or role, a bad date, and an end before the start', async () => {
    await expect(saveExperienceProperties('p1', 'e1', { ...role, company: '  ' })).rejects.toThrow(/Company is required/)
    await expect(saveExperienceProperties('p1', 'e1', { ...role, role: '' })).rejects.toThrow(/Role is required/)
    await expect(saveExperienceProperties('p1', 'e1', { ...role, startDate: 'not a date' as never })).rejects.toThrow()
    await expect(saveExperienceProperties('p1', 'e1', { ...role, endDate: '2019-01-01' })).rejects.toThrow(/end date is before/)
    expect(prisma.experience.updateMany).not.toHaveBeenCalled()
  })

  it('throws for a role that is not the caller\'s', async () => {
    vi.mocked(prisma.experience.updateMany).mockResolvedValue({ count: 0 })
    await expect(saveExperienceProperties('p1', 'foreign', role)).rejects.toThrow('Experience not found')
  })
})

const project = { name: 'Launch', description: '', url: '', repoUrl: '', startDate: '', endDate: '', experienceId: null }

describe('saveProjectProperties', () => {
  beforeEach(() => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ experienceId: null } as never)
  })

  it('writes validated values, a project with no role stored as null, in one transaction', async () => {
    await saveProjectProperties('p1', 'pr1', { ...project, url: 'https://x.test', startDate: '2021-03-01' })
    expect(prisma.project.findFirst).toHaveBeenCalledWith({ where: { id: 'pr1', profileId: 'p1' }, select: { experienceId: true } })
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'pr1' },
      data: { name: 'Launch', description: '', url: 'https://x.test', repoUrl: null, startDate: new Date('2021-03-01'), endDate: null, experienceId: null },
    })
    expect(prisma.experience.findFirst).not.toHaveBeenCalled()
    // The role did not change, so its evidence is left alone.
    expect(prisma.roleActivity.updateMany).not.toHaveBeenCalled()
  })

  it('moves a project only into one of the caller\'s own roles', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue(null)
    await expect(saveProjectProperties('p1', 'pr1', { ...project, experienceId: 'someone-elses' })).rejects.toThrow('Experience not found')
    expect(prisma.project.update).not.toHaveBeenCalled()
    expect(prisma.roleActivity.updateMany).not.toHaveBeenCalled()

    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'e2' } as never)
    await saveProjectProperties('p1', 'pr1', { ...project, experienceId: 'e2' })
    expect(prisma.experience.findFirst).toHaveBeenCalledWith({ where: { id: 'e2', profileId: 'p1' }, select: { id: true } })
    expect(vi.mocked(prisma.project.update).mock.calls[0][0].data).toMatchObject({ experienceId: 'e2' })
  })

  it('moves the evidence that carried the old role to the new role, and leaves another role\'s own evidence alone', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ experienceId: 'e1' } as never)
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'e2' } as never)
    await saveProjectProperties('p1', 'pr1', { ...project, experienceId: 'e2' })
    expect(prisma.roleActivity.updateMany).toHaveBeenCalledWith({ where: { projectId: 'pr1', experienceId: 'e1' }, data: { experienceId: 'e2' } })
  })

  it('moving a project to no role clears the role from the evidence that carried the old one', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ experienceId: 'e1' } as never)
    await saveProjectProperties('p1', 'pr1', project)
    expect(prisma.roleActivity.updateMany).toHaveBeenCalledWith({ where: { projectId: 'pr1', experienceId: 'e1' }, data: { experienceId: null } })
  })

  it('giving a role-less project a role gives that role to its evidence that has none', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'e2' } as never)
    await saveProjectProperties('p1', 'pr1', { ...project, experienceId: 'e2' })
    expect(prisma.roleActivity.updateMany).toHaveBeenCalledWith({ where: { projectId: 'pr1', experienceId: null }, data: { experienceId: 'e2' } })
  })

  it('refuses a blank name, a non-web address, and an end before the start', async () => {
    await expect(saveProjectProperties('p1', 'pr1', { ...project, name: ' ' })).rejects.toThrow(/Name is required/)
    await expect(saveProjectProperties('p1', 'pr1', { ...project, url: 'javascript:alert(1)' })).rejects.toThrow(/web address/)
    await expect(saveProjectProperties('p1', 'pr1', { ...project, startDate: '2022-01-01', endDate: '2021-01-01' })).rejects.toThrow(/end date is before/)
    expect(prisma.project.update).not.toHaveBeenCalled()
  })

  it('throws for a project that is not the caller\'s', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null)
    await expect(saveProjectProperties('p1', 'foreign', project)).rejects.toThrow('Project not found')
    expect(prisma.project.update).not.toHaveBeenCalled()
  })
})
