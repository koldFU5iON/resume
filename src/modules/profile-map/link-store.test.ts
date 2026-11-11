import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    roleActivity: { findMany: vi.fn() },
    skill: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    roleActivitySkill: { upsert: vi.fn((x) => x), findMany: vi.fn(), deleteMany: vi.fn((x) => x), createMany: vi.fn((x) => x) },
    $transaction: vi.fn(async (ops) => ops),
  },
}))
vi.mock('@/modules/llm/client', () => ({ completeStructured: vi.fn() }))
vi.mock('./load', async () => {
  const { buildVault } = await import('./build')
  const { vaultSource } = await import('./__fixtures__/source')
  return { loadVault: vi.fn(async () => buildVault(vaultSource())) }
})

import { prisma } from '@/lib/db'
import { completeStructured } from '@/modules/llm/client'
import { addCapabilityWithEvidence, confirmLinks, rejectLinks, suggestLinks } from './link-store'
import { buildVault } from './build'
import { vaultSource } from './__fixtures__/source'
import { buildSuggestionPrompt } from './suggest'

const owns = (evidence: string[], skills: string[]) => {
  vi.mocked(prisma.roleActivity.findMany).mockResolvedValue(evidence.map((id) => ({ id })) as never)
  vi.mocked(prisma.skill.findMany).mockResolvedValue(skills.map((id) => ({ id })) as never)
}

beforeEach(() => vi.clearAllMocks())

describe('confirmLinks / rejectLinks', () => {
  it('writes only pairs whose evidence and capability belong to the profile', async () => {
    owns(['a1'], ['s1'])
    const count = await confirmLinks('p1', [
      { evidenceId: 'a1', capabilityId: 's1' },
      { evidenceId: 'someone-elses', capabilityId: 's1' },
      { evidenceId: 'a1', capabilityId: 'someone-elses' },
    ])
    expect(count).toBe(1)
    expect(prisma.roleActivity.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ experience: { profileId: 'p1' } }) }))
    expect(prisma.roleActivitySkill.upsert).toHaveBeenCalledTimes(1)
    expect(prisma.roleActivitySkill.upsert).toHaveBeenCalledWith({
      where: { roleActivityId_skillId: { roleActivityId: 'a1', skillId: 's1' } },
      create: { roleActivityId: 'a1', skillId: 's1', status: 'confirmed', source: 'manual' },
      update: { status: 'confirmed' },
    })
  })

  it('records a rejection, which also hides a derived exact match', async () => {
    owns(['a1'], ['s2'])
    await rejectLinks('p1', [{ evidenceId: 'a1', capabilityId: 's2' }])
    expect(prisma.roleActivitySkill.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { status: 'rejected' } }))
  })
})

describe('suggestLinks', () => {
  it('replaces the pending batch without touching confirmed or rejected rows', async () => {
    const { refs } = buildSuggestionPrompt(buildVault(vaultSource()))
    const E = (id: string) => `E${refs.evidence.indexOf(id) + 1}`
    const C = (id: string) => `C${refs.capabilities.indexOf(id) + 1}`
    vi.mocked(prisma.roleActivitySkill.findMany).mockResolvedValue([] as never)
    vi.mocked(completeStructured).mockResolvedValue({
      object: {
        links: [{ evidence: E('a2'), capability: C('s3'), reason: 'Standups are agile practice' }],
        newCapabilities: [{ name: 'Facilitation', kind: 'competency', evidence: [E('a2')], reason: 'Runs standups' }],
      },
    } as never)
    owns(['a2'], ['s3'])

    const result = await suggestLinks('p1')

    expect(completeStructured).toHaveBeenCalledWith('p1', expect.any(String), expect.anything(), expect.objectContaining({ feature: 'profile-evidence-links' }))
    expect(prisma.roleActivitySkill.deleteMany).toHaveBeenCalledWith({ where: { status: 'suggested', skill: { profileId: 'p1' } } })
    expect(prisma.roleActivitySkill.createMany).toHaveBeenCalledWith({
      data: [{ roleActivityId: 'a2', skillId: 's3', status: 'suggested', source: 'ai', reason: 'Standups are agile practice' }],
      skipDuplicates: true,
    })
    expect(result).toEqual({ links: 1, newCapabilities: [{ name: 'Facilitation', kind: 'competency', evidenceIds: ['a2'], reason: 'Runs standups' }] })
  })
})

describe('addCapabilityWithEvidence', () => {
  it('creates the capability last in its kind and confirms its evidence', async () => {
    vi.mocked(prisma.skill.findFirst).mockResolvedValue({ order: 4 } as never)
    vi.mocked(prisma.skill.create).mockResolvedValue({ id: 'new1' } as never)
    owns(['a2'], ['new1'])

    const result = await addCapabilityWithEvidence('p1', { name: ' Facilitation ', kind: 'competency', evidenceIds: ['a2'] })

    expect(prisma.skill.create).toHaveBeenCalledWith({
      data: { profileId: 'p1', name: 'Facilitation', kind: 'competency', order: 5, origin: 'derived' },
      select: { id: true },
    })
    expect(result).toEqual({ id: 'new1', linked: 1 })
  })
})
