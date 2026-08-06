import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

vi.mock('@/lib/db', () => ({
  prisma: {
    userSettings: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}))
vi.mock('@/lib/session', () => ({
  requireProfile: vi.fn().mockResolvedValue({ profile: { id: 'profile-1' } }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { prisma } from '@/lib/db'
import { savePromptOverride, revertPrompt, resetAllPrompts } from './actions'

const mockFindUnique = vi.mocked(prisma.userSettings.findUnique)
const mockUpsert = vi.mocked(prisma.userSettings.upsert)

function seedOverrides(overrides: Record<string, string> | null) {
  mockFindUnique.mockResolvedValue({ customPrompts: overrides } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  seedOverrides(null)
  mockUpsert.mockResolvedValue({ id: 'row-1' } as never)
})

describe('savePromptOverride', () => {
  it('saves trimmed text and preserves other overrides', async () => {
    seedOverrides({ 'cv-generate': 'keep me' })
    await savePromptOverride('cv-job-analysis', '  new text  ')
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          customPrompts: { 'cv-generate': 'keep me', 'cv-job-analysis': 'new text' },
        }),
      }),
    )
  })

  it('creates a settings row when none exists', async () => {
    await savePromptOverride('cv-generate', 'my prompt')
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ profileId: 'profile-1', customPrompts: { 'cv-generate': 'my prompt' } }),
      }),
    )
  })

  it('throws on an unknown key', async () => {
    await expect(savePromptOverride('nope', 'text')).rejects.toThrow('Unknown prompt key')
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('throws when the text is too long', async () => {
    await expect(savePromptOverride('cv-generate', 'x'.repeat(20_001))).rejects.toThrow(/characters or fewer/)
  })

  it('throws when the text is empty after trimming', async () => {
    await expect(savePromptOverride('cv-generate', '   ')).rejects.toThrow(/cannot be empty/)
  })
})

describe('revertPrompt', () => {
  it('removes the key and writes JsonNull when it was the only override', async () => {
    seedOverrides({ 'cv-generate': 'custom' })
    await revertPrompt('cv-generate')
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ customPrompts: Prisma.JsonNull }),
      }),
    )
  })

  it('removes only the target key', async () => {
    seedOverrides({ 'cv-generate': 'a', 'cv-job-analysis': 'b' })
    await revertPrompt('cv-generate')
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ customPrompts: { 'cv-job-analysis': 'b' } }),
      }),
    )
  })

  it('no-ops when the key has no override', async () => {
    seedOverrides({ 'cv-generate': 'a' })
    await revertPrompt('cv-job-analysis')
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

describe('resetAllPrompts', () => {
  it('clears every override', async () => {
    seedOverrides({ 'cv-generate': 'a', 'cv-job-analysis': 'b' })
    await resetAllPrompts()
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ customPrompts: Prisma.JsonNull }),
      }),
    )
  })
})
