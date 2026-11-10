import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  requireProfile: vi.fn().mockResolvedValue({ profile: { id: 'profile-1' } }),
}))
vi.mock('@/modules/jobs/extract', () => ({ extractJobFromUrl: vi.fn() }))
vi.mock('@/lib/db', () => ({
  prisma: { jobApplication: { findFirst: vi.fn(), create: vi.fn() } },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/modules/job-assessment/queue', () => ({ queueJobAssessmentSafely: vi.fn() }))

import { quickCaptureJob } from './quick-capture'
import { extractJobFromUrl } from '@/modules/jobs/extract'
import { prisma } from '@/lib/db'
import { queueJobAssessmentSafely } from '@/modules/job-assessment/queue'

const mockExtract = vi.mocked(extractJobFromUrl)
const mockFind   = vi.mocked(prisma.jobApplication.findFirst)
const mockCreate = vi.mocked(prisma.jobApplication.create)

describe('quickCaptureJob', () => {
  const url = 'https://example.com/jobs/123'

  beforeEach(() => {
    vi.clearAllMocks()
    mockFind.mockResolvedValue(null)
  })

  it('returns ok:false for empty url', async () => {
    const r = await quickCaptureJob('  ')
    expect(r).toEqual({ ok: false, error: 'URL is required' })
  })

  it('returns ok:false when extraction fails', async () => {
    mockExtract.mockResolvedValue({ ok: false, error: 'blocked' })
    const r = await quickCaptureJob(url)
    expect(r).toEqual({ ok: false, error: 'blocked' })
  })

  it('returns ok:false when title/company are missing', async () => {
    mockExtract.mockResolvedValue({ ok: true, data: { location: 'Remote' } })
    const r = await quickCaptureJob(url)
    expect(r.ok).toBe(false)
  })

  it('returns duplicate:true for existing URL without creating', async () => {
    mockFind.mockResolvedValue({ id: 'j-existing', title: 'Eng', company: 'Acme' } as never)
    const r = await quickCaptureJob(url)
    expect(r).toMatchObject({ ok: true, duplicate: true, jobId: 'j-existing' })
    expect(mockCreate).not.toHaveBeenCalled()
    expect(queueJobAssessmentSafely).not.toHaveBeenCalled()
  })

  it('creates a job and returns ok:true on success', async () => {
    mockExtract.mockResolvedValue({ ok: true, data: { title: 'Staff Eng', company: 'Stripe' } })
    mockCreate.mockResolvedValue({ id: 'j-new', title: 'Staff Eng', company: 'Stripe' } as never)
    const r = await quickCaptureJob(url)
    expect(r).toMatchObject({ ok: true, duplicate: false, jobId: 'j-new', title: 'Staff Eng' })
    expect(mockCreate).toHaveBeenCalledOnce()
    expect(queueJobAssessmentSafely).toHaveBeenCalledWith('profile-1', 'j-new', { reason: 'quick-capture', requestStartedAt: expect.any(Number) })
  })

  it('passes all optional extracted fields to prisma.create', async () => {
    const datePublished = new Date('2026-01-01')
    mockExtract.mockResolvedValue({
      ok: true,
      data: { title: 'PM', company: 'Acme', location: 'London, UK',
               jobNumber: 'REQ-1', salaryBand: '£80k–£100k', datePublished },
    })
    mockCreate.mockResolvedValue({ id: 'j', title: 'PM', company: 'Acme' } as never)
    await quickCaptureJob(url)
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        jobNumber: 'REQ-1',
        countries: ['London', 'UK'],
        salaryBand: '£80k–£100k',
        datePublished,
      }),
    }))
  })

  it('calls revalidatePath after creating', async () => {
    const { revalidatePath } = await import('next/cache')
    mockExtract.mockResolvedValue({ ok: true, data: { title: 'Dev', company: 'Co' } })
    mockCreate.mockResolvedValue({ id: 'j', title: 'Dev', company: 'Co' } as never)
    await quickCaptureJob(url)
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/job-applications')
  })
})
