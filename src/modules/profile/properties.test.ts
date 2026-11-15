import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    experience: { updateMany: vi.fn(), findFirst: vi.fn() },
    project: { updateMany: vi.fn() },
  },
}))

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
  it('writes validated values scoped to the profile, a project with no role stored as null', async () => {
    vi.mocked(prisma.project.updateMany).mockResolvedValue({ count: 1 })
    await saveProjectProperties('p1', 'pr1', { ...project, url: 'https://x.test', startDate: '2021-03-01' })
    expect(prisma.project.updateMany).toHaveBeenCalledWith({
      where: { id: 'pr1', profileId: 'p1' },
      data: { name: 'Launch', description: '', url: 'https://x.test', repoUrl: null, startDate: new Date('2021-03-01'), endDate: null, experienceId: null },
    })
    expect(prisma.experience.findFirst).not.toHaveBeenCalled()
  })

  it('moves a project only into one of the caller\'s own roles', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue(null)
    await expect(saveProjectProperties('p1', 'pr1', { ...project, experienceId: 'someone-elses' })).rejects.toThrow('Experience not found')
    expect(prisma.project.updateMany).not.toHaveBeenCalled()

    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'e2' } as never)
    vi.mocked(prisma.project.updateMany).mockResolvedValue({ count: 1 })
    await saveProjectProperties('p1', 'pr1', { ...project, experienceId: 'e2' })
    expect(prisma.experience.findFirst).toHaveBeenCalledWith({ where: { id: 'e2', profileId: 'p1' }, select: { id: true } })
    expect(vi.mocked(prisma.project.updateMany).mock.calls[0][0].data).toMatchObject({ experienceId: 'e2' })
  })

  it('refuses a blank name, a non-web address, and an end before the start', async () => {
    await expect(saveProjectProperties('p1', 'pr1', { ...project, name: ' ' })).rejects.toThrow(/Name is required/)
    await expect(saveProjectProperties('p1', 'pr1', { ...project, url: 'javascript:alert(1)' })).rejects.toThrow(/web address/)
    await expect(saveProjectProperties('p1', 'pr1', { ...project, startDate: '2022-01-01', endDate: '2021-01-01' })).rejects.toThrow(/end date is before/)
    expect(prisma.project.updateMany).not.toHaveBeenCalled()
  })

  it('throws for a project that is not the caller\'s', async () => {
    vi.mocked(prisma.project.updateMany).mockResolvedValue({ count: 0 })
    await expect(saveProjectProperties('p1', 'foreign', project)).rejects.toThrow('Project not found')
  })
})
