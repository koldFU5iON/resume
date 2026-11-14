import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => {
  const prisma = {
    project: { findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
    roleActivity: { update: vi.fn() },
    roleActivitySkill: { findMany: vi.fn(), createMany: vi.fn() },
    projectSkill: { findMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(),
  }
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
  return { prisma }
})

import { prisma } from '@/lib/db'
import { findDuplicateProjects, mergeProjects, pairDuplicateProjects, projectBody } from './project-merge'

const proj = (id: string, name: string, experienceId: string | null, description = '', notes = '') =>
  ({ id, name, experienceId, description, notes })

beforeEach(() => vi.clearAllMocks())

describe('pairDuplicateProjects', () => {
  it('pairs a standalone project with a role project of the same name, ignoring case and spacing', () => {
    const pairs = pairDuplicateProjects([proj('r1', 'Release  Train', 'e1', 'x'), proj('s1', 'release train', null, 'y')])
    expect(pairs.map((p) => [p.standalone.id, p.roleProject.id])).toEqual([['s1', 'r1']])
  })

  it('pairs by the first 300 characters of body when names differ', () => {
    const lead = 'a'.repeat(300)
    const pairs = pairDuplicateProjects([proj('r1', 'Alpha', 'e1', `${lead} tail one`), proj('s1', 'Beta', null, `${lead} other tail`)])
    expect(pairs).toHaveLength(1)
    expect(pairDuplicateProjects([proj('r1', 'Alpha', 'e1', 'short one'), proj('s1', 'Beta', null, 'short two')])).toEqual([])
  })

  it('never pairs on an empty body, two role projects, or two standalone projects', () => {
    expect(pairDuplicateProjects([proj('r1', 'A', 'e1'), proj('s1', 'B', null)])).toEqual([])
    expect(pairDuplicateProjects([proj('r1', 'Same', 'e1'), proj('r2', 'Same', 'e2')])).toEqual([])
    expect(pairDuplicateProjects([proj('s1', 'Same', null), proj('s2', 'Same', null)])).toEqual([])
  })

  it('uses each role project once, giving it to the strongest match', () => {
    const body = 'shared body text'
    const pairs = pairDuplicateProjects([
      proj('r1', 'Other', 'e1', body), proj('r2', 'Match', 'e1', 'unrelated'),
      proj('s1', 'Match', null, body), proj('s2', 'Match', null, 'unrelated'),
    ])
    // s2 matches r2 on name and body; s1 then falls back to r1 on body alone.
    expect(pairs.map((p) => [p.standalone.id, p.roleProject.id])).toEqual([['s2', 'r2'], ['s1', 'r1']])
  })

  it('does not let an earlier weak match take a project a later, stronger one needs', () => {
    const pairs = pairDuplicateProjects([
      proj('r1', 'Train', 'e1', 'shared'),
      proj('weak', 'Different', null, 'shared'), // body only, listed first
      proj('strong', 'train', null, 'other'), // name match
    ])
    expect(pairs.map((p) => [p.standalone.id, p.roleProject.id])).toEqual([['strong', 'r1']])
  })
})

describe('projectBody', () => {
  it('joins description and notes like the vault does', () => {
    expect(projectBody({ description: ' A ', notes: ' B ' })).toBe('A\n\nB')
    expect(projectBody({ description: 'A', notes: '' })).toBe('A')
  })
})

describe('findDuplicateProjects', () => {
  it('scopes the read to the profile and reports evidence counts and body equality', async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      { ...proj('r1', 'Train', 'e1', 'Same text'), experience: { role: 'PM', company: 'Acme' }, _count: { activities: 3 } },
      { ...proj('s1', 'Train', null, 'same  text'), experience: null, _count: { activities: 2 } },
    ] as never)
    const [pair] = await findDuplicateProjects('p1')
    expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { profileId: 'p1' } }))
    expect(pair).toMatchObject({
      sameBody: true,
      standalone: { id: 's1', evidenceCount: 2 },
      roleProject: { id: 'r1', evidenceCount: 3, role: 'PM at Acme' },
    })
  })
})

describe('mergeProjects', () => {
  const ev = (id: string, description: string, order: number) => ({ id, description, order })
  const rows = (keep: object, remove: object) => vi.mocked(prisma.project.findMany).mockResolvedValue([
    { id: 'keep', description: 'K desc', notes: 'K notes', startDate: null, endDate: null, url: null, repoUrl: null, activities: [], ...keep },
    { id: 'gone', description: 'R desc', notes: 'R notes', startDate: null, endDate: null, url: null, repoUrl: null, activities: [], ...remove },
  ] as never)

  it('refuses a project outside the profile or the same project twice, and writes nothing', async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([{ id: 'keep', activities: [] }] as never)
    await expect(mergeProjects('p1', { keepId: 'keep', removeId: 'foreign', body: 'keep' })).rejects.toThrow('Project not found')
    await expect(mergeProjects('p1', { keepId: 'keep', removeId: 'keep', body: 'keep' })).rejects.toThrow('different')
    expect(prisma.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['keep', 'foreign'] }, profileId: 'p1' } }))
    expect(prisma.project.delete).not.toHaveBeenCalled()
    expect(prisma.roleActivity.update).not.toHaveBeenCalled()
  })

  it('moves evidence (not copies), appending after the kept project\'s own, then deletes the other', async () => {
    rows({ activities: [ev('k1', 'Kept item', 4)] }, { activities: [ev('g1', 'Moved A', 0), ev('g2', 'Moved B', 1)] })
    vi.mocked(prisma.projectSkill.findMany).mockResolvedValue([])
    await mergeProjects('p1', { keepId: 'keep', removeId: 'gone', body: 'keep' })
    expect(prisma.roleActivity.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { projectId: 'keep', order: 5 } })
    expect(prisma.roleActivity.update).toHaveBeenCalledWith({ where: { id: 'g2' }, data: { projectId: 'keep', order: 6 } })
    expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 'gone' } })
  })

  it('does not move evidence the kept project already has, but keeps its confirmed links', async () => {
    rows({ activities: [ev('k1', 'Shipped  4 releases', 0)] }, { activities: [ev('g1', 'shipped 4 releases', 0), ev('g2', 'New', 1)] })
    vi.mocked(prisma.roleActivitySkill.findMany).mockResolvedValue([{ skillId: 's1', source: 'manual', reason: null }] as never)
    vi.mocked(prisma.projectSkill.findMany).mockResolvedValue([])
    await mergeProjects('p1', { keepId: 'keep', removeId: 'gone', body: 'keep' })
    expect(prisma.roleActivity.update).toHaveBeenCalledTimes(1)
    expect(prisma.roleActivity.update).toHaveBeenCalledWith({ where: { id: 'g2' }, data: { projectId: 'keep', order: 1 } })
    expect(prisma.roleActivitySkill.createMany).toHaveBeenCalledWith({
      data: [{ roleActivityId: 'k1', skillId: 's1', status: 'confirmed', source: 'manual', reason: null }],
      skipDuplicates: true,
    })
  })

  it('moves project capability links, skipping ones the kept project has', async () => {
    rows({}, {})
    vi.mocked(prisma.projectSkill.findMany).mockResolvedValue([{ skillId: 's1' }, { skillId: 's2' }] as never)
    await mergeProjects('p1', { keepId: 'keep', removeId: 'gone', body: 'keep' })
    expect(prisma.projectSkill.createMany).toHaveBeenCalledWith({
      data: [{ projectId: 'keep', skillId: 's1' }, { projectId: 'keep', skillId: 's2' }],
      skipDuplicates: true,
    })
  })

  it('fills only empty dates and URLs on the kept project', async () => {
    const d1 = new Date('2020-01-01'), d2 = new Date('2021-01-01')
    rows({ startDate: d1, url: 'https://kept.test' }, { startDate: d2, endDate: d2, url: 'https://other.test', repoUrl: 'https://git.test/r' })
    vi.mocked(prisma.projectSkill.findMany).mockResolvedValue([])
    await mergeProjects('p1', { keepId: 'keep', removeId: 'gone', body: 'keep' })
    expect(prisma.project.update).toHaveBeenCalledWith({ where: { id: 'keep' }, data: { endDate: d2, repoUrl: 'https://git.test/r' } })
  })

  it('takes the other project\'s description and notes only when asked', async () => {
    rows({}, {})
    vi.mocked(prisma.projectSkill.findMany).mockResolvedValue([])
    await mergeProjects('p1', { keepId: 'keep', removeId: 'gone', body: 'remove' })
    expect(prisma.project.update).toHaveBeenCalledWith({ where: { id: 'keep' }, data: { description: 'R desc', notes: 'R notes' } })
  })
})
