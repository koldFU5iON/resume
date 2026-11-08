import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'

vi.mock('./keys', () => ({ getMcpKeySet: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: {
  oauthConsent: { findUnique: vi.fn() },
} }))
vi.mock('@/modules/api-tokens/service', () => ({ verifyBearerHeader: vi.fn() }))

import { getMcpKeySet } from './keys'
import { prisma } from '@/lib/db'
import { verifyBearerHeader } from '@/modules/api-tokens/service'
import { authenticateMcp } from './auth'

let key: CryptoKey
let jwk: Awaited<ReturnType<typeof exportJWK>>
const origin = 'https://resume.example'
const now = Math.floor(Date.now() / 1000)

function consent(overrides: Record<string, unknown> = {}) {
  return { id: 'consent-1', scopes: ['mcp:read', 'mcp:write', 'offline_access'],
    client: { disabled: false }, user: { profile: { id: 'profile-owner' } }, ...overrides }
}

beforeAll(async () => {
  const pair = await generateKeyPair('EdDSA')
  key = pair.privateKey
  jwk = { ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'EdDSA' }
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('BETTER_AUTH_URL', origin)
  vi.mocked(getMcpKeySet).mockResolvedValue(createLocalJWKSet({ keys: [jwk] }))
  vi.mocked(prisma.oauthConsent.findUnique).mockResolvedValue(consent() as never)
})

async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ sub: 'user-owner', azp: 'client-1', scope: 'mcp:read mcp:write',
    iss: `${origin}/api/auth`, aud: `${origin}/api/mcp`, iat: now, exp: now + 3600, mcp_consent_id: 'consent-1', ...overrides })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' }).sign(key)
}

describe('authenticateMcp', () => {
  it('keeps static API tokens on their existing verification path', async () => {
    const verified = { profileId: 'p', tokenId: 't', scopes: ['mcp:read'] as const }
    vi.mocked(verifyBearerHeader).mockResolvedValue(verified as never)
    expect(await authenticateMcp('Bearer rsm_token')).toBe(verified)
    expect(getMcpKeySet).not.toHaveBeenCalled()
  })

  it('resolves ownership from the signed subject and records the OAuth client as actor', async () => {
    expect(await authenticateMcp(`Bearer ${await token()}`)).toEqual({
      profileId: 'profile-owner', tokenId: 'oauth:client-1', scopes: ['mcp:read', 'mcp:write'],
    })
    expect(prisma.oauthConsent.findUnique).toHaveBeenCalledTimes(1)
    expect(prisma.oauthConsent.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId_userId: { clientId: 'client-1', userId: 'user-owner' } } }))
  })

  it('authenticates an offline-only grant without granting any MCP scope', async () => {
    expect((await authenticateMcp(`Bearer ${await token({ scope: 'offline_access' })}`))?.scopes).toEqual([])
  })

  it('preserves read-only scopes', async () => {
    expect((await authenticateMcp(`Bearer ${await token({ scope: 'mcp:read offline_access' })}`))?.scopes).toEqual(['mcp:read'])
  })

  it.each([
    ['wrong issuer', { iss: 'https://attacker.invalid' }],
    ['wrong resource', { aud: 'https://other.invalid/api/mcp' }],
    ['expired token', { exp: now - 1 }],
    ['future token', { nbf: now + 100 }],
    ['missing subject', { sub: undefined }],
    ['missing expiry', { exp: undefined }],
    ['missing client', { azp: undefined }],
  ])('rejects %s before loading user data', async (_, claims) => {
    expect(await authenticateMcp(`Bearer ${await token(claims)}`)).toBeNull()
    expect(prisma.oauthConsent.findUnique).not.toHaveBeenCalled()
  })

  it.each([null, '', 'Basic abc', 'Bearer opaque', 'Bearer a.b.c'])('rejects malformed input %s', async header => {
    expect(await authenticateMcp(header)).toBeNull()
  })

  it('rejects a forged signature', async () => {
    const otherKey = (await generateKeyPair('EdDSA')).privateKey
    const forged = await new SignJWT({}).setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' }).sign(otherKey)
    expect(await authenticateMcp(`Bearer ${forged}`)).toBeNull()
  })

  it('reloads signing keys once when a rotated key is not cached', async () => {
    const pair = await generateKeyPair('EdDSA')
    const rotated = { ...await exportJWK(pair.publicKey), kid: 'rotated', alg: 'EdDSA' }
    vi.mocked(getMcpKeySet).mockResolvedValueOnce(createLocalJWKSet({ keys: [jwk] }))
      .mockResolvedValueOnce(createLocalJWKSet({ keys: [rotated] }))
    const signed = await new SignJWT({ sub: 'user-owner', azp: 'client-1', scope: 'mcp:read',
      iss: `${origin}/api/auth`, aud: `${origin}/api/mcp`, iat: now, exp: now + 3600, mcp_consent_id: 'consent-1' })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'rotated' }).sign(pair.privateKey)
    expect((await authenticateMcp(`Bearer ${signed}`))?.profileId).toBe('profile-owner')
    expect(getMcpKeySet).toHaveBeenNthCalledWith(2, true)
  })

  it('rejects disabled clients', async () => {
    vi.mocked(prisma.oauthConsent.findUnique).mockResolvedValue(consent({ client: { disabled: true } }) as never)
    expect(await authenticateMcp(`Bearer ${await token()}`)).toBeNull()
  })

  it('rejects disconnected apps, including JWTs that have not expired', async () => {
    vi.mocked(prisma.oauthConsent.findUnique).mockResolvedValue(null)
    expect(await authenticateMcp(`Bearer ${await token()}`)).toBeNull()
  })

  it('rejects scopes that were removed from consent', async () => {
    vi.mocked(prisma.oauthConsent.findUnique).mockResolvedValue(consent({ scopes: ['mcp:read'] }) as never)
    expect(await authenticateMcp(`Bearer ${await token()}`)).toBeNull()
  })

  it('does not resurrect an old token when the client is connected again', async () => {
    vi.mocked(prisma.oauthConsent.findUnique).mockResolvedValue(consent({ id: 'reconnected-consent' }) as never)
    expect(await authenticateMcp(`Bearer ${await token()}`)).toBeNull()
  })
})
