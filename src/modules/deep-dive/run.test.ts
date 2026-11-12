import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => {
  const jobDeepDive = { findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), updateMany: vi.fn() }
  const tx = { $executeRaw: vi.fn(), jobDeepDive }
  return {
    prisma: {
      jobApplication: { findFirst: vi.fn(), update: vi.fn() },
      companyResearch: { create: vi.fn() },
      jobDeepDive,
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      $executeRaw: tx.$executeRaw,
    },
  }
})
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/modules/llm/client', () => ({ getLLMConfigStatus: vi.fn() }))
vi.mock('./gather', () => ({ gatherDeepDiveInputs: vi.fn(), emitSearchProfileSuggestions: vi.fn() }))
vi.mock('./research', () => ({ runResearch: vi.fn() }))
vi.mock('./synthesise', () => ({ synthesise: vi.fn() }))

import { after } from 'next/server'
import { prisma } from '@/lib/db'
import { getLLMConfigStatus } from '@/modules/llm/client'
import { LLMError } from '@/modules/llm/errors'
import { finding, gatherFixture, modelReport, outcome } from './__fixtures__/inputs'
import { emitSearchProfileSuggestions, gatherDeepDiveInputs } from './gather'
import { runResearch } from './research'
import { DeepDiveReportSchema, DEEP_DIVE_CONCURRENCY_PER_PROFILE, DEEP_DIVE_ROUTE_MAX_DURATION_S } from './schema'
import { synthesise } from './synthesise'
import { failureKindFor, runDeepDive, startDeepDive } from './run'

const db = vi.mocked(prisma, { deep: true })
const mockAfter = vi.mocked(after)
const mockConfig = vi.mocked(getLLMConfigStatus)
const mockGather = vi.mocked(gatherDeepDiveInputs)
const mockResearch = vi.mocked(runResearch)
const mockSynth = vi.mocked(synthesise)

beforeEach(() => {
  vi.clearAllMocks()
  db.jobApplication.findFirst.mockResolvedValue({ jobDescription: 'A job' } as never)
  mockConfig.mockResolvedValue({ configured: true, provider: 'anthropic' } as never)
  db.jobDeepDive.findFirst.mockResolvedValue(null)
  db.jobDeepDive.count.mockResolvedValue(0)
  db.jobDeepDive.create.mockResolvedValue({ id: 'dd-1' } as never)
  db.jobDeepDive.updateMany.mockResolvedValue({ count: 1 })
})

describe('startDeepDive', () => {
  it('inserts a queued row under the per-profile lock and runs the pipeline in after()', async () => {
    const res = await startDeepDive('p1', 'job-1')
    expect(res).toEqual({ kind: 'started', deepDiveId: 'dd-1' })
    expect(db.$executeRaw).toHaveBeenCalled()
    expect(db.jobDeepDive.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { profileId: 'p1', jobApplicationId: 'job-1', status: 'queued' },
    }))
    expect(mockAfter).toHaveBeenCalledTimes(1)
  })

  it('returns the running deep dive of the job instead of starting another', async () => {
    db.jobDeepDive.findFirst.mockResolvedValue({ id: 'dd-running' } as never)
    expect(await startDeepDive('p1', 'job-1')).toEqual({ kind: 'existing', deepDiveId: 'dd-running' })
    expect(db.jobDeepDive.create).not.toHaveBeenCalled()
    expect(mockAfter).not.toHaveBeenCalled()
  })

  it('refuses past the per-profile limit', async () => {
    db.jobDeepDive.count.mockResolvedValue(DEEP_DIVE_CONCURRENCY_PER_PROFILE)
    expect(await startDeepDive('p1', 'job-1')).toEqual({ kind: 'limit' })
    expect(db.jobDeepDive.create).not.toHaveBeenCalled()
  })

  it('only counts runs inside the stale window, and only active ones', async () => {
    await startDeepDive('p1', 'job-1')
    const where = db.jobDeepDive.count.mock.calls[0][0]!.where as { status: { in: string[] }; createdAt: { gte: Date } }
    expect(where.status.in).toEqual(['queued', 'gathering', 'researching', 'synthesising'])
    expect(Date.now() - where.createdAt.gte.getTime()).toBeGreaterThan(9 * 60_000)
  })

  it('refuses jobs that are missing, have no description, or a user with no key', async () => {
    db.jobApplication.findFirst.mockResolvedValueOnce(null)
    expect(await startDeepDive('p1', 'job-1')).toEqual({ kind: 'not_found' })
    db.jobApplication.findFirst.mockResolvedValueOnce({ jobDescription: '  ' } as never)
    expect(await startDeepDive('p1', 'job-1')).toEqual({ kind: 'no_description' })
    mockConfig.mockResolvedValueOnce({ configured: false } as never)
    expect(await startDeepDive('p1', 'job-1')).toEqual({ kind: 'no_llm_key' })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('does not gate on blocked jobs (no assessment lookup at all)', async () => {
    await startDeepDive('p1', 'job-1')
    expect(db.jobApplication.findFirst.mock.calls[0][0]!.select).toEqual({ jobDescription: true })
  })
})

describe('runDeepDive', () => {
  const report = DeepDiveReportSchema.parse(modelReport())

  function statuses() {
    return db.jobDeepDive.updateMany.mock.calls.map((c) => (c[0].data as { status?: string }).status)
  }

  beforeEach(() => {
    mockGather.mockResolvedValue({ ok: true, ...gatherFixture() })
    mockResearch.mockResolvedValue({
      researchers: {
        company: outcome({ findings: [finding('200 staff')] }),
        pay: outcome({ status: 'skipped', reason: 'no_web_search', model: null }),
        practicalities: outcome(),
      },
      timings: { company: 10, pay: 0, practicalities: 5 },
      shareableCompanyFindings: [finding('200 staff')],
    })
    mockSynth.mockResolvedValue({ report, model: 'analysis-model' })
  })

  it('walks the stages, caches company findings and stores the report', async () => {
    await runDeepDive('p1', 'job-1', 'dd-1')
    expect(statuses()).toEqual(['gathering', 'researching', 'synthesising', 'complete'])

    const research = mockResearch.mock.calls[0]
    expect(research[0]).toEqual(gatherFixture().brief)
    expect(research[1]).toMatchObject({ profileId: 'p1', jobApplicationId: 'job-1', runId: 'dd-1', webSearch: true })

    expect(db.companyResearch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'co-1', topic: 'company', model: 'research-model' }),
    })
    expect(mockSynth.mock.calls[0][2]).toMatchObject({ runId: 'dd-1', jobApplicationId: 'job-1' })
    // One deadline for the whole run, under the route's 300s, shared by research and synthesis.
    const { deadline } = mockSynth.mock.calls[0][2]
    expect(deadline - Date.now()).toBeLessThanOrEqual(DEEP_DIVE_ROUTE_MAX_DURATION_S * 1000 - 10_000)
    expect(research[1].deadline).toBeLessThanOrEqual(deadline)

    const done = db.jobDeepDive.updateMany.mock.calls.at(-1)![0]
    expect(done.where).toMatchObject({ id: 'dd-1', status: { in: ['queued', 'gathering', 'researching', 'synthesising'] } })
    expect(done.data).toMatchObject({
      status: 'complete', verdict: 'apply_with_caveats', worthTailoredCv: true, synthesisModel: 'analysis-model',
    })
    const researching = db.jobDeepDive.updateMany.mock.calls[1][0].data
    expect(researching).toMatchObject({ inputsHash: 'hash-1', sourceAssessmentId: 'as-1' })
    const synthesising = db.jobDeepDive.updateMany.mock.calls[2][0].data as { research: { findings: unknown[] }; researchModel: string }
    expect(synthesising.research.findings).toHaveLength(1)
    expect(synthesising.researchModel).toBe('research-model')
  })

  it('writes jobAnalysis from the report and queues search-profile suggestions once complete', async () => {
    const g = gatherFixture()
    mockGather.mockResolvedValue({ ok: true, ...g, earlyAssessment: { ...g.earlyAssessment!, facts: { requirements: [{ text: 'Platform leadership', importance: 'must' }] } } })
    await runDeepDive('p1', 'job-1', 'dd-1')
    expect(db.jobApplication.update).toHaveBeenCalledTimes(1)
    const call = db.jobApplication.update.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'job-1', profileId: 'p1' })
    const analysis = call.data.jobAnalysis as { mustHave: string[]; positioningStrategy: string }
    expect(Array.isArray(analysis.mustHave)).toBe(true)
    expect(analysis.positioningStrategy).toContain(report.cvStrategy.positioning)
    expect(call.data.jobAnalysedAt).toBeInstanceOf(Date)
    expect(emitSearchProfileSuggestions).toHaveBeenCalledWith('p1', expect.objectContaining({ inputsHash: 'hash-1' }))
  })

  it('keeps the existing jobAnalysis when there is nothing to base requirements on', async () => {
    await runDeepDive('p1', 'job-1', 'dd-1')
    expect(db.jobApplication.update).not.toHaveBeenCalled()
    expect(statuses().at(-1)).toBe('complete')
  })

  it('builds on an existing jobAnalysis when the run had no facts', async () => {
    db.jobApplication.findFirst.mockResolvedValue({
      jobDescription: 'A job',
      jobAnalysis: { mustHave: ['Pricing strategy'], niceToHave: [], risks: [], positioningStrategy: 'Old.' },
    } as never)
    await runDeepDive('p1', 'job-1', 'dd-1')
    const data = db.jobApplication.update.mock.calls[0][0].data as { jobAnalysis: { mustHave: string[] } }
    expect(data.jobAnalysis.mustHave[0]).toBe('Pricing strategy')
  })

  it('keeps the run complete when writing jobAnalysis or the suggestions fails', async () => {
    db.jobApplication.findFirst.mockRejectedValue(new Error('db down'))
    db.jobApplication.update.mockRejectedValue(new Error('db down'))
    vi.mocked(emitSearchProfileSuggestions).mockRejectedValue(new Error('nope'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await runDeepDive('p1', 'job-1', 'dd-1')
    expect(statuses()).toEqual(['gathering', 'researching', 'synthesising', 'complete'])
  })

  it('writes nothing to the job when the run was no longer active at completion', async () => {
    db.jobDeepDive.updateMany.mockImplementation((async (args: { data: { status?: string } }) =>
      ({ count: args.data.status === 'complete' ? 0 : 1 })) as never)
    await runDeepDive('p1', 'job-1', 'dd-1')
    expect(db.jobApplication.update).not.toHaveBeenCalled()
  })

  it('runs without web research for a provider with no search tool', async () => {
    mockConfig.mockResolvedValue({ configured: true, provider: 'mistral' } as never)
    await runDeepDive('p1', 'job-1', 'dd-1')
    expect(mockResearch.mock.calls[0][1].webSearch).toBe(false)
    expect(statuses().at(-1)).toBe('complete')
  })

  it('shares only the shareable company findings, and nothing from an agency ad', async () => {
    mockResearch.mockResolvedValue({
      researchers: {
        company: outcome({ findings: [finding('web fact'), finding('ad quote', { sourceUrl: null, quote: 'q' })] }),
        pay: outcome(), practicalities: outcome(),
      },
      timings: { company: 0, pay: 0, practicalities: 0 },
      shareableCompanyFindings: [finding('web fact')],
    })
    await runDeepDive('p1', 'job-1', 'dd-1')
    const cached = db.companyResearch.create.mock.calls[0][0].data.findings as { claim: string }[]
    expect(cached.map((f) => f.claim)).toEqual(['web fact'])

    vi.clearAllMocks()
    db.jobDeepDive.updateMany.mockResolvedValue({ count: 1 })
    mockConfig.mockResolvedValue({ configured: true, provider: 'anthropic' } as never)
    const g = gatherFixture()
    mockGather.mockResolvedValue({ ok: true, ...g, brief: { ...g.brief, isRecruitmentAgency: true } })
    await runDeepDive('p1', 'job-1', 'dd-2')
    expect(db.companyResearch.create).not.toHaveBeenCalled()
  })

  it('does not re-cache research that came from the cache', async () => {
    mockResearch.mockResolvedValue({
      researchers: { company: outcome({ status: 'cached', findings: [finding('x')] }), pay: outcome(), practicalities: outcome() },
      timings: { company: 0, pay: 0, practicalities: 0 },
      shareableCompanyFindings: [],
    })
    await runDeepDive('p1', 'job-1', 'dd-1')
    expect(db.companyResearch.create).not.toHaveBeenCalled()
  })

  it('fails with no_description when the job lost its description', async () => {
    mockGather.mockResolvedValue({ ok: false, kind: 'no_description', message: 'Add one' })
    await runDeepDive('p1', 'job-1', 'dd-1')
    expect(db.jobDeepDive.updateMany.mock.calls.at(-1)![0].data).toMatchObject({ status: 'failed', failureKind: 'no_description' })
    expect(mockResearch).not.toHaveBeenCalled()
  })

  it('fails the run with the mapped kind when synthesis fails', async () => {
    mockSynth.mockRejectedValue(new LLMError('slow', 'timeout'))
    await runDeepDive('p1', 'job-1', 'dd-1')
    const last = db.jobDeepDive.updateMany.mock.calls.at(-1)![0].data as { status: string; failureKind: string; stageTimings: { synthesis?: number } }
    expect(last).toMatchObject({ status: 'failed', failureKind: 'timeout' })
    expect(last.stageTimings.synthesis).toBeTypeOf('number')
  })

  it('stops quietly when the row is no longer active', async () => {
    db.jobDeepDive.updateMany.mockResolvedValue({ count: 0 })
    await runDeepDive('p1', 'job-1', 'dd-1')
    expect(mockGather).not.toHaveBeenCalled()
  })

  it('never throws', async () => {
    mockGather.mockRejectedValue(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(runDeepDive('p1', 'job-1', 'dd-1')).resolves.toBeUndefined()
    expect(db.jobDeepDive.updateMany.mock.calls.at(-1)![0].data).toMatchObject({ status: 'failed', failureKind: 'error' })
    err.mockRestore()
  })
})

describe('failureKindFor', () => {
  it('maps LLM error kinds to run failure kinds', () => {
    expect(failureKindFor(new LLMError('', 'not_configured'))).toBe('no_llm_key')
    expect(failureKindFor(new LLMError('', 'rate_limit'))).toBe('rate_limited')
    expect(failureKindFor(new LLMError('', 'unavailable'))).toBe('overloaded')
    expect(failureKindFor(new LLMError('', 'safety'))).toBe('refusal')
    expect(failureKindFor(new LLMError('', 'invalid_output'))).toBe('error')
    expect(failureKindFor(new Error('x'))).toBe('error')
  })
})
