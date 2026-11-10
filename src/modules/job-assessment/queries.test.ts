import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: { jobAssessment: { findMany: vi.fn(), findFirst: vi.fn() } } }))

import { prisma } from '@/lib/db'
import {
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
  failureKind: null,
  failureReasons: [],
  jevModel: 'jev-1.14.0',
  pipelineVersion: 'early-v1',
  processTimeMs: 1200,
  startedAt: minutesAgo(30),
  completedAt: minutesAgo(29),
  createdAt: minutesAgo(31),
}

beforeEach(() => vi.clearAllMocks())

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
