import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    jobAssessment: { updateMany: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    jobApplication: { findFirst: vi.fn() },
    profile: { findUnique: vi.fn() },
    userSettings: { findUnique: vi.fn() },
  },
}))

vi.mock('@/modules/jev/client', async () => {
  const actual = await vi.importActual<typeof import('@/modules/jev/client')>('@/modules/jev/client')
  return { ...actual, askJev: vi.fn() }
})
vi.mock('@/modules/profile/snapshot', () => ({ buildProfileSnapshot: vi.fn() }))
vi.mock('./facts', async (orig) => ({ ...(await orig<typeof import('./facts')>()), extractJobFacts: vi.fn() }))
vi.mock('./enrich', async (orig) => ({ ...(await orig<typeof import('./enrich')>()), enrichJob: vi.fn() }))

import { prisma } from '@/lib/db'
import { askJev, JevError } from '@/modules/jev/client'
import { LLMError } from '@/modules/llm/errors'
import { buildProfileSnapshot, type ProfileSnapshot } from '@/modules/profile/snapshot'
import { MissingAnswerError } from './combine'
import { enrichJob } from './enrich'
import { extractJobFacts } from './facts'
import { Prisma } from '@prisma/client'
import {
  classifyFailure, descriptionIncomplete, JEV_CALL_BOUNDS, MAX_REQUEUES, REQUEUE_LIMIT_REASON, runJobAssessment, STAGE_WORST_MS,
  timed, withCountryFallback,
} from './run'
import type { JobFacts } from './schema'

const mockUpdateMany = vi.mocked(prisma.jobAssessment.updateMany)
const mockUpdate = vi.mocked(prisma.jobAssessment.update)
const mockRow = vi.mocked(prisma.jobAssessment.findFirst)
const mockJob = vi.mocked(prisma.jobApplication.findFirst)
const mockAskJev = vi.mocked(askJev)
const mockFacts = vi.mocked(extractJobFacts)
const mockEnrich = vi.mocked(enrichJob)

const LONG_JD = 'We are hiring a programme manager to run delivery across teams. '.repeat(15)

const baseJob = {
  id: 'job-1',
  url: 'https://jobs.example.com/1',
  title: 'Programme Manager',
  company: 'Acme',
  jobDescription: LONG_JD,
  countries: ['France'],
  salaryBand: null,
}

const facts: JobFacts = {
  requirements: [{ text: 'Programme delivery experience', kind: 'experience', importance: 'must', years: null, parts: null }],
  location: { countries: [], mode: 'unknown', basedInRequired: false, remoteRegions: [] },
  salary: null,
  seniority: 'senior',
  employmentType: 'permanent',
}

const snapshot: ProfileSnapshot = {
  name: 'Sam Example', email: null, phone: null, website: null, linkedin: null, github: null, summary: 'Delivery lead.', tools: [], location: null, headline: 'PM',
  experiences: [{
    role: 'Programme Manager', company: 'Old Co', startDate: new Date('2020-01-01'), endDate: null,
    location: null, remote: false, summary: 'Ran programmes.', activities: [],
  }],
  skills: [], educations: [], certifications: [], competencies: [], languages: [], projects: [],
}

const verifyPass = {
  answers: {
    is_full_description: { type: 'noul', noul: 0.95 },
    has_requirements: { type: 'noul', noul: 0.9 },
    has_responsibilities: { type: 'noul', noul: 0.9 },
  },
  model: 'jev-1.14.0',
  usage: { inputTokens: 100, outputTokens: 3 },
  latencyMs: 5,
  request: { model: 'jev-1.14.0', state: { description: 'x' }, questions: {} },
}

const verifyFail = {
  ...verifyPass,
  answers: { ...verifyPass.answers, is_full_description: { type: 'noul', noul: 0.1 } },
}

const judgeOk = {
  answers: {
    req_0: { type: 'noul', noul: 0.9 },
    skills_match: { type: 'score', score: 3 },
    seniority_fit: { type: 'choice', choice: 'match', probabilities: { match: 0.9, below: 0.1 } },
    domain_fit: { type: 'score', score: 2 },
    sponsorship: { type: 'choice', choice: 'not_mentioned', probabilities: { not_mentioned: 1 } },
  },
  model: 'jev-1.14.0',
  usage: { inputTokens: 900, outputTokens: 10 },
  latencyMs: 7,
  request: { model: 'jev-1.14.0', state: { judge: true }, questions: { judge: true } },
}

const createdAt = new Date(Date.now() - 2_000)
const claim = { id: 'a1', startedAt: new Date(createdAt.getTime() + 1_500) }

function lastUpdateData(): Record<string, unknown> {
  const calls = mockUpdate.mock.calls
  return (calls[calls.length - 1][0] as { data: Record<string, unknown> }).data
}

function statusUpdates(): string[] {
  return mockUpdate.mock.calls.map((c) => (c[0] as { data: { status: string } }).data.status)
}

beforeEach(() => {
  vi.clearAllMocks()
  // Drop queued *Once values a test left unconsumed (clearAllMocks keeps them).
  for (const m of [mockFacts, mockEnrich, mockAskJev, mockUpdate, mockRow, mockJob]) m.mockReset()
  mockUpdate.mockResolvedValue({} as never)
  mockRow.mockResolvedValue({ profileId: 'p1', jobApplicationId: 'job-1', createdAt } as never)
  mockJob.mockResolvedValue(baseJob as never)
  vi.mocked(prisma.userSettings.findUnique).mockResolvedValue({ searchProfile: {} } as never)
  vi.mocked(buildProfileSnapshot).mockResolvedValue(snapshot)
  mockFacts.mockResolvedValue({ facts, factsHash: 'hash-1', cached: false })
  mockAskJev.mockImplementation(async (_p, _r, opts) =>
    (opts.feature === 'job-assessment-verify' ? verifyPass : judgeOk) as never)
})

describe('runJobAssessment', () => {
  it('only proceeds on a row still checking with this claim as its lease token', async () => {
    await runJobAssessment(claim)
    expect(mockRow).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'a1', status: 'checking', startedAt: claim.startedAt },
    }))
  })

  it('never claims a row itself, so a row is never claimed twice', async () => {
    await runJobAssessment(claim)
    // No queued → checking transition from the run: only admission (queue.ts) claims.
    expect(mockUpdateMany).not.toHaveBeenCalled()
    for (const [args] of mockUpdate.mock.calls) {
      expect((args as { data: { status?: string } }).data.status).not.toBe('checking')
    }
  })

  it('exits without work when the claim is no longer ours (second run of the same claim)', async () => {
    mockRow.mockResolvedValueOnce(null) // e.g. already finished, re-queued or re-claimed with a new token
    await expect(runJobAssessment(claim)).resolves.toBe('not_claimed')
    expect(mockAskJev).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('scopes the job read by the row profile', async () => {
    await runJobAssessment(claim)
    expect(mockJob).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'job-1', profileId: 'p1' } }))
  })

  it('runs verify → facts → judge → combine and persists a complete result', async () => {
    await expect(runJobAssessment(claim)).resolves.toBe('complete')

    expect(mockAskJev).toHaveBeenCalledTimes(2)
    // Every call of the run carries the job and the assessment id as its runId.
    const attribution = { jobApplicationId: 'job-1', runId: 'a1' }
    expect(mockAskJev.mock.calls[0][2]).toEqual({ feature: 'job-assessment-verify', attribution, ...JEV_CALL_BOUNDS })
    expect(mockAskJev.mock.calls[1][2]).toEqual({ feature: 'job-assessment-judge', attribution, ...JEV_CALL_BOUNDS })
    expect(mockFacts).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'job-1' }), attribution)
    expect(statusUpdates()).toEqual(['assessing', 'complete'])

    const data = lastUpdateData()
    expect(data).toMatchObject({
      status: 'complete',
      score: expect.any(Number),
      level: expect.any(String),
      blocked: false,
      jevModel: 'jev-1.14.0',
      factsHash: 'hash-1',
      facts,
      enrichedFields: [],
      completedAt: expect.any(Date),
      processTimeMs: expect.any(Number),
    })
    expect(data.queueTimeMs).toBe(1_500) // createdAt → the admission's claim time
    expect(Object.keys(data.stageTimings as object).sort()).toEqual(['combine', 'facts', 'judge', 'verify'])
    expect(data.signals).toMatchObject({ verify: verifyPass.answers, judge: judgeOk.answers, combine: expect.any(Object) })
    expect(data.request).toEqual({ verify: verifyPass.request, judge: judgeOk.request })
  })

  it('sends only the description to verify and passes the summary into the candidate state', async () => {
    await runJobAssessment(claim)
    const verifyState = mockAskJev.mock.calls[0][1].state
    expect(verifyState).toEqual({ description: LONG_JD.trim() })
    const judgeState = mockAskJev.mock.calls[1][1].state as { candidate: { summary: string; roles: object } }
    expect(judgeState.candidate.summary).toContain('Delivery lead.')
    expect(Object.keys(judgeState.candidate.roles)).toEqual(['role_1'])
  })

  it('fails verification on code checks without calling Jev when there is no URL', async () => {
    mockJob.mockResolvedValueOnce({ ...baseJob, url: null, jobDescription: 'Too short' } as never)
    await expect(runJobAssessment(claim)).resolves.toBe('failed')
    expect(mockAskJev).not.toHaveBeenCalled()
    const data = lastUpdateData()
    expect(data).toMatchObject({ status: 'failed', failureKind: 'verification', processTimeMs: expect.any(Number) })
    expect((data.failureReasons as string[])[0]).toMatch(/too short/i)
    expect(Object.keys(data.stageTimings as object)).toEqual(['verify'])
  })

  it('enriches once and verifies again when verification fails and a URL is present', async () => {
    mockAskJev
      .mockResolvedValueOnce(verifyFail as never)
      .mockResolvedValueOnce(verifyPass as never)
      .mockResolvedValueOnce(judgeOk as never)
    mockEnrich.mockResolvedValueOnce({ filled: ['jobDescription'], job: { ...baseJob, jobDescription: `${LONG_JD} More.` } })

    await expect(runJobAssessment(claim)).resolves.toBe('complete')
    expect(mockEnrich).toHaveBeenCalledTimes(1)
    expect(statusUpdates()).toEqual(['fetching', 'assessing', 'complete'])
    const data = lastUpdateData()
    expect(data.enrichedFields).toEqual(['jobDescription'])
    expect(Object.keys(data.stageTimings as object).sort()).toEqual(['combine', 'enrich', 'facts', 'judge', 'verify', 'verifyRetry'])
    expect(Object.keys(data.signals as object)).toEqual(expect.arrayContaining(['verify', 'verifyRetry', 'judge']))
  })

  it('lets enrichment replace an incomplete description and re-verifies', async () => {
    mockAskJev
      .mockResolvedValueOnce(verifyFail as never)
      .mockResolvedValueOnce(verifyPass as never)
      .mockResolvedValueOnce(judgeOk as never)
    mockEnrich.mockResolvedValueOnce({
      filled: ['jobDescription (replaced truncated)'],
      job: { ...baseJob, jobDescription: `${LONG_JD}${LONG_JD}` },
    })
    await expect(runJobAssessment(claim)).resolves.toBe('complete')
    expect(mockEnrich).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'job-1' }), { replaceDescription: true, runId: 'a1' })
    expect(mockAskJev).toHaveBeenCalledTimes(3)
    expect(lastUpdateData().enrichedFields).toEqual(['jobDescription (replaced truncated)'])
  })

  it('does not allow replacement when verification failed for other reasons', async () => {
    mockAskJev.mockResolvedValueOnce({
      ...verifyPass, answers: { ...verifyPass.answers, has_requirements: { type: 'noul', noul: 0.1 } },
    } as never)
    mockEnrich.mockResolvedValueOnce({ filled: [], job: baseJob })
    await runJobAssessment(claim)
    expect(mockEnrich).toHaveBeenCalledWith('p1', expect.anything(), { replaceDescription: false, runId: 'a1' })
  })

  it('fails verification after the retry still fails', async () => {
    mockAskJev.mockResolvedValue(verifyFail as never)
    mockEnrich.mockResolvedValueOnce({
      filled: ['jobDescription (replaced truncated)', 'salaryBand'],
      job: { ...baseJob, jobDescription: `${LONG_JD}${LONG_JD}`, salaryBand: '€90k' },
    })
    await expect(runJobAssessment(claim)).resolves.toBe('failed')
    expect(mockAskJev).toHaveBeenCalledTimes(2)
    expect(lastUpdateData()).toMatchObject({
      status: 'failed', failureKind: 'verification', failureReasons: ['Description looks incomplete or truncated'],
      enrichedFields: ['jobDescription (replaced truncated)', 'salaryBand'],
    })
    expect(mockFacts).not.toHaveBeenCalled()
  })

  it('does not re-verify when enrichment filled only countries or salary', async () => {
    mockAskJev.mockResolvedValue(verifyFail as never)
    mockEnrich.mockResolvedValueOnce({ filled: ['countries', 'salaryBand'], job: { ...baseJob, salaryBand: '€90k' } })
    await expect(runJobAssessment(claim)).resolves.toBe('failed')
    expect(mockAskJev).toHaveBeenCalledTimes(1)
    const data = lastUpdateData()
    expect(data).toMatchObject({ failureKind: 'verification', enrichedFields: ['countries', 'salaryBand'] })
    expect(Object.keys(data.stageTimings as object).sort()).toEqual(['enrich', 'verify'])
  })

  it('caps the description in the verify state', async () => {
    const huge = 'A sentence about the role. '.repeat(3000)
    mockJob.mockResolvedValueOnce({ ...baseJob, jobDescription: huge } as never)
    await runJobAssessment(claim)
    const state = mockAskJev.mock.calls[0][1].state as { description: string }
    expect(state.description.length).toBeLessThanOrEqual(40_000)
    const judge = mockAskJev.mock.calls[1][1].state as { job: { description: string } }
    expect(judge.job.description.length).toBeLessThanOrEqual(40_000)
  })

  it('asks share questions for the newest roles only when over the cap, and combines on the same roles', async () => {
    const roles = Array.from({ length: 15 }, (_, i) => ({
      role: `Role ${i}`, company: `Co ${i}`, startDate: new Date(Date.UTC(2010 + i, 0, 1)),
      endDate: i === 14 ? null : new Date(Date.UTC(2011 + i, 0, 1)), location: null, remote: false, summary: 'Work.', activities: [],
    }))
    vi.mocked(buildProfileSnapshot).mockResolvedValueOnce({ ...snapshot, experiences: roles })
    const yearsReqs = Array.from({ length: 8 }, (_, i) => ({
      text: `Req ${i}`, kind: 'experience' as const, importance: 'must' as const, years: { min: 2, area: `area ${i}` }, parts: null,
    }))
    mockFacts.mockResolvedValueOnce({ facts: { ...facts, requirements: yearsReqs }, factsHash: 'h', cached: true })
    // Answer every question asked so combine succeeds only if it uses the same (cut) timeline.
    mockAskJev.mockImplementation(async (_p, req, opts) => {
      if (opts.feature === 'job-assessment-verify') return verifyPass as never
      const answers: Record<string, unknown> = { ...judgeOk.answers }
      for (const [id, q] of Object.entries(req.questions as Record<string, { type: string }>)) {
        if (q.type === 'choice' && /_role_/.test(id)) answers[id] = { type: 'choice', choice: 'none', probabilities: { none: 1 } }
        if (q.type === 'noul' && id.endsWith('_capability')) answers[id] = { type: 'noul', noul: 0.2 }
      }
      return { ...judgeOk, answers } as never
    })
    await expect(runJobAssessment(claim)).resolves.toBe('complete')
    const ids = Object.keys(mockAskJev.mock.calls[1][1].questions as object)
    const shares = ids.filter((id) => /_role_\d+_[ab]$/.test(id))
    expect(shares.length).toBeLessThanOrEqual(160)
    expect(ids.some((id) => id.includes('_role_11_'))).toBe(false)
    expect(ids.some((id) => id.includes('_role_10_'))).toBe(true)
  })

  it('skips the retry when enrichment filled nothing', async () => {
    mockAskJev.mockResolvedValue(verifyFail as never)
    mockEnrich.mockResolvedValueOnce({ filled: [], job: baseJob, error: 'Could not fetch the job page' })
    await expect(runJobAssessment(claim)).resolves.toBe('failed')
    expect(mockAskJev).toHaveBeenCalledTimes(1)
    const data = lastUpdateData()
    expect(data.failureReasons).toEqual(['Description looks incomplete or truncated', 'Could not fetch the job page'])
    expect(Object.keys(data.stageTimings as object).sort()).toEqual(['enrich', 'verify'])
  })

  it('keeps the verification reasons when enrichment has no LLM key', async () => {
    mockJob.mockResolvedValueOnce({ ...baseJob, jobDescription: '' } as never)
    mockEnrich.mockRejectedValueOnce(new LLMError('No key', 'not_configured'))
    await expect(runJobAssessment(claim)).resolves.toBe('failed')
    expect(lastUpdateData()).toMatchObject({
      failureKind: 'no_llm_key',
      failureReasons: ['Job description is missing', 'Add an LLM key in Settings to fetch the missing details'],
    })
    expect(mockAskJev).not.toHaveBeenCalled()
  })

  it('maps a missing LLM key to no_llm_key', async () => {
    mockFacts.mockRejectedValueOnce(new LLMError('No key', 'not_configured'))
    await expect(runJobAssessment(claim)).resolves.toBe('failed')
    expect(lastUpdateData()).toMatchObject({ failureKind: 'no_llm_key', stageTimings: expect.objectContaining({ facts: expect.any(Number) }) })
  })

  it('maps Jev errors to failure kinds and keeps the partial run', async () => {
    mockAskJev
      .mockResolvedValueOnce(verifyPass as never)
      .mockRejectedValueOnce(new JevError('daily_cap', 'cap'))
    await expect(runJobAssessment(claim)).resolves.toBe('failed')
    const data = lastUpdateData()
    expect(data).toMatchObject({ status: 'failed', failureKind: 'daily_cap', factsHash: 'hash-1', jevModel: 'jev-1.14.0' })
    expect(data.signals).toEqual({ verify: verifyPass.answers })
  })

  it('fails with error when Jev returns an incomplete judge answer', async () => {
    mockAskJev
      .mockResolvedValueOnce(verifyPass as never)
      .mockResolvedValueOnce({ ...judgeOk, answers: { req_0: judgeOk.answers.req_0 } } as never)
    await expect(runJobAssessment(claim)).resolves.toBe('failed')
    expect(lastUpdateData()).toMatchObject({
      failureKind: 'error', failureReasons: ['The assessment service returned an incomplete answer'],
    })
  })

  it('fails with error when the job is gone', async () => {
    mockJob.mockResolvedValueOnce(null)
    await expect(runJobAssessment(claim)).resolves.toBe('failed')
    expect(lastUpdateData()).toMatchObject({ failureKind: 'error', failureReasons: ['The job no longer exists'] })
  })

  it('never throws, even when recording the failure fails', async () => {
    mockFacts.mockRejectedValueOnce(new Error('boom: secret job text'))
    mockUpdate.mockRejectedValue(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(runJobAssessment(claim)).resolves.toBe('failed')
    expect(JSON.stringify(err.mock.calls)).not.toContain('secret job text')
    err.mockRestore()
  })

  it('never throws when the claim check itself fails', async () => {
    mockRow.mockRejectedValueOnce(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(runJobAssessment(claim)).resolves.toBe('not_claimed')
    err.mockRestore()
  })
})

describe('classifyFailure', () => {
  it.each([
    [new JevError('not_configured', 'x'), 'not_configured'],
    [new JevError('daily_cap', 'x'), 'daily_cap'],
    [new JevError('rate_limited', 'x'), 'rate_limited'],
    [new JevError('overloaded', 'x'), 'overloaded'],
    [new JevError('auth', 'x'), 'error'],
    [new JevError('unavailable', 'x'), 'error'],
    [new JevError('context_exceeded', 'x'), 'error'],
    [new LLMError('x', 'timeout'), 'error'],
    [new LLMError('x', 'not_configured'), 'no_llm_key'],
    [new LLMError('x', 'rate_limit'), 'error'],
    [new MissingAnswerError('req_0'), 'error'],
    [new Error('anything'), 'error'],
  ])('%s → %s', (err, kind) => {
    const out = classifyFailure(err)
    expect(out.kind).toBe(kind)
    expect(out.reasons).toHaveLength(1)
    expect(out.reasons[0]).not.toContain('x x')
  })

  it('explains a too-long request and a cheap-model timeout', () => {
    expect(classifyFailure(new JevError('context_exceeded', 'x')).reasons[0]).toMatch(/too long to assess/)
    expect(classifyFailure(new LLMError('x', 'timeout')).reasons[0]).toMatch(/took too long/)
  })

  it('never echoes the raw error message', () => {
    expect(classifyFailure(new Error('JD: secret')).reasons[0]).not.toContain('secret')
    expect(classifyFailure(new LLMError('provider said secret', 'unknown')).reasons[0]).not.toContain('secret')
  })
})

describe('timed', () => {
  it('records the stage even when it throws', async () => {
    const t: Record<string, number> = {}
    await expect(timed(t, 'facts', async () => { throw new Error('x') })).rejects.toThrow('x')
    expect(t.facts).toBeGreaterThanOrEqual(0)
  })
})

describe('withCountryFallback', () => {
  it('uses the job row countries when the description named none', () => {
    expect(withCountryFallback(facts, ['France', 'UK', 'nowhere']).location.countries).toEqual(['FR', 'GB'])
  })

  it('keeps extracted countries', () => {
    const f = { ...facts, location: { ...facts.location, countries: ['IE'] } }
    expect(withCountryFallback(f, ['France']).location.countries).toEqual(['IE'])
  })
})

describe('descriptionIncomplete', () => {
  it('is true for a truncated or too-short description only', () => {
    expect(descriptionIncomplete(['Description looks incomplete or truncated'])).toBe(true)
    expect(descriptionIncomplete(['Description is too short (34 characters; at least 600 needed)'])).toBe(true)
    expect(descriptionIncomplete(['No candidate requirements found'])).toBe(false)
    expect(descriptionIncomplete(['Company is missing', 'Job description is missing'])).toBe(false)
  })
})

describe('runJobAssessment — deadline', () => {
  /** Fake clock; the facts stage advances it by `factsMs`. */
  function clock(factsMs = 0) {
    let now = 5_000_000
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    mockFacts.mockImplementation(async () => { now += factsMs; return { facts, factsHash: 'hash-1', cached: false } })
    return { now: () => now, restore: () => spy.mockRestore() }
  }

  it('re-queues a slow stage near the deadline instead of failing', async () => {
    const c = clock(10_000)
    // verify (50s) and facts (35s) fit; after facts 45s are left, judge needs 50s.
    const outcome = await runJobAssessment(claim, { deadline: c.now() + 55_000 })
    c.restore()
    expect(outcome).toBe('requeued')
    expect(mockAskJev).toHaveBeenCalledTimes(1) // verify only
    expect(lastUpdateData()).toEqual({
      status: 'queued',
      startedAt: null,
      stageTimings: { requeues: 1 },
      failureKind: null,
      failureReasons: [],
      enrichedFields: [],
      jevModel: null,
      signals: Prisma.DbNull,
      request: Prisma.DbNull,
      facts: Prisma.DbNull,
      factsHash: null,
    })
  })

  it('re-queues before verify when not even the first stage fits', async () => {
    const c = clock()
    const outcome = await runJobAssessment(claim, { deadline: c.now() + STAGE_WORST_MS.verify - 1 })
    c.restore()
    expect(outcome).toBe('requeued')
    expect(mockAskJev).not.toHaveBeenCalled()
  })

  it('runs every stage when the deadline is far enough', async () => {
    const c = clock(10_000)
    const outcome = await runJobAssessment(claim, { deadline: c.now() + 300_000 })
    c.restore()
    expect(outcome).toBe('complete')
  })

  it(`fails with a clear reason after ${MAX_REQUEUES} re-queues`, async () => {
    mockRow.mockResolvedValueOnce({ profileId: 'p1', jobApplicationId: 'job-1', createdAt, stageTimings: { requeues: MAX_REQUEUES } } as never)
    const c = clock()
    const outcome = await runJobAssessment(claim, { deadline: c.now() + 1_000 })
    c.restore()
    expect(outcome).toBe('failed')
    expect(lastUpdateData()).toMatchObject({
      status: 'failed', failureKind: 'error', failureReasons: [REQUEUE_LIMIT_REASON],
      stageTimings: { requeues: MAX_REQUEUES },
    })
  })

  it('a re-queued row runs from scratch on the next drain and keeps its re-queue count', async () => {
    mockRow.mockResolvedValueOnce({ profileId: 'p1', jobApplicationId: 'job-1', createdAt, stageTimings: { requeues: 1 } } as never)
    await expect(runJobAssessment(claim, { deadline: Date.now() + 300_000 })).resolves.toBe('complete')
    expect(mockAskJev).toHaveBeenCalledTimes(2)
    expect(lastUpdateData().stageTimings).toMatchObject({ requeues: 1, verify: expect.any(Number), judge: expect.any(Number) })
  })
})
