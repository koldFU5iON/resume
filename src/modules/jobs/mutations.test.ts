import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  requireProfile: vi.fn().mockResolvedValue({ profile: { id: 'p1' } }),
}))
vi.mock('@/lib/db', () => ({
  prisma: { jobApplication: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() } },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('./queries', () => ({ getArchivedJobs: vi.fn() }))
vi.mock('@/modules/job-assessment/queue', () => ({ queueJobAssessmentSafely: vi.fn() }))

import { prisma } from '@/lib/db'
import { queueJobAssessmentSafely } from '@/modules/job-assessment/queue'
import { createJobApplication, updateJobApplication, updateJobSalaryBand } from './mutations'

const mockCreate = vi.mocked(prisma.jobApplication.create)
const mockFind = vi.mocked(prisma.jobApplication.findFirst)
const mockUpdate = vi.mocked(prisma.jobApplication.updateMany)
const mockQueue = vi.mocked(queueJobAssessmentSafely)

const current = {
  title: 'PM',
  company: 'Acme',
  jobDescription: 'JD',
  countries: ['London', 'UK'],
  salaryBand: '£80k',
  jobFit: null,
  jobAnalysis: null,
}

// What the edit dialog sends: every field, changed or not.
const unchanged = {
  title: 'PM',
  company: 'Acme',
  jobDescription: 'JD',
  location: 'London, UK',
  salaryBand: '£80k',
  applicationSource: 'cold' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFind.mockResolvedValue(current as never)
  mockUpdate.mockResolvedValue({ count: 1 })
})

describe('createJobApplication', () => {
  it('queues an assessment for the new job and returns it unchanged', async () => {
    const job = { id: 'job-1', title: 'PM' }
    mockCreate.mockResolvedValueOnce(job as never)
    const res = await createJobApplication({ title: 'PM', applicationSource: 'cold' })
    expect(res).toBe(job)
    expect(mockQueue).toHaveBeenCalledWith('p1', 'job-1', { reason: 'created' })
  })
})

describe('updateJobApplication', () => {
  it('does not queue when nothing the assessment reads changed', async () => {
    const res = await updateJobApplication('job-1', { ...unchanged, isRecruitmentAgency: true })
    expect(res).toEqual({ staleFitData: false })
    expect(mockQueue).not.toHaveBeenCalled()
  })

  it.each([
    ['title', { title: 'Senior PM' }],
    ['company', { company: 'Other' }],
    ['jobDescription', { jobDescription: 'New JD' }],
    ['location', { location: 'Paris' }],
    ['salaryBand', { salaryBand: '£90k' }],
  ])('queues when %s changed', async (_field, change) => {
    await updateJobApplication('job-1', { ...unchanged, ...change })
    expect(mockQueue).toHaveBeenCalledWith('p1', 'job-1', { reason: 'edited' })
  })

  it('does not read or queue when only other fields are sent', async () => {
    await updateJobApplication('job-1', { notes: undefined, isRecruitmentAgency: false } as never)
    expect(mockFind).not.toHaveBeenCalled()
    expect(mockQueue).not.toHaveBeenCalled()
  })

  it('does not queue when the job is not found', async () => {
    mockUpdate.mockResolvedValueOnce({ count: 0 })
    await expect(updateJobApplication('job-1', { title: 'X' })).rejects.toThrow('Job not found')
    expect(mockQueue).not.toHaveBeenCalled()
  })

  it('keeps the stale fit-data flag', async () => {
    mockFind.mockResolvedValueOnce({ ...current, jobFit: { rating: 5 } } as never)
    expect(await updateJobApplication('job-1', { jobDescription: 'New JD' })).toEqual({ staleFitData: true })
  })
})

describe('updateJobSalaryBand', () => {
  it('queues when the band changed', async () => {
    await updateJobSalaryBand('job-1', '£95k')
    expect(mockQueue).toHaveBeenCalledWith('p1', 'job-1', { reason: 'salary' })
  })

  it('does not queue when the band is the same', async () => {
    await updateJobSalaryBand('job-1', '£80k')
    expect(mockQueue).not.toHaveBeenCalled()
  })
})
