import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    jobAssessment: { updateMany: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
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
vi.mock('./facts', () => ({ extractJobFacts: vi.fn() }))
vi.mock('./enrich', () => ({ enrichJob: vi.fn() }))

import { prisma } from '@/lib/db'
import { askJev, JevError } from '@/modules/jev/client'
import { LLMError } from '@/modules/llm/errors'
import { buildProfileSnapshot, type ProfileSnapshot } from '@/modules/profile/snapshot'
import { MissingAnswerError } from './combine'
import { enrichJob } from './enrich'
import { extractJobFacts } from './facts'
import { classifyFailure, descriptionIncomplete, JEV_CALL_BOUNDS, runJobAssessment, timed, withCountryFallback } from './run'
import type { JobFacts } from './schema'

const mockClaim = vi.mocked(prisma.jobAssessment.updateMany)
const mockUpdate = vi.mocked(prisma.jobAssessment.update)
const mockRow = vi.mocked(prisma.jobAssessment.findUniqueOrThrow)
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
  name: 'Sam Example', email: null, phone: null, website: null, linkedin: null, location: null, headline: 'PM',
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

function lastUpdateData(): Record<string, unknown> {
  const calls = mockUpdate.mock.calls
  return (calls[calls.length - 1][0] as { data: Record<string, unknown> }).data
}

function statusUpdates(): string[] {
  return mockUpdate.mock.calls.map((c) => (c[0] as { data: { status: string } }).data.status)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockClaim.mockResolvedValue({ count: 1 })
  mockUpdate.mockResolvedValue({} as never)
  mockRow.mockResolvedValue({ profileId: 'p1', jobApplicationId: 'job-1', createdAt } as never)
  mockJob.mockResolvedValue(baseJob as never)
  vi.mocked(prisma.profile.findUnique).mockResolvedValue({ summary: 'Delivery lead.' } as never)
  vi.mocked(prisma.userSettings.findUnique).mockResolvedValue({ searchProfile: {} } as never)
  vi.mocked(buildProfileSnapshot).mockResolvedValue(snapshot)
  mockFacts.mockResolvedValue({ facts, factsHash: 'hash-1', cached: false })
  mockAskJev.mockImplementation(async (_p, _r, opts) =>
    (opts.feature === 'job-assessment-verify' ? verifyPass : judgeOk) as never)
})

describe('runJobAssessment', () => {
  it('exits without work when the row is not queued', async () => {
    mockClaim.mockResolvedValueOnce({ count: 0 })
    await expect(runJobAssessment('a1')).resolves.toBe('not_claimed')
    expect(mockClaim).toHaveBeenCalledWith({
      where: { id: 'a1', status: 'queued' },
      data: { status: 'checking', startedAt: expect.any(Date) },
    })
    expect(mockAskJev).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('scopes the job read by the row profile', async () => {
    await runJobAssessment('a1')
    expect(mockJob).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'job-1', profileId: 'p1' } }))
  })

  it('runs verify → facts → judge → combine and persists a complete result', async () => {
    await expect(runJobAssessment('a1')).resolves.toBe('complete')

    expect(mockAskJev).toHaveBeenCalledTimes(2)
    expect(mockAskJev.mock.calls[0][2]).toEqual({ feature: 'job-assessment-verify', ...JEV_CALL_BOUNDS })
    expect(mockAskJev.mock.calls[1][2]).toEqual({ feature: 'job-assessment-judge', ...JEV_CALL_BOUNDS })
    expect(mockFacts).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'job-1' }))
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
    expect(data.queueTimeMs).toBeGreaterThanOrEqual(1_000)
    expect(Object.keys(data.stageTimings as object).sort()).toEqual(['combine', 'facts', 'judge', 'verify'])
    expect(data.signals).toMatchObject({ verify: verifyPass.answers, judge: judgeOk.answers, combine: expect.any(Object) })
    expect(data.request).toEqual({ verify: verifyPass.request, judge: judgeOk.request })
  })

  it('sends only the description to verify and passes the summary into the candidate state', async () => {
    await runJobAssessment('a1')
    const verifyState = mockAskJev.mock.calls[0][1].state
    expect(verifyState).toEqual({ description: LONG_JD.trim() })
    const judgeState = mockAskJev.mock.calls[1][1].state as { candidate: { summary: string; roles: object } }
    expect(judgeState.candidate.summary).toContain('Delivery lead.')
    expect(Object.keys(judgeState.candidate.roles)).toEqual(['role_1'])
  })

  it('fails verification on code checks without calling Jev when there is no URL', async () => {
    mockJob.mockResolvedValueOnce({ ...baseJob, url: null, jobDescription: 'Too short' } as never)
    await expect(runJobAssessment('a1')).resolves.toBe('failed')
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

    await expect(runJobAssessment('a1')).resolves.toBe('complete')
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
    await expect(runJobAssessment('a1')).resolves.toBe('complete')
    expect(mockEnrich).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'job-1' }), { replaceDescription: true })
    expect(mockAskJev).toHaveBeenCalledTimes(3)
    expect(lastUpdateData().enrichedFields).toEqual(['jobDescription (replaced truncated)'])
  })

  it('does not allow replacement when verification failed for other reasons', async () => {
    mockAskJev.mockResolvedValueOnce({
      ...verifyPass, answers: { ...verifyPass.answers, has_requirements: { type: 'noul', noul: 0.1 } },
    } as never)
    mockEnrich.mockResolvedValueOnce({ filled: [], job: baseJob })
    await runJobAssessment('a1')
    expect(mockEnrich).toHaveBeenCalledWith('p1', expect.anything(), { replaceDescription: false })
  })

  it('fails verification after the retry still fails', async () => {
    mockAskJev.mockResolvedValue(verifyFail as never)
    mockEnrich.mockResolvedValueOnce({ filled: ['salaryBand'], job: { ...baseJob, salaryBand: '€90k' } })
    await expect(runJobAssessment('a1')).resolves.toBe('failed')
    expect(mockAskJev).toHaveBeenCalledTimes(2)
    expect(lastUpdateData()).toMatchObject({
      status: 'failed', failureKind: 'verification', failureReasons: ['Description looks incomplete or truncated'],
      enrichedFields: ['salaryBand'],
    })
    expect(mockFacts).not.toHaveBeenCalled()
  })

  it('skips the retry when enrichment filled nothing', async () => {
    mockAskJev.mockResolvedValue(verifyFail as never)
    mockEnrich.mockResolvedValueOnce({ filled: [], job: baseJob, error: 'Could not fetch the job page' })
    await expect(runJobAssessment('a1')).resolves.toBe('failed')
    expect(mockAskJev).toHaveBeenCalledTimes(1)
    const data = lastUpdateData()
    expect(data.failureReasons).toEqual(['Description looks incomplete or truncated', 'Could not fetch the job page'])
    expect(Object.keys(data.stageTimings as object).sort()).toEqual(['enrich', 'verify'])
  })

  it('keeps the verification reasons when enrichment has no LLM key', async () => {
    mockJob.mockResolvedValueOnce({ ...baseJob, jobDescription: '' } as never)
    mockEnrich.mockRejectedValueOnce(new LLMError('No key', 'not_configured'))
    await expect(runJobAssessment('a1')).resolves.toBe('failed')
    expect(lastUpdateData()).toMatchObject({
      failureKind: 'no_llm_key',
      failureReasons: ['Job description is missing', 'Add an LLM key in Settings to fetch the missing details'],
    })
    expect(mockAskJev).not.toHaveBeenCalled()
  })

  it('maps a missing LLM key to no_llm_key', async () => {
    mockFacts.mockRejectedValueOnce(new LLMError('No key', 'not_configured'))
    await expect(runJobAssessment('a1')).resolves.toBe('failed')
    expect(lastUpdateData()).toMatchObject({ failureKind: 'no_llm_key', stageTimings: expect.objectContaining({ facts: expect.any(Number) }) })
  })

  it('maps Jev errors to failure kinds and keeps the partial run', async () => {
    mockAskJev
      .mockResolvedValueOnce(verifyPass as never)
      .mockRejectedValueOnce(new JevError('daily_cap', 'cap'))
    await expect(runJobAssessment('a1')).resolves.toBe('failed')
    const data = lastUpdateData()
    expect(data).toMatchObject({ status: 'failed', failureKind: 'daily_cap', factsHash: 'hash-1', jevModel: 'jev-1.14.0' })
    expect(data.signals).toEqual({ verify: verifyPass.answers })
  })

  it('fails with error when Jev returns an incomplete judge answer', async () => {
    mockAskJev
      .mockResolvedValueOnce(verifyPass as never)
      .mockResolvedValueOnce({ ...judgeOk, answers: { req_0: judgeOk.answers.req_0 } } as never)
    await expect(runJobAssessment('a1')).resolves.toBe('failed')
    expect(lastUpdateData()).toMatchObject({
      failureKind: 'error', failureReasons: ['The assessment service returned an incomplete answer'],
    })
  })

  it('fails with error when the job is gone', async () => {
    mockJob.mockResolvedValueOnce(null)
    await expect(runJobAssessment('a1')).resolves.toBe('failed')
    expect(lastUpdateData()).toMatchObject({ failureKind: 'error', failureReasons: ['The job no longer exists'] })
  })

  it('never throws, even when recording the failure fails', async () => {
    mockFacts.mockRejectedValueOnce(new Error('boom: secret job text'))
    mockUpdate.mockRejectedValue(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(runJobAssessment('a1')).resolves.toBe('failed')
    expect(JSON.stringify(err.mock.calls)).not.toContain('secret job text')
    err.mockRestore()
  })

  it('never throws when the claim itself fails', async () => {
    mockClaim.mockRejectedValueOnce(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(runJobAssessment('a1')).resolves.toBe('not_claimed')
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
