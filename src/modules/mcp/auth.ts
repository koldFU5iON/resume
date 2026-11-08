import { createLocalJWKSet, jwtVerify, errors } from 'jose'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { verifyBearerHeader, type VerifiedToken } from '@/modules/api-tokens/service'
import { getMcpUrls, MCP_SCOPES } from './oauth-config'

export async function authenticateMcp(header: string | null): Promise<VerifiedToken | null> {
  const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return null
  if (token.startsWith('rsm_')) return verifyBearerHeader(header)

  // Only signed resource-bound access tokens are accepted, never ID tokens,
  // refresh tokens, or opaque tokens issued without an MCP resource.
  const { issuer, resource } = getMcpUrls()
  let payload
  try {
    const keys = await auth.api.getJwks()
    const verified = await jwtVerify(token, createLocalJWKSet(keys), {
      issuer,
      audience: resource,
      requiredClaims: ['sub', 'exp', 'iat', 'azp', 'mcp_issued_at_ms'],
      algorithms: ['EdDSA'],
    })
    payload = verified.payload
  } catch (error) {
    if (error instanceof errors.JOSEError) return null
    throw error
  }
  if (typeof payload.sub !== 'string' || typeof payload.azp !== 'string' || typeof payload.scope !== 'string' || typeof payload.mcp_issued_at_ms !== 'number') return null
  const clientId = payload.azp
  const grantedScopes = payload.scope.split(' ')
  const scopes = MCP_SCOPES.filter(scope => grantedScopes.includes(scope))

  const [client, consent, profile] = await Promise.all([
    prisma.oauthClient.findUnique({ where: { clientId }, select: { disabled: true } }),
    prisma.oauthConsent.findFirst({
      where: { clientId, userId: payload.sub },
      select: { scopes: true, createdAt: true },
    }),
    prisma.profile.findUnique({ where: { userId: payload.sub }, select: { id: true } }),
  ])
  // Consent is checked on every request, so disconnecting also revokes JWTs.
  // A later new consent must not resurrect a token from a previous connection.
  if (!client || client.disabled || !consent || !profile ||
    payload.mcp_issued_at_ms < consent.createdAt.getTime() ||
    !scopes.every(scope => consent.scopes.includes(scope))) return null

  return { profileId: profile.id, tokenId: `oauth:${clientId}`, scopes }
}
