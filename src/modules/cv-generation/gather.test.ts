import { beforeEach, describe, expect, it, vi } from 'vitest'

// Only these two tables exist on the mock: touching the master CV (cVDocument)
// or the career vertical would throw, which is how "never read" is asserted.
vi.mock('@/lib/db', () => ({
  prisma: { jobApplication: { findFirst: vi.fn() }, jobDeepDive: { findFirst: vi.fn() } },
}))
vi.mock('@/modules/profile-map/load', () => ({ loadVault: vi.fn() }))
vi.mock('@/modules/cv/analyse-job', () => ({ analyseJob: vi.fn() }))
vi.mock('@/modules/deep-dive/gather', () => ({ currentInputsHash: vi.fn() }))

import { prisma } from '@/lib/db'
import { analyseJob } from '@/modules/cv/analyse-job'
import { currentInputsHash } from '@/modules/deep-dive/gather'
import { loadVault } from '@/modules/profile-map/load'
import { buildVault } from '@/modules/profile-map/build'
import { vaultSource } from '@/modules/profile-map/__fixtures__/source'
import { gatherCvInputs } from './gather'
import { TIME_BUDGET_MS } from './schema'

const db = vi.mocked(prisma, { deep: true })
const mockAnalyse = vi.mocked(analyseJob)
const mockVault = vi.mocked(loadVault)
const mockHash = vi.mocked(currentInputsHash)

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
  id: 'job-1', title: 'Head of Delivery', company: 'Acme', jobDescription: 'Run our delivery org.', jobAnalysis: null, jobAnalysedAt: null, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  mockHash.mockResolvedValue('same-hash')
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
    expect(a.ok && a.candidates.employers[0].roles[0].experienceId).toBe('e1')
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

  describe('a deep dive that is out of date', () => {
    const dd = (over: Record<string, unknown> = {}) => ({
      id: 'dd-9', report, inputsHash: 'old-hash', createdAt: new Date('2026-11-01T10:00:00Z'), completedAt: new Date('2026-11-01T10:05:00Z'), ...over,
    })

    it('uses the deep dive and says nothing when its inputs hash matches the current one', async () => {
      db.jobApplication.findFirst.mockResolvedValue(job({ jobAnalysis: analysis, jobAnalysedAt: new Date('2026-11-10') }) as never)
      db.jobDeepDive.findFirst.mockResolvedValue(dd({ inputsHash: 'same-hash' }) as never)
      const r = await gatherCvInputs('p1', 'job-1', { runId: 'r1' })
      expect(r.ok && r.strategy.source).toBe('deep-dive')
      expect(r.ok && r.notes.join(' ')).not.toContain('out of date')
      expect(mockHash).toHaveBeenCalledWith('p1', 'job-1')
    })

    it('notes it, and prefers a job analysis that is newer than the deep dive', async () => {
      db.jobApplication.findFirst.mockResolvedValue(job({ jobAnalysis: analysis, jobAnalysedAt: new Date('2026-11-10') }) as never)
      db.jobDeepDive.findFirst.mockResolvedValue(dd() as never)
      const r = await gatherCvInputs('p1', 'job-1', { runId: 'r1' })
      expect(r.ok && r.strategy.source).toBe('job-analysis')
      expect(r.ok && r.deepDiveId).toBeNull()
      const notes = r.ok ? r.notes.join(' ') : ''
      expect(notes).toContain('deep dive is out of date for this job')
      expect(notes).toContain('Used the job analysis instead')
      expect(notes).not.toContain('No complete deep dive')
      expect(mockAnalyse).not.toHaveBeenCalled()
    })

    it('still uses the deep dive when the job analysis is older, or has no date, and records that', async () => {
      db.jobDeepDive.findFirst.mockResolvedValue(dd() as never)
      for (const jobAnalysedAt of [new Date('2026-10-01'), null]) {
        db.jobApplication.findFirst.mockResolvedValue(job({ jobAnalysis: analysis, jobAnalysedAt }) as never)
        const r = await gatherCvInputs('p1', 'job-1', { runId: 'r1' })
        expect(r.ok && r.strategy.source).toBe('deep-dive')
        expect(r.ok && r.deepDiveId).toBe('dd-9')
        expect(r.ok && r.notes.join(' ')).toContain('deep dive is out of date for this job')
        expect(r.ok && r.notes.join(' ')).toContain('Used the out-of-date deep dive anyway')
      }
    })

    it('still uses the deep dive when it is out of date and there is no readable job analysis', async () => {
      db.jobApplication.findFirst.mockResolvedValue(job({ jobAnalysis: { nope: 1 }, jobAnalysedAt: new Date('2026-11-10') }) as never)
      db.jobDeepDive.findFirst.mockResolvedValue(dd() as never)
      const r = await gatherCvInputs('p1', 'job-1', { runId: 'r1' })
      expect(r.ok && r.strategy.source).toBe('deep-dive')
    })

    it('does not call it out of date when the deep dive has no hash, or the current hash is unknown or fails', async () => {
      db.jobApplication.findFirst.mockResolvedValue(job({ jobAnalysis: analysis, jobAnalysedAt: new Date('2026-11-10') }) as never)
      db.jobDeepDive.findFirst.mockResolvedValue(dd({ inputsHash: null }) as never)
      expect((await gatherCvInputs('p1', 'job-1', { runId: 'r1' })).ok).toBe(true)
      expect(mockHash).not.toHaveBeenCalled()

      db.jobDeepDive.findFirst.mockResolvedValue(dd() as never)
      vi.spyOn(console, 'error').mockImplementation(() => {})
      for (const hash of [() => Promise.resolve(null), () => Promise.reject(new Error('db'))]) {
        mockHash.mockImplementationOnce(hash)
        const r = await gatherCvInputs('p1', 'job-1', { runId: 'r1' })
        expect(r.ok && r.strategy.source).toBe('deep-dive')
        expect(r.ok && r.notes.join(' ')).not.toContain('out of date')
      }
    })
  })

  describe('the last-resort analyseJob call', () => {
    it('gives up after the deadline and goes on with the description alone, saying so', async () => {
      vi.useFakeTimers()
      try {
        db.jobApplication.findFirst.mockResolvedValue(job() as never)
        mockAnalyse.mockReturnValue(new Promise(() => {})) // hangs forever
        const pending = gatherCvInputs('p1', 'job-1', { runId: 'r1' })
        await vi.advanceTimersByTimeAsync(TIME_BUDGET_MS.analyse - 1)
        let settled = false
        void pending.then(() => { settled = true })
        await vi.advanceTimersByTimeAsync(0)
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(2)
        const r = await pending
        expect(r.ok && r.strategy.source).toBe('none')
        expect(r.ok && r.notes.join(' ')).toContain('took longer than 60 s')
      } finally {
        vi.useRealTimers()
      }
    })

    it('has a named deadline, and does not leave its timer running when analyseJob answers', async () => {
      expect(TIME_BUDGET_MS.analyse).toBe(60_000)
      vi.useFakeTimers()
      try {
        db.jobApplication.findFirst.mockResolvedValue(job() as never)
        mockAnalyse.mockResolvedValue(analysis as never)
        const r = await gatherCvInputs('p1', 'job-1', { runId: 'r1' })
        expect(r.ok && r.strategy.source).toBe('analysed')
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it('treats a rejected analyseJob like a null answer', async () => {
      db.jobApplication.findFirst.mockResolvedValue(job() as never)
      mockAnalyse.mockRejectedValue(new Error('boom'))
      const r = await gatherCvInputs('p1', 'job-1', { runId: 'r1' })
      expect(r.ok && r.strategy.source).toBe('none')
    })
  })
})
