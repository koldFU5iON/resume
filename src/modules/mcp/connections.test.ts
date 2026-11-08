import { describe, expect, it, vi } from 'vitest'
const { tx } = vi.hoisted(() => ({ tx: {
  oauthConsent: { deleteMany: vi.fn() },
  oauthAccessToken: { deleteMany: vi.fn() },
  oauthRefreshToken: { deleteMany: vi.fn() },
} }))
vi.mock('@/lib/db', () => ({ prisma: { $transaction: (fn: (value: typeof tx) => unknown) => fn(tx) } }))
import { revokeMcpConnection } from './connections'

describe('disconnecting', () => {
  it('removes only this user’s consent and tokens, preserving the shared client', async () => {
    await revokeMcpConnection('user-owner', 'client-1')
    for (const model of Object.values(tx)) expect(model.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-owner', clientId: 'client-1' } })
  })
})
