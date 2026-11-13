import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/session', () => ({
  requireProfile: vi.fn().mockResolvedValue({ profile: { id: 'p1' } }),
}))
vi.mock('@/lib/db', () => ({
  prisma: { jobApplication: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() } },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('./queries', () => ({ getArchivedJobs: vi.fn() }))
vi.mock('@/modules/cv/acceptance', () => ({ acceptLatestCVForAppliedJob: vi.fn() }))
vi.mock('@/modules/companies/match', () => ({ linkJobCompany: vi.fn() }))
vi.mock('@/modules/job-assessment/queue', () => ({
  queueJobAssessmentSafely: vi.fn(),
  assessmentMaybeEnabled: vi.fn(() => true),
}))

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { assessmentMaybeEnabled, queueJobAssessmentSafely } from '@/modules/job-assessment/queue'
import { acceptLatestCVForAppliedJob } from '@/modules/cv/acceptance'
import { linkJobCompany } from '@/modules/companies/match'
import { createJobApplication, updateJobApplication, updateJobSalaryBand, updateJobStatus, bulkRestoreJobApplications } from './mutations'

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

describe('bulkRestoreJobApplications', () => {
  it('restores only archived jobs belonging to the signed-in profile', async () => {
    expect(await bulkRestoreJobApplications(['job-1', 'job-2'])).toEqual({ restored: 1 })
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: { in: ['job-1', 'job-2'] }, profileId: 'p1', archivedAt: { not: null } },
      data: { archivedAt: null },
    })
  })

  it('does not query the database for an empty undo', async () => {
    expect(await bulkRestoreJobApplications([])).toEqual({ restored: 0 })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('propagates a database failure so the UI can offer recovery', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(bulkRestoreJobApplications(['job-1'])).rejects.toThrow('database unavailable')
  })
})

describe('createJobApplication', () => {
  it('queues an assessment for the new job and returns it unchanged', async () => {
    const job = { id: 'job-1', title: 'PM' }
    mockCreate.mockResolvedValueOnce(job as never)
    const res = await createJobApplication({ title: 'PM', company: 'Acme', applicationSource: 'cold' })
    expect(res).toBe(job)
    expect(linkJobCompany).toHaveBeenCalledWith('p1', 'job-1')
    expect(mockQueue).toHaveBeenCalledWith('p1', 'job-1', { reason: 'created' })
  })

  it('rejects invalid input before any write', async () => {
    await expect(createJobApplication({ title: '  ', company: 'Acme', applicationSource: 'cold' })).rejects.toThrow()
    await expect(createJobApplication({ title: 'PM', applicationSource: 'cold' })).rejects.toThrow() // no company
    await expect(createJobApplication({ title: 'PM', company: 'A', url: 'javascript:alert(1)', applicationSource: 'cold' })).rejects.toThrow()
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockQueue).not.toHaveBeenCalled()
  })

  it('writes only known columns, trimmed, with null for blanks', async () => {
    mockCreate.mockResolvedValueOnce({ id: 'job-1' } as never)
    await createJobApplication({
      title: ' PM ', company: ' Acme ', url: '', location: ' London , UK ', jobNumber: ' ',
      salaryBand: '', jobDescription: '  ', recruiterName: 'Hays', applicationSource: 'cold',
      profileId: 'someone-else', status: 'accepted',
    } as never)
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        title: 'PM', company: 'Acme', url: null, jobNumber: null, salaryBand: null,
        jobDescription: null, datePublished: null, applicationSource: 'cold',
        isRecruitmentAgency: false, recruiterName: null,
        countries: ['London', 'UK'], profileId: 'p1',
      },
    })
  })

  it('keeps the recruiter for agency jobs without a company', async () => {
    mockCreate.mockResolvedValueOnce({ id: 'job-1' } as never)
    const date = new Date('2026-01-02')
    await createJobApplication({
      title: 'PM', isRecruitmentAgency: true, recruiterName: ' Hays ', datePublished: date,
      url: 'https://x.com/j', applicationSource: 'recruiter_outreach',
    })
    expect(mockCreate.mock.calls[0][0].data).toMatchObject({
      company: null, recruiterName: 'Hays', isRecruitmentAgency: true, datePublished: date, url: 'https://x.com/j',
    })
  })

  it('revalidates the list after queueing', async () => {
    mockCreate.mockResolvedValueOnce({ id: 'job-1' } as never)
    await createJobApplication({ title: 'PM', company: 'Acme', applicationSource: 'cold' })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/job-applications')
  })

  it('does not queue or revalidate when the write fails', async () => {
    mockCreate.mockRejectedValueOnce(new Error('db down'))
    await expect(createJobApplication({ title: 'PM', company: 'Acme', applicationSource: 'cold' })).rejects.toThrow('db down')
    expect(mockQueue).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
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

describe('request-path cost when the assessment is off', () => {
  beforeEach(() => vi.mocked(assessmentMaybeEnabled).mockReturnValue(false))
  afterEach(() => vi.mocked(assessmentMaybeEnabled).mockReturnValue(true))

  it('updateJobApplication skips the extra read when only trigger fields changed', async () => {
    await updateJobApplication('job-1', { title: 'Senior PM', location: 'Paris' })
    expect(mockFind).not.toHaveBeenCalled()
    expect(mockQueue).not.toHaveBeenCalled()
  })

  it('updateJobApplication still reads for the stale fit-data check', async () => {
    mockFind.mockResolvedValueOnce({ ...current, jobFit: { rating: 5 } } as never)
    expect(await updateJobApplication('job-1', { jobDescription: 'New JD' })).toEqual({ staleFitData: true })
    expect(mockQueue).not.toHaveBeenCalled()
  })

  it('updateJobSalaryBand skips the read', async () => {
    await updateJobSalaryBand('job-1', '£95k')
    expect(mockFind).not.toHaveBeenCalled()
    expect(mockQueue).not.toHaveBeenCalled()
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

describe('updateJobStatus: accepting the CV used to apply', () => {
  const mockAccept = vi.mocked(acceptLatestCVForAppliedJob)
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdate.mockResolvedValue({ count: 1 })
  })

  it.each(['applied', 'interviewing'] as const)("accepts the job's latest CV on %s, scoped to the profile", async (status) => {
    mockAccept.mockResolvedValueOnce('cv-1')
    await updateJobStatus('job-1', status)
    expect(mockAccept).toHaveBeenCalledWith('p1', 'job-1')
  })

  it.each(['not started', 'in-progress', 'accepted', 'rejected'] as const)('leaves CVs alone on %s', async (status) => {
    await updateJobStatus('job-1', status)
    expect(mockAccept).not.toHaveBeenCalled()
  })

  it("doesn't accept anything for a job the profile doesn't own", async () => {
    mockUpdate.mockResolvedValueOnce({ count: 0 })
    await expect(updateJobStatus('job-x', 'applied')).rejects.toThrow('Job not found')
    expect(mockAccept).not.toHaveBeenCalled()
  })

  it('still changes the status when accepting the CV fails', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockAccept.mockRejectedValueOnce(new Error('db down'))
    await expect(updateJobStatus('job-1', 'applied')).resolves.toBeUndefined()
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 'job-1', profileId: 'p1' }, data: { status: 'applied' } })
    err.mockRestore()
  })
})
