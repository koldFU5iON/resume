import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', () => ({ cache: (f: unknown) => f }))
vi.mock('@/lib/session', () => ({ requireProfile: vi.fn() }))
vi.mock('@/lib/db', () => ({
  prisma: {
    experience: { findFirst: vi.fn() },
    project: { findFirst: vi.fn(), findMany: vi.fn() },
    skill: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

import { prisma } from '@/lib/db'
import { getExperienceWithSuggestionContext, getProjectWithSuggestionContext } from './queries'

beforeEach(() => vi.clearAllMocks())

const act = (id: string, experienceId: string | null, projectId: string | null) => ({ id, description: id, kind: 'achievement', experienceId, projectId })

describe('suggestion context', () => {
  it('offers a role\'s note only the role\'s own evidence, never an activity labelled with a project', async () => {
    vi.mocked(prisma.experience.findFirst).mockResolvedValue({ id: 'e1', activities: [act('own', 'e1', null), act('labelled', 'e1', 'p1'), act('legacy', null, 'p1'), act('other', 'e1', 'p2')] } as never)
    // p1 is a project of e1; p2 belongs to another role, so an e1 activity labelled with it is e1's own.
    vi.mocked(prisma.project.findMany).mockResolvedValue([{ id: 'p1', experienceId: 'e1' }, { id: 'p2', experienceId: 'e9' }] as never)
    const ctx = await getExperienceWithSuggestionContext('e1', 'prof1')
    expect(ctx!.experience.activities.map((a) => a.id)).toEqual(['own', 'other'])
    expect(Object.keys(ctx!.experience.activities[0]).sort()).toEqual(['description', 'id', 'kind'])
    expect(prisma.project.findMany).toHaveBeenCalledWith({ where: { profileId: 'prof1' }, select: { id: true, experienceId: true } })
  })

  it('offers a project\'s note its own evidence, not another role\'s evidence that carries its label', async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: 'p1', experienceId: 'e1', activities: [act('a', 'e1', 'p1'), act('b', null, 'p1'), act('c', 'e9', 'p1')] } as never)
    const ctx = await getProjectWithSuggestionContext('p1', 'prof1')
    expect(ctx!.project.activities.map((a) => a.id)).toEqual(['a', 'b'])
  })
})
