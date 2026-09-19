import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import { prepareJobCapture } from '@/modules/jobs/capture'

const TOKEN_NAMESPACE = 'rsc_'
const COOKIE_NAME = 'scout_invite'

export const SCOUT_COOKIE_NAME = COOKIE_NAME

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export async function createScoutInvite(profileId: string, name: string) {
  const token = TOKEN_NAMESPACE + randomBytes(32).toString('base64url')
  const invite = await prisma.scoutInvite.create({
    data: {
      profileId,
      name: name.trim() || 'Scout invite',
      hashedToken: hashToken(token),
      prefix: token.slice(0, 12),
    },
    select: { id: true, name: true, prefix: true },
  })
  return { ...invite, token }
}

export async function verifyScoutInvite(rawToken: string | undefined) {
  if (!rawToken?.startsWith(TOKEN_NAMESPACE)) return null
  const invite = await prisma.scoutInvite.findUnique({
    where: { hashedToken: hashToken(rawToken) },
    select: { id: true, profileId: true, name: true, expiresAt: true, revokedAt: true },
  })
  if (!invite || invite.revokedAt || (invite.expiresAt && invite.expiresAt <= new Date())) return null

  void prisma.scoutInvite.update({ where: { id: invite.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  return invite
}

export async function listScoutInvites(profileId: string) {
  return prisma.scoutInvite.findMany({
    where: { profileId },
    select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
  })
}

export async function revokeScoutInvite(profileId: string, inviteId: string) {
  const result = await prisma.scoutInvite.updateMany({
    where: { id: inviteId, profileId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  if (result.count === 0) throw new Error('Scout invite not found or already revoked')
}

export async function submitScoutJob(inviteId: string, profileId: string, input: { url: string; note?: string }) {
  const prepared = await prepareJobCapture(profileId, input.url)
  if (!prepared.ok) return prepared

  if (prepared.data.duplicate) {
    return { ok: true as const, created: false, duplicate: true as const, submissionId: null }
  }

  const existingScout = await prisma.discoveredJob.findFirst({
    where: { profileId, source: 'SCOUT', url: prepared.data.url },
    select: { id: true },
  })
  if (existingScout) {
    return { ok: true as const, created: false, duplicate: true as const, submissionId: existingScout.id }
  }

  const externalId = createHash('sha256').update(prepared.data.url).digest('hex')
  const job = await prisma.discoveredJob.create({
    data: {
      profileId,
      scoutInviteId: inviteId,
      source: 'SCOUT',
      externalId,
      title: prepared.data.title,
      company: prepared.data.company,
      location: prepared.data.countries.join(', ') || null,
      salary: prepared.data.salaryBand,
      url: prepared.data.url,
      postedAt: prepared.data.datePublished,
      description: prepared.data.jobDescription,
      scoutNote: input.note?.trim() || null,
      triageStatus: 'PENDING',
    },
    select: { id: true },
  })
  return { ok: true as const, created: true, duplicate: false as const, submissionId: job.id }
}

export async function getScoutSubmission(inviteId: string, submissionId: string) {
  return prisma.discoveredJob.findFirst({
    where: { id: submissionId, scoutInviteId: inviteId, source: 'SCOUT' },
    select: {
      id: true,
      title: true,
      company: true,
      triageStatus: true,
      scoutVerdict: true,
      scoutFeedback: true,
    },
  })
}
