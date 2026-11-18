import { beforeEach, describe, expect, it, vi } from 'vitest'

// Only these two tables exist on the mock: touching the master CV (cVDocument)
// or the career vertical would throw, which is how "never read" is asserted.
vi.mock('@/lib/db', () => ({
  prisma: { jobApplication: { findFirst: vi.fn() }, jobDeepDive: { findFirst: vi.fn() } },
}))
vi.mock('@/modules/profile-map/load', () => ({ loadVault: vi.fn() }))
vi.mock('@/modules/cv/analyse-job', () => ({ analyseJob: vi.fn() }))

import { prisma } from '@/lib/db'
import { analyseJob } from '@/modules/cv/analyse-job'
import { loadVault } from '@/modules/profile-map/load'
import { buildVault } from '@/modules/profile-map/build'
import { vaultSource } from '@/modules/profile-map/__fixtures__/source'
import { gatherCvInputs } from './gather'

const db = vi.mocked(prisma, { deep: true })
const mockAnalyse = vi.mocked(analyseJob)
const mockVault = vi.mocked(loadVault)

const analysis = {
  mustHave: ['Program delivery'], niceToHave: ['Agile'],
  risks: [{ risk: 'No fintech', severity: 'medium', recommendation: 'Lead with logistics scale' }],
  positioningStrategy: 'Delivery lead at scale.',
}
const report = {
  verdict: 'apply', worthTailoredCv: { answer: true, reason: 'r' }, likelihood: {}, pay: {},
  blockers: [], gaps: [{ requirement: 'Fintech', closability: 'closable_later', action: 'Read up', weeksToClose: 4, evidence: [] }],
  strengths: [{ point: 'Shipped four releases', evidence: [] }], questionsToAsk: [], unknowns: [],
  company: { signals: [] },
  practicalities: { location: {}, sponsorship: {}, other: [] },
  cvStrategy: { leadWith: ['Release train'], emphasise: [{ item: 'Delivery', why: 'core' }], playDown: ['Support'], positioning: 'Deep dive positioning.' },
}
const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1', title: 'Head of Delivery', company: 'Acme', jobDescription: 'Run our delivery org.', jobAnalysis: null, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockVault.mockResolvedValue(buildVault(vaultSource()))
  db.jobDeepDive.findFirst.mockResolvedValue(null)
})

describe('gatherCvInputs', () => {
  it('is not_found for a job that is not the profile’s (queried by profile)', async () => {
    db.jobApplication.findFirst.mockResolvedValue(null)
    const r = await gatherCvInputs('other-profile', 'job-1', { runId: 'r1' })
    expect(r).toMatchObject({ ok: false, kind: 'not_found' })
    expect(db.jobApplication.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'job-1', profileId: 'other-profile' } }))
    expect(mockVault).not.toHaveBeenCalled()
    expect(mockAnalyse).not.toHaveBeenCalled()
  })

  it('stops on a job with no description', async () => {
    db.jobApplication.findFirst.mockResolvedValue(job({ jobDescription: '   ' }) as never)
    expect(await gatherCvInputs('p1', 'job-1', { runId: 'r1' })).toMatchObject({ ok: false, kind: 'no_description' })
    expect(mockVault).not.toHaveBeenCalled()
  })

  it('prefers the newest complete deep dive over jobAnalysis', async () => {
    db.jobApplication.findFirst.mockResolvedValue(job({ jobAnalysis: analysis }) as never)
    db.jobDeepDive.findFirst.mockResolvedValue({ id: 'dd-9', report } as never)
    const r = await gatherCvInputs('p1', 'job-1', { runId: 'r1' })
    expect(r.ok && r.strategy.source).toBe('deep-dive')
    expect(r.ok && r.deepDiveId).toBe('dd-9')
    expect(r.ok && r.strategy.leadWith).toEqual(['Release train'])
    expect(r.ok && r.strategy.strengths).toEqual(['Shipped four releases'])
    expect(db.jobDeepDive.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId: 'p1', jobApplicationId: 'job-1', status: 'complete' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }))
    expect(mockAnalyse).not.toHaveBeenCalled()
  })

  it('uses jobAnalysis when there is no complete deep dive, without calling the model', async () => {
    db.jobApplication.findFirst.mockResolvedValue(job({ jobAnalysis: analysis }) as never)
    const r = await gatherCvInputs('p1', 'job-1', { runId: 'r1' })
    expect(r.ok && r.strategy.source).toBe('job-analysis')
    expect(r.ok && r.deepDiveId).toBeNull()
    expect(r.ok && r.strategy.mustHave).toEqual(['Program delivery'])
    expect(mockAnalyse).not.toHaveBeenCalled()
  })

  it('falls back to jobAnalysis when the deep dive report is unreadable', async () => {
    db.jobApplication.findFirst.mockResolvedValue(job({ jobAnalysis: analysis }) as never)
    db.jobDeepDive.findFirst.mockResolvedValue({ id: 'dd-9', report: { junk: true } } as never)
    const r = await gatherCvInputs('p1', 'job-1', { runId: 'r1' })
    expect(r.ok && r.strategy.source).toBe('job-analysis')
  })

  it('runs analyseJob for this run as the last resort', async () => {
    db.jobApplication.findFirst.mockResolvedValue(job() as never)
    mockAnalyse.mockResolvedValue(analysis as never)
    const r = await gatherCvInputs('p1', 'job-1', { runId: 'r1' })
    expect(mockAnalyse).toHaveBeenCalledWith('p1', 'job-1', { runId: 'r1' })
    expect(r.ok && r.strategy.source).toBe('analysed')
  })

  it('treats an unreadable jobAnalysis as missing', async () => {
    db.jobApplication.findFirst.mockResolvedValue(job({ jobAnalysis: { nope: 1 } }) as never)
    mockAnalyse.mockResolvedValue(analysis as never)
    expect((await gatherCvInputs('p1', 'job-1', { runId: 'r1' }))).toMatchObject({ ok: true, strategy: { source: 'analysed' } })
  })

  it('goes on with the description alone when analyseJob also fails', async () => {
    db.jobApplication.findFirst.mockResolvedValue(job() as never)
    mockAnalyse.mockResolvedValue(null)
    const r = await gatherCvInputs('p1', 'job-1', { runId: 'r1' })
    expect(r.ok && r.strategy.source).toBe('none')
    expect(r.ok && r.notes.join(' ')).toContain('description alone')
  })

  it('gives the Select stage real ids, and a hash that follows the strategy', async () => {
    db.jobApplication.findFirst.mockResolvedValue(job({ jobAnalysis: analysis }) as never)
    const a = await gatherCvInputs('p1', 'job-1', { runId: 'r1' })
    const a2 = await gatherCvInputs('p1', 'job-1', { runId: 'r2' })
    expect(a.ok && a.candidates.experiences[0].id).toBe('e1')
    expect(a.ok && a.inputsHash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.ok && a2.ok && a.inputsHash === a2.inputsHash).toBe(true)

    db.jobDeepDive.findFirst.mockResolvedValue({ id: 'dd-1', report } as never)
    const b = await gatherCvInputs('p1', 'job-1', { runId: 'r3' })
    expect(a.ok && b.ok && a.inputsHash !== b.inputsHash).toBe(true)
  })

  it('keeps contact details out of what the Brief reads', async () => {
    db.jobApplication.findFirst.mockResolvedValue(job({ jobAnalysis: analysis }) as never)
    const r = await gatherCvInputs('p1', 'job-1', { runId: 'r1' })
    expect(r.ok && JSON.stringify(r)).not.toContain('robin@example.test')
  })
})
