import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: { jobApplication: { create: vi.fn() } } }))
vi.mock('./extract', () => ({ extractJobFromUrl: vi.fn() }))
vi.mock('./dedup-internal', () => ({ findPotentialDuplicatesForProfile: vi.fn() }))
vi.mock('@/modules/job-assessment/queue', () => ({ queueJobAssessmentSafely: vi.fn() }))

import { prisma } from '@/lib/db'
import { queueJobAssessmentSafely } from '@/modules/job-assessment/queue'
import { captureJobFromUrl } from './capture'
import { findPotentialDuplicatesForProfile } from './dedup-internal'
import { extractJobFromUrl } from './extract'

const mockCreate = vi.mocked(prisma.jobApplication.create)
const mockExtract = vi.mocked(extractJobFromUrl)
const mockDupes = vi.mocked(findPotentialDuplicatesForProfile)
const mockQueue = vi.mocked(queueJobAssessmentSafely)

const url = 'https://jobs.example.com/1'
const dupe = { id: 'job-old', title: 'PM', company: 'Acme', status: 'applied', archivedAt: null } as never

beforeEach(() => {
  vi.clearAllMocks()
  mockExtract.mockResolvedValue({ ok: true, data: { title: 'PM', company: 'Acme', jobDescription: 'JD' } })
  mockDupes.mockResolvedValue([])
  mockCreate.mockResolvedValue({ id: 'job-new', title: 'PM', company: 'Acme' } as never)
})

describe('captureJobFromUrl → early assessment', () => {
  it('queues an assessment for a newly created job', async () => {
    const r = await captureJobFromUrl('p1', { url })
    expect(r).toMatchObject({ ok: true, created: true, job: { id: 'job-new' } })
    expect(mockQueue).toHaveBeenCalledWith('p1', 'job-new', { reason: 'capture' })
  })

  it('does not queue when an existing job is returned', async () => {
    mockDupes.mockResolvedValueOnce([dupe])
    const r = await captureJobFromUrl('p1', { url })
    expect(r).toMatchObject({ ok: true, created: false, job: { id: 'job-old' } })
    expect(mockQueue).not.toHaveBeenCalled()
  })

  it('queues when a duplicate is created anyway', async () => {
    mockDupes.mockResolvedValueOnce([dupe])
    await captureJobFromUrl('p1', { url, dedupeStrategy: 'create_anyway' })
    expect(mockQueue).toHaveBeenCalledWith('p1', 'job-new', { reason: 'capture' })
  })

  it('does not queue when extraction fails', async () => {
    mockExtract.mockResolvedValueOnce({ ok: false, error: 'blocked' })
    expect(await captureJobFromUrl('p1', { url })).toMatchObject({ ok: false, status: 422 })
    expect(mockQueue).not.toHaveBeenCalled()
  })
})
