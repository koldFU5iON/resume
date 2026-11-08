import { prisma } from '@/lib/db'

export async function listMcpConnections(userId: string) {
  const consents = await prisma.oauthConsent.findMany({
    where: { userId },
    select: {
      clientId: true,
      scopes: true,
      createdAt: true,
      client: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return consents.map(({ client, ...consent }) => ({ ...consent, name: client.name || 'External app' }))
}

export type McpConnection = Awaited<ReturnType<typeof listMcpConnections>>[number]

export async function revokeMcpConnection(userId: string, clientId: string) {
  // Never disable/delete the global client: other users may have connected it.
  await prisma.$transaction(async tx => {
    await tx.oauthConsent.deleteMany({ where: { userId, clientId } })
    await tx.oauthAccessToken.deleteMany({ where: { userId, clientId } })
    await tx.oauthRefreshToken.deleteMany({ where: { userId, clientId } })
  })
}
