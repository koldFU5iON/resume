import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: { jobApplication: { findFirst: vi.fn() } } }))
vi.mock('./queries', () => ({ getDeepDive: vi.fn(), listDeepDiveRuns: vi.fn() }))
vi.mock('./report-text', () => ({ reportToMarkdown: vi.fn(() => '# Deep dive: PM at Monzo\n') }))

import { prisma } from '@/lib/db'
import { getDeepDive, listDeepDiveRuns } from './queries'
import { reportToMarkdown } from './report-text'
import { getDeepDiveForCoach } from './coach'

const job = { id: 'job-1', title: 'PM', company: 'Monzo', url: null }
const run = (id: string, status: string) => ({ id, status, verdict: null, createdAt: new Date('2026-11-11T10:00:00Z') })
const view = (id: string, outOfDate: boolean | null) => ({
  id, report: { verdict: 'long_shot' }, research: null, researchModel: 'm1', synthesisModel: 'm2',
  outOfDate, createdAt: new Date('2026-11-11T10:00:00Z'),
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.jobApplication.findFirst).mockResolvedValue(job as never)
})

describe('getDeepDiveForCoach', () => {
  it("reads only the profile's own job", async () => {
    vi.mocked(prisma.jobApplication.findFirst).mockResolvedValue(null)
    expect(await getDeepDiveForCoach('p1', 'job-x')).toMatchObject({ found: false, reason: 'no_job' })
    expect(vi.mocked(prisma.jobApplication.findFirst).mock.calls[0][0]).toMatchObject({ where: { id: 'job-x', profileId: 'p1' } })
    expect(listDeepDiveRuns).not.toHaveBeenCalled()
  })

  it('says when there is no report, and when one is running', async () => {
    vi.mocked(listDeepDiveRuns).mockResolvedValue([])
    expect(await getDeepDiveForCoach('p1', 'job-1')).toMatchObject({ found: false, reason: 'no_report', inProgress: false })

    vi.mocked(listDeepDiveRuns).mockResolvedValue([run('r2', 'researching')] as never)
    const running = await getDeepDiveForCoach('p1', 'job-1')
    expect(running).toMatchObject({ found: false, inProgress: true })
    expect(getDeepDive).not.toHaveBeenCalled()
  })

  it('returns the newest report as Markdown, checking whether it is out of date', async () => {
    vi.mocked(listDeepDiveRuns).mockResolvedValue([run('r1', 'complete')] as never)
    vi.mocked(getDeepDive).mockResolvedValue(view('r1', true) as never)
    const res = await getDeepDiveForCoach('p1', 'job-1')
    expect(getDeepDive).toHaveBeenCalledWith('p1', 'job-1', null)
    expect(res).toMatchObject({
      found: true, runId: 'r1', runDate: '2026-11-11', verdict: 'long_shot', outOfDate: true,
      newerRunInProgress: false, markdown: '# Deep dive: PM at Monzo\n',
    })
    expect(vi.mocked(reportToMarkdown).mock.calls[0][2]).toMatchObject({ jobTitle: 'PM', company: 'Monzo', models: ['m1', 'm2'] })
  })

  it('falls back to the last complete run while a newer one runs or after one failed', async () => {
    vi.mocked(listDeepDiveRuns).mockResolvedValue([run('r3', 'synthesising'), run('r2', 'failed'), run('r1', 'complete')] as never)
    vi.mocked(getDeepDive).mockResolvedValue(view('r1', null) as never)
    const res = await getDeepDiveForCoach('p1', 'job-1')
    expect(getDeepDive).toHaveBeenCalledWith('p1', 'job-1', 'r1')
    expect(res).toMatchObject({ found: true, runId: 'r1', newerRunInProgress: true })
  })
})
