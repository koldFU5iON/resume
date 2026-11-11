import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: { skill: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), findFirst: vi.fn() } },
}))
vi.mock('@/lib/session', () => ({ requireProfile: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { createCompetency, createTool, deleteCompetency, deleteTool, updateTool } from './actions'

const t = new Date('2026-01-01T00:00:00Z')
const row = (over: Record<string, unknown>) => ({
  id: 'x1', profileId: 'profile-1', name: 'Figma', kind: 'tool', category: 'Design', level: null, order: 3,
  origin: null, yearsOfExperience: null, tags: '[]', notes: null, createdAt: t, updatedAt: t, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireProfile).mockResolvedValue({ profile: { id: 'profile-1' } } as never)
})

describe('tools and competencies live in Skill with a kind', () => {
  it('creates a tool as a Skill row of kind "tool", placed after the last one', async () => {
    vi.mocked(prisma.skill.findFirst).mockResolvedValue({ order: 2 } as never)
    vi.mocked(prisma.skill.create).mockResolvedValue(row({}) as never)

    const tool = await createTool({ name: 'Figma', category: 'Design' })

    expect(prisma.skill.create).toHaveBeenCalledWith({
      data: { profileId: 'profile-1', kind: 'tool', name: 'Figma', category: 'Design', order: 3 },
    })
    // The legacy Tool shape the profile UI uses: no level, kind or tags.
    expect(tool).toEqual({ id: 'x1', profileId: 'profile-1', name: 'Figma', category: 'Design', order: 3, createdAt: t, updatedAt: t })
  })

  it('creates a manual competency, first in an empty list', async () => {
    vi.mocked(prisma.skill.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.skill.create).mockResolvedValue(row({ kind: 'competency', name: 'Negotiation', category: null, order: 0, origin: 'manual' }) as never)

    const competency = await createCompetency({ name: 'Negotiation' })

    expect(prisma.skill.create).toHaveBeenCalledWith({
      data: { profileId: 'profile-1', kind: 'competency', name: 'Negotiation', origin: 'manual', order: 0 },
    })
    expect(competency).toMatchObject({ name: 'Negotiation', origin: 'manual' })
  })

  it('scopes updates and deletes to the profile and the kind', async () => {
    vi.mocked(prisma.skill.update).mockResolvedValue(row({}) as never)
    await updateTool('x1', { name: 'Figma' })
    expect(prisma.skill.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'x1', profileId: 'profile-1', kind: 'tool' },
    }))

    await deleteTool('x1')
    await deleteCompetency('c1')
    expect(prisma.skill.deleteMany).toHaveBeenNthCalledWith(1, { where: { id: 'x1', profileId: 'profile-1', kind: 'tool' } })
    expect(prisma.skill.deleteMany).toHaveBeenNthCalledWith(2, { where: { id: 'c1', profileId: 'profile-1', kind: 'competency' } })
  })
})
