import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('@better-auth/core/context', () => ({ getCurrentAuthContext: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: { oauthConsent: { findUnique: vi.fn() } } }))
import { getCurrentAuthContext } from '@better-auth/core/context'
import { prisma } from '@/lib/db'
import { getMcpGrantClaims } from './oauth-grants'

const grant = { user: { id: 'owner' }, scopes: ['mcp:read'] }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCurrentAuthContext).mockResolvedValue({ body: { client_id: 'client' } } as never)
  vi.mocked(prisma.oauthConsent.findUnique).mockResolvedValue({ id: 'consent', scopes: ['mcp:read'] } as never)
})
it('binds tokens to the current consent record', async () => {
  expect(await getMcpGrantClaims(grant)).toEqual({ mcp_consent_id: 'consent' })
  expect(prisma.oauthConsent.findUnique).toHaveBeenCalledWith(expect.objectContaining({
    where: { clientId_userId: { clientId: 'client', userId: 'owner' } },
  }))
})
it('uses Basic client credentials before body credentials', async () => {
  vi.mocked(getCurrentAuthContext).mockResolvedValue({
    body: { client_id: 'untrusted' }, headers: new Headers({ authorization: `Basic ${Buffer.from('client:secret').toString('base64')}` }),
  } as never)
  await getMcpGrantClaims(grant)
  expect(prisma.oauthConsent.findUnique).toHaveBeenCalledWith(expect.objectContaining({
    where: { clientId_userId: { clientId: 'client', userId: 'owner' } },
  }))
})
it('rejects a removed consent', async () => {
  vi.mocked(prisma.oauthConsent.findUnique).mockResolvedValue(null)
  await expect(getMcpGrantClaims(grant)).rejects.toThrow()
})
it('refuses scopes absent from consent', async () => {
  await expect(getMcpGrantClaims({ ...grant, scopes: ['mcp:write'] })).rejects.toThrow()
})
it('requires a user and client', async () => {
  await expect(getMcpGrantClaims({ scopes: [] })).rejects.toThrow()
  vi.mocked(getCurrentAuthContext).mockResolvedValue({ body: {} } as never)
  await expect(getMcpGrantClaims(grant)).rejects.toThrow()
  expect(prisma.oauthConsent.findUnique).not.toHaveBeenCalled()
})
