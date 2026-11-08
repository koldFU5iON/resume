import { getCurrentAuthContext } from '@better-auth/core/context'
import { APIError } from 'better-auth/api'
import { prisma } from '@/lib/db'

export async function getMcpGrantClaims({ user, scopes }: { user?: { id: string } | null; scopes: readonly string[] }) {
  const ctx = await getCurrentAuthContext()
  const authorization = ctx.request?.headers.get('authorization') ?? ctx.headers?.get('authorization')
  // The provider gives Basic credentials precedence over body credentials.
  const clientId = authorization?.startsWith('Basic ')
    ? Buffer.from(authorization.slice(6), 'base64').toString('utf8').split(':')[0]
    : ctx.body?.client_id
  if (!user || typeof clientId !== 'string') throw new APIError('FORBIDDEN', { message: 'User consent is required' })
  const consent = await prisma.oauthConsent.findUnique({
    where: { clientId_userId: { clientId, userId: user.id } },
    select: { id: true, scopes: true },
  })
  if (!consent || !scopes.every(scope => consent.scopes.includes(scope))) {
    throw new APIError('FORBIDDEN', { message: 'User consent is required' })
  }
  return { mcp_consent_id: consent.id }
}
