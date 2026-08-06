import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    userSettings: { findUnique: vi.fn() },
  },
}))

import {
  loadPromptOverrides,
  loadPromptText,
  loadAllDefaultPrompts,
} from './loader'
import { PROMPT_REGISTRY } from './registry'
import { prisma } from '@/lib/db'

const mockFindUnique = vi.mocked(prisma.userSettings.findUnique)

describe('loadPromptOverrides', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty map when no settings row exists', async () => {
    mockFindUnique.mockResolvedValue(null)
    await expect(loadPromptOverrides('p1')).resolves.toEqual({})
  })

  it('returns stored customPrompts', async () => {
    mockFindUnique.mockResolvedValue({ customPrompts: { 'cv-generate': 'custom' } } as never)
    await expect(loadPromptOverrides('p1')).resolves.toEqual({ 'cv-generate': 'custom' })
  })
})

describe('loadPromptText', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the saved override when present', async () => {
    mockFindUnique.mockResolvedValue({ customPrompts: { 'cv-generate': 'MY PROMPT' } } as never)
    await expect(loadPromptText('p1', 'cv-generate')).resolves.toBe('MY PROMPT')
  })

  it('falls back to the bundled default when no override exists', async () => {
    mockFindUnique.mockResolvedValue({ customPrompts: {} } as never)
    const text = await loadPromptText('p1', 'cv-generate')
    expect(text).toContain('# CV Generation')
  })

  it('uses a provided override map without touching the DB', async () => {
    const text = await loadPromptText('p1', 'cv-generate', { 'cv-generate': 'INLINE' })
    expect(text).toBe('INLINE')
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('throws for an unknown key', async () => {
    mockFindUnique.mockResolvedValue({ customPrompts: {} } as never)
    await expect(loadPromptText('p1', 'nope')).rejects.toThrow('Unknown prompt key')
  })
})

describe('loadAllDefaultPrompts', () => {
  it('returns an entry for every registry key', async () => {
    const all = await loadAllDefaultPrompts()
    expect(Object.keys(all).length).toBe(PROMPT_REGISTRY.length)
    for (const def of PROMPT_REGISTRY) {
      expect(all[def.key], def.key).toBeTruthy()
    }
  })
})
