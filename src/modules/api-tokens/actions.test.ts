import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ requireProfile: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('./service', async importOriginal => ({
  ...await importOriginal<typeof import('./service')>(),
  createApiToken: vi.fn(),
}))

import { requireProfile } from '@/lib/session'
import { createApiToken } from './service'
import { createApiTokenAction } from './actions'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireProfile).mockResolvedValue({ profile: { id: 'owner' } } as never)
})

describe('createApiTokenAction validation', () => {
  it('passes the parsed name and supports a custom positive expiry', async () => {
    const before = Date.now()
    await createApiTokenAction('  My agent  ', ['mcp:read'], 7)
    const [owner, name, options] = vi.mocked(createApiToken).mock.calls[0]
    expect(owner).toBe('owner')
    expect(name).toBe('My agent')
    expect(options?.scopes).toEqual(['mcp:read'])
    expect(options?.expiresAt?.getTime()).toBeGreaterThanOrEqual(before + 7 * 86400000)
    expect(options?.expiresAt?.getTime()).toBeLessThanOrEqual(Date.now() + 7 * 86400000)
  })

  it('preserves no-expiry tokens', async () => {
    await createApiTokenAction('Agent')
    expect(createApiToken).toHaveBeenCalledWith('owner', 'Agent', { scopes: undefined, expiresAt: null })
  })

  it.each([
    ['  ', ['mcp:read'], 30],
    ['Agent', ['admin'], 30],
    ['Agent', [], 30],
    ['Agent', ['mcp:read'], -1],
    ['Agent', ['mcp:read'], Infinity],
    ['Agent', ['mcp:read'], 1.5],
  ])('rejects invalid input before issuing a token (%s)', async (name, scopes, days) => {
    await expect(createApiTokenAction(name as string, scopes as never, days as number)).rejects.toThrow()
    expect(createApiToken).not.toHaveBeenCalled()
  })
})
