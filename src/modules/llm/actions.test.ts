import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/session', () => ({
  requireProfile: vi.fn().mockResolvedValue({ profile: { id: 'profile-1' } }),
}))
vi.mock('@/lib/db', () => ({
  prisma: { userSettings: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() } },
}))
vi.mock('@/lib/encryption', () => ({ decrypt: vi.fn(), encrypt: vi.fn() }))
vi.mock('./client', () => ({ SUPPORTED_PROVIDERS: ['anthropic', 'openai', 'google'] }))
vi.mock('./models', () => ({ fetchProviderModels: vi.fn() }))

import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/encryption'
import { refreshModels } from './actions'
import { fetchProviderModels } from './models'

const mockFindUnique = vi.mocked(prisma.userSettings.findUnique)
const mockUpdate = vi.mocked(prisma.userSettings.update)
const mockDecrypt = vi.mocked(decrypt)
const mockFetchProviderModels = vi.mocked(fetchProviderModels)

describe('refreshModels', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fetches with the stored key and replaces the cached model list', async () => {
    mockFindUnique.mockResolvedValue({ llmProvider: 'openai', llmApiKey: 'encrypted-key' } as never)
    mockDecrypt.mockReturnValue('sk-test')
    const models = [{ id: 'gpt-5', name: 'gpt-5' }]
    mockFetchProviderModels.mockResolvedValue(models)

    await expect(refreshModels()).resolves.toEqual(models)

    expect(mockFetchProviderModels).toHaveBeenCalledWith('openai', 'sk-test')
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { profileId: 'profile-1' },
      data: {
        availableModels: models,
        availableModelsUpdatedAt: expect.any(Date),
      },
    })
  })

  it('requires a stored API key', async () => {
    mockFindUnique.mockResolvedValue({ llmProvider: 'openai', llmApiKey: null } as never)

    await expect(refreshModels()).rejects.toThrow('No API key configured.')
    expect(mockFetchProviderModels).not.toHaveBeenCalled()
  })
})
