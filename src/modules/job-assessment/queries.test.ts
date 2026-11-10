import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: { jobAssessment: { findMany: vi.fn(), findFirst: vi.fn() }, $queryRaw: vi.fn() },
}))
vi.mock('./queue', () => ({ isAssessmentEnabledFor: vi.fn(), assessmentMaybeEnabled: vi.fn() }))

import { prisma } from '@/lib/db'
import { assessmentMaybeEnabled, isAssessmentEnabledFor } from './queue'
import { REPLACED_DESCRIPTION } from './enrich'
import {
  getEarlyAssessmentForJob,
  getEarlyAssessmentsForJobs,
  getLatestAssessment,
  getLatestAssessments,
  isStale,
  STALE_RUN_REASON,
  toAssessmentView,
  type AssessmentRow,
} from './queries'

const now = new Date('2026-11-10T12:00:00Z')
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000)

const complete: AssessmentRow = {
  id: 'a1',
  jobApplicationId: 'job-1',
  status: 'complete',
  level: 'pursue',
  score: 7,
  blocked: false,
  blockers: [
    { kind: 'pay', severity: 'unconfirmed', label: 'Pay range straddles your floor' },
    { bogus: true },
  ],
  strengths: ['Delivery'],
  gaps: [],
  unsettled: ['Budget ownership'],
  enrichedFields: [],
  failureKind: null,
  failureReasons: [],
  jevModel: 'jev-1.14.0',
  pipelineVersion: 'early-v1',
  processTimeMs: 1200,
  startedAt: minutesAgo(30),
  completedAt: minutesAgo(29),
  createdAt: minutesAgo(31),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
})

describe('toAssessmentView', () => {
  it('maps a complete row and drops malformed blockers', () => {
    const v = toAssessmentView(complete, now)
    expect(v).toMatchObject({
      id: 'a1', jobId: 'job-1', status: 'complete', level: 'pursue', score: 7, blocked: false,
      strengths: ['Delivery'], unsettled: ['Budget ownership'], jevModel: 'jev-1.14.0',
      pipelineVersion: 'early-v1', processTimeMs: 1200, failureKind: null,
    })
    expect(v.blockers).toEqual([{ kind: 'pay', severity: 'unconfirmed', label: 'Pay range straddles your floor' }])
  })

  it.each([
    ['checking', 4, false],
    ['fetching', 6, true],
    ['assessing', 6, true],
  ])('in progress (%s) for %i min → stale %s', (status, mins, stale) => {
    const row = { ...complete, status, startedAt: minutesAgo(mins), completedAt: null }
    expect(isStale(row, now)).toBe(stale)
    const v = toAssessmentView(row, now)
    expect(v.status).toBe(stale ? 'failed' : status)
    if (stale) expect(v).toMatchObject({ failureKind: 'error', failureReasons: [STALE_RUN_REASON] })
  })

  it('treats a queued row as stale only after 15 minutes', () => {
    expect(toAssessmentView({ ...complete, status: 'queued', startedAt: null, createdAt: minutesAgo(10) }, now).status).toBe('queued')
    expect(toAssessmentView({ ...complete, status: 'queued', startedAt: null, createdAt: minutesAgo(16) }, now))
      .toMatchObject({ status: 'failed', failureKind: 'error', failureReasons: [STALE_RUN_REASON] })
  })

  it('reads notes when given and ignores malformed ones', () => {
    expect(toAssessmentView(complete, now).notes).toEqual([])
    expect(toAssessmentView(complete, now, ['Contract role', 3, null]).notes).toEqual(['Contract role'])
    expect(toAssessmentView(complete, now, { not: 'a list' }).notes).toEqual([])
  })

  it('flags a description replaced from the job page', () => {
    expect(toAssessmentView(complete, now).descriptionReplaced).toBe(false)
    const v = toAssessmentView({ ...complete, enrichedFields: ['company', REPLACED_DESCRIPTION] }, now)
    expect(v).toMatchObject({ descriptionReplaced: true, enrichedFields: ['company', REPLACED_DESCRIPTION] })
  })

  it('never marks finished rows stale', () => {
    const failed = { ...complete, status: 'failed', failureKind: 'verification', failureReasons: ['Company is missing'] }
    expect(toAssessmentView(failed, now)).toMatchObject({ status: 'failed', failureKind: 'verification', failureReasons: ['Company is missing'] })
  })
})

describe('getLatestAssessments', () => {
  it('returns {} without querying for no jobs', async () => {
    expect(await getLatestAssessments('p1', [])).toEqual({})
    expect(prisma.jobAssessment.findMany).not.toHaveBeenCalled()
  })

  it('reads the newest row per job, scoped by profile', async () => {
    vi.mocked(prisma.jobAssessment.findMany).mockResolvedValueOnce([complete] as never)
    const out = await getLatestAssessments('p1', ['job-1', 'job-2'])
    expect(Object.keys(out)).toEqual(['job-1'])
    expect(prisma.jobAssessment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId: 'p1', jobApplicationId: { in: ['job-1', 'job-2'] } },
      orderBy: { createdAt: 'desc' },
      distinct: ['jobApplicationId'],
    }))
  })

  it('reads notes for complete runs only, in one profile-scoped query', async () => {
    const queued = { ...complete, id: 'a2', jobApplicationId: 'job-2', status: 'queued', createdAt: new Date() }
    vi.mocked(prisma.jobAssessment.findMany).mockResolvedValueOnce([complete, queued] as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ id: 'a1', notes: ['Location unknown'] }] as never)
    const out = await getLatestAssessments('p1', ['job-1', 'job-2'])
    expect(out['job-1'].notes).toEqual(['Location unknown'])
    expect(out['job-2'].notes).toEqual([])
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
    const values = vi.mocked(prisma.$queryRaw).mock.calls[0].slice(1)
    expect(values[0]).toBe('p1')
    expect(JSON.stringify(values[1])).toContain('a1')
    expect(JSON.stringify(values[1])).not.toContain('a2')
  })

  it('skips the notes query when no run is complete', async () => {
    const queued = { ...complete, status: 'queued', createdAt: new Date() }
    vi.mocked(prisma.jobAssessment.findMany).mockResolvedValueOnce([queued] as never)
    await getLatestAssessments('p1', ['job-1'])
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })
})

describe('getLatestAssessment', () => {
  it('returns null when the job has no runs', async () => {
    vi.mocked(prisma.jobAssessment.findFirst).mockResolvedValueOnce(null)
    expect(await getLatestAssessment('p1', 'job-1')).toBeNull()
    expect(prisma.jobAssessment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId: 'p1', jobApplicationId: 'job-1' },
      orderBy: { createdAt: 'desc' },
    }))
  })
})

describe('getEarlyAssessmentsForJobs', () => {
  it('returns {} without reading runs when the feature is off for the profile', async () => {
    vi.mocked(isAssessmentEnabledFor).mockResolvedValueOnce(false)
    expect(await getEarlyAssessmentsForJobs('p-off', ['job-1'])).toEqual({})
    expect(prisma.jobAssessment.findMany).not.toHaveBeenCalled()
  })

  it('reads the latest runs when enabled', async () => {
    vi.mocked(isAssessmentEnabledFor).mockResolvedValueOnce(true)
    vi.mocked(prisma.jobAssessment.findMany).mockResolvedValueOnce([complete] as never)
    const out = await getEarlyAssessmentsForJobs('p-on', ['job-1'])
    expect(out['job-1']).toMatchObject({ id: 'a1', level: 'pursue' })
  })
})

describe('getEarlyAssessmentForJob', () => {
  it('returns null without any query when the feature is off for everyone', async () => {
    vi.mocked(assessmentMaybeEnabled).mockReturnValueOnce(false)
    expect(await getEarlyAssessmentForJob('p1', 'job-1')).toBeNull()
    expect(prisma.jobAssessment.findFirst).not.toHaveBeenCalled()
  })

  it('returns null when the feature is off for this profile', async () => {
    vi.mocked(assessmentMaybeEnabled).mockReturnValueOnce(true)
    vi.mocked(isAssessmentEnabledFor).mockResolvedValueOnce(false)
    vi.mocked(prisma.jobAssessment.findFirst).mockResolvedValueOnce(complete as never)
    expect(await getEarlyAssessmentForJob('p-off2', 'job-1')).toBeNull()
  })

  it('returns the latest run with its notes when enabled', async () => {
    vi.mocked(assessmentMaybeEnabled).mockReturnValueOnce(true)
    vi.mocked(isAssessmentEnabledFor).mockResolvedValueOnce(true)
    vi.mocked(prisma.jobAssessment.findFirst).mockResolvedValueOnce(complete as never)
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ id: 'a1', notes: ['Contract role'] }] as never)
    expect(await getEarlyAssessmentForJob('p-on2', 'job-1')).toMatchObject({ id: 'a1', notes: ['Contract role'] })
    expect(prisma.jobAssessment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId: 'p-on2', jobApplicationId: 'job-1' },
    }))
  })
})
