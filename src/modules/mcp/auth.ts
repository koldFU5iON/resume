import { jwtVerify, errors } from 'jose'
import { prisma } from '@/lib/db'
import { verifyBearerHeader, type VerifiedToken } from '@/modules/api-tokens/service'
import { getMcpUrls, MCP_SCOPES } from './oauth-config'
import { getMcpKeySet } from './keys'

export async function authenticateMcp(header: string | null): Promise<VerifiedToken | null> {
  const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return null
  if (token.startsWith('rsm_')) return verifyBearerHeader(header)

  // Only signed resource-bound access tokens are accepted, never ID tokens,
  // refresh tokens, or opaque tokens issued without an MCP resource.
  const { issuer, resource } = getMcpUrls()
  let payload
  try {
    const options = {
      issuer,
      audience: resource,
      requiredClaims: ['sub', 'exp', 'iat', 'azp', 'mcp_consent_id'],
      algorithms: ['EdDSA'],
    }
    try {
      payload = (await jwtVerify(token, await getMcpKeySet(), options)).payload
    } catch (error) {
      if (!(error instanceof errors.JWKSNoMatchingKey)) throw error
      payload = (await jwtVerify(token, await getMcpKeySet(true), options)).payload
    }
  } catch (error) {
    if (error instanceof errors.JOSEError) return null
    throw error
  }
  if (typeof payload.sub !== 'string' || typeof payload.azp !== 'string' || typeof payload.scope !== 'string' || typeof payload.mcp_consent_id !== 'string') return null
  const clientId = payload.azp
  const grantedScopes = payload.scope.split(' ')
  const scopes = MCP_SCOPES.filter(scope => grantedScopes.includes(scope))

  const consent = await prisma.oauthConsent.findUnique({
    where: { clientId_userId: { clientId, userId: payload.sub } },
    select: {
      id: true,
      scopes: true,
      client: { select: { disabled: true } },
      user: { select: { profile: { select: { id: true } } } },
    },
  })
  // Consent is checked on every request, so disconnecting also revokes JWTs.
  // A later new consent must not resurrect a token from a previous connection.
  const profile = consent?.user?.profile
  if (!consent || consent.client.disabled || !profile ||
    payload.mcp_consent_id !== consent.id ||
    !scopes.every(scope => consent.scopes.includes(scope))) return null

  return { profileId: profile.id, tokenId: `oauth:${clientId}`, scopes }
}
