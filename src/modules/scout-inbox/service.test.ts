import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    scoutInvite: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    discoveredJob: { findFirst: vi.fn(), create: vi.fn() },
  },
}))
vi.mock('@/modules/jobs/capture', () => ({ prepareJobCapture: vi.fn() }))

import { prisma } from '@/lib/db'
import { prepareJobCapture } from '@/modules/jobs/capture'
import { createScoutInvite, submitScoutJob, verifyScoutInvite } from './service'

const mockInviteCreate = vi.mocked(prisma.scoutInvite.create)
const mockInviteFind = vi.mocked(prisma.scoutInvite.findUnique)
const mockScoutFind = vi.mocked(prisma.discoveredJob.findFirst)
const mockScoutCreate = vi.mocked(prisma.discoveredJob.create)
const mockPrepare = vi.mocked(prepareJobCapture)

describe('Scout Inbox service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stores only a hashed Scout invite token and returns the raw token once', async () => {
    mockInviteCreate.mockResolvedValue({ id: 'invite-1', name: 'Mum', prefix: 'rsc_example' } as never)

    const result = await createScoutInvite('profile-1', 'Mum')

    expect(result.token).toMatch(/^rsc_/)
    expect(mockInviteCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ profileId: 'profile-1', name: 'Mum', hashedToken: expect.any(String) }),
    }))
    expect(vi.mocked(prisma.scoutInvite.create).mock.calls[0][0].data.hashedToken).not.toBe(result.token)
  })

  it('rejects revoked Scout invites', async () => {
    mockInviteFind.mockResolvedValue({ id: 'invite-1', profileId: 'profile-1', name: 'Mum', expiresAt: null, revokedAt: new Date() } as never)

    await expect(verifyScoutInvite('rsc_example')).resolves.toBeNull()
  })

  it('creates a Scout DiscoveredJob rather than a JobApplication', async () => {
    mockPrepare.mockResolvedValue({
      ok: true,
      data: {
        url: 'https://example.com/job', title: 'Engineer', company: 'Acme', jobNumber: null,
        jobDescription: 'Build things', countries: ['Remote'], datePublished: null, salaryBand: null,
        duplicate: null, fieldsExtracted: ['title'],
      },
    })
    mockScoutFind.mockResolvedValue(null)
    mockScoutCreate.mockResolvedValue({ id: 'submission-1' } as never)

    const result = await submitScoutJob('invite-1', 'profile-1', { url: 'https://example.com/job' })

    expect(result).toMatchObject({ ok: true, created: true, submissionId: 'submission-1' })
    expect(mockScoutCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ source: 'SCOUT', scoutInviteId: 'invite-1', profileId: 'profile-1' }),
    }))
  })

  it('returns an existing application duplicate without creating a Scout role', async () => {
    mockPrepare.mockResolvedValue({
      ok: true,
      data: {
        url: 'https://example.com/job', title: 'Engineer', company: 'Acme', jobNumber: null,
        jobDescription: 'Build things', countries: [], datePublished: null, salaryBand: null,
        duplicate: { id: 'application-1', title: 'Engineer', company: 'Acme', jobNumber: null, status: 'not started', archivedAt: null },
        fieldsExtracted: ['title'],
      },
    })

    const result = await submitScoutJob('invite-1', 'profile-1', { url: 'https://example.com/job' })

    expect(result).toMatchObject({ ok: true, created: false, duplicate: true })
    expect(mockScoutCreate).not.toHaveBeenCalled()
  })
})
