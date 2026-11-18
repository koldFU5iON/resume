import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: { cvGeneration: { findFirst: vi.fn() } } }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/modules/llm/client', () => ({ getLLMConfigStatus: vi.fn() }))
vi.mock('./gather', () => ({ gatherCvInputs: vi.fn() }))
vi.mock('./brief', () => ({ runBrief: vi.fn() }))
vi.mock('./select', async (orig) => ({ ...(await orig<typeof import('./select')>()), runSelect: vi.fn() }))
vi.mock('./queries', () => ({ getRunUsage: vi.fn() }))
vi.mock('./run', async (orig) => ({
  ...(await orig<typeof import('./run')>()),
  createCvGenerationRun: vi.fn(), setStatus: vi.fn(), updateActive: vi.fn(), failRun: vi.fn(),
}))

import { after } from 'next/server'
import { prisma } from '@/lib/db'
import { getLLMConfigStatus } from '@/modules/llm/client'
import { LLMError } from '@/modules/llm/errors'
import { runBrief } from './brief'
import { gatherCvInputs } from './gather'
import { getRunUsage } from './queries'
import { createCvGenerationRun, failRun, setStatus, updateActive } from './run'
import { failureKindFor, runCvGenerationStages, startCvGeneration } from './run-pipeline'
import { runSelect } from './select'
import { enforceSelection } from './select'
import { bigCandidates } from './__fixtures__/candidates'
import { buildBriefFor, gathered } from './__fixtures__/gathered'

const db = vi.mocked(prisma, { deep: true })
const mockSetStatus = vi.mocked(setStatus)
const mockUpdate = vi.mocked(updateActive)
const mockFail = vi.mocked(failRun)
const mockCreate = vi.mocked(createCvGenerationRun)
const mockGather = vi.mocked(gatherCvInputs)
const mockBrief = vi.mocked(runBrief)
const mockSelect = vi.mocked(runSelect)
const mockConfig = vi.mocked(getLLMConfigStatus)
const mockUsage = vi.mocked(getRunUsage)
const mockAfter = vi.mocked(after)

const bucket = (over: Record<string, unknown> = {}) => ({ requests: 1, inputTokens: 1000, outputTokens: 200, estimatedCostUsd: 0.05, estimateComplete: true, ...over })
const selection = enforceSelection(
  { employers: [{ id: 'co-0', relevance: 4, reason: 'recent' }], activities: [], skills: [{ id: 's0', reason: 'core' }], tools: [], competencies: [], certifications: [], education: [], projects: [] },
  bigCandidates(), buildBriefFor(),
).selection

beforeEach(() => {
  vi.clearAllMocks()
  db.cvGeneration.findFirst.mockResolvedValue({ jobApplicationId: 'job-1' } as never)
  mockConfig.mockResolvedValue({ configured: true } as never)
  mockSetStatus.mockResolvedValue(true)
  mockUpdate.mockResolvedValue(true)
  mockFail.mockResolvedValue(true)
  mockGather.mockResolvedValue(gathered())
  mockBrief.mockResolvedValue({ value: buildBriefFor(), model: 'm-analysis', retries: 1 })
  mockSelect.mockResolvedValue({ selection, model: 'm-fast', retries: 0, notes: ['Dropped 1 id that is not in the profile.'] })
  mockUsage.mockResolvedValue({
    total: bucket() as never,
    byFeature: { 'cv-gen-brief': bucket() as never, 'cv-gen-select': bucket({ inputTokens: 5000, outputTokens: 300, estimatedCostUsd: 0.004 }) as never },
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('failureKindFor', () => {
  it.each([
    ['not_configured', 'no_llm_key'], ['timeout', 'timeout'], ['rate_limit', 'rate_limited'], ['unavailable', 'overloaded'],
    ['safety', 'refusal'], ['invalid_output', 'invalid_output'], ['auth', 'error'], ['config', 'error'], ['unknown', 'error'],
  ] as const)('maps LLMError %s to %s', (kind, expected) => {
    expect(failureKindFor(new LLMError('x', kind))).toBe(expected)
  })

  it('maps anything else to error', () => {
    expect(failureKindFor(new Error('boom'))).toBe('error')
    expect(failureKindFor('x')).toBe('error')
  })
})

describe('startCvGeneration', () => {
  it('admits a run and executes the stages in after()', async () => {
    mockCreate.mockResolvedValue({ kind: 'created', runId: 'run-1' })
    expect(await startCvGeneration('p1', 'job-1', { stopAfter: 'selecting' })).toEqual({ kind: 'started', runId: 'run-1' })
    expect(mockCreate).toHaveBeenCalledWith('p1', 'job-1')
    expect(mockAfter).toHaveBeenCalledTimes(1)
    await (mockAfter.mock.calls[0][0] as () => Promise<void>)()
    expect(mockSetStatus).toHaveBeenCalledWith('p1', 'run-1', 'gathering', expect.anything())
  })

  it.each([
    [{ kind: 'existing', runId: 'run-0' }], [{ kind: 'limit' }], [{ kind: 'not_found' }],
  ] as const)('starts nothing for %j', async (result) => {
    mockCreate.mockResolvedValue(result)
    expect(await startCvGeneration('p1', 'job-1', { stopAfter: 'selecting' })).toEqual(result)
    expect(mockAfter).not.toHaveBeenCalled()
  })
})

describe('runCvGenerationStages', () => {
  it('moves gathering → briefing → selecting, then completes as a preview with the full log', async () => {
    await runCvGenerationStages('run-1', 'p1')

    expect(mockSetStatus.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      ['p1', 'run-1', 'gathering'], ['p1', 'run-1', 'briefing'], ['p1', 'run-1', 'selecting'],
    ])
    expect(mockSetStatus.mock.calls[0][3]).toMatchObject({ startedAt: expect.any(Date) })
    expect(mockSetStatus.mock.calls[1][3]).toMatchObject({ inputsHash: 'h'.repeat(64), deepDiveId: null })
    expect(mockSetStatus.mock.calls[2][3]).toMatchObject({ brief: expect.objectContaining({ hiddenQuestion: expect.any(String) }) })

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const [pid, id, data] = mockUpdate.mock.calls[0]
    expect([pid, id]).toEqual(['p1', 'run-1'])
    expect(data).toMatchObject({ status: 'complete', completedAt: expect.any(Date), selection })
    const log = data.log as { entries: Array<Record<string, unknown>>; partial: boolean }
    expect(log.partial).toBe(true)
    expect(log.entries.map((e) => e.stage)).toEqual(['gather', 'brief', 'select'])
    expect(log.entries[1]).toMatchObject({ stage: 'brief', status: 'ok', model: 'm-analysis', retries: 1, tokens: { input: 1000, output: 200 }, costUsd: 0.05 })
    expect(log.entries[2]).toMatchObject({ stage: 'select', model: 'm-fast', tokens: { input: 5000, output: 300 }, costUsd: 0.004 })
    expect((log.entries[2].kept as string[]).length).toBeGreaterThan(0)
    expect(log.entries[2].notes).toEqual(expect.arrayContaining(['Dropped 1 id that is not in the profile.']))
    expect(log.entries[0].model).toBeNull()
    expect(Object.keys(data.stageTimings as object).sort()).toEqual(['brief', 'gather', 'select'])
    expect(mockFail).not.toHaveBeenCalled()
  })

  it('words the gather and select counts correctly for one and for many', async () => {
    mockSelect.mockResolvedValue({ selection: { ...selection, notSelectedTotal: 1 }, model: 'm-fast', retries: 0, notes: [] })
    await runCvGenerationStages('run-1', 'p1')
    const one = (mockUpdate.mock.calls[0][2].log as { entries: Array<{ notes: string[] }> }).entries
    expect(one[2].notes).toContain('1 other profile item was not selected.')
    expect(one[0].notes.join(' ')).toMatch(/Profile: 6 roles at 6 employers with 48 activities;/)
    mockUpdate.mockClear()
    mockSelect.mockResolvedValue({ selection: { ...selection, notSelectedTotal: 5 }, model: 'm-fast', retries: 0, notes: [] })
    await runCvGenerationStages('run-1', 'p1')
    expect((mockUpdate.mock.calls[0][2].log as { entries: Array<{ notes: string[] }> }).entries[2].notes).toContain('5 other profile items were not selected.')
  })

  it('attributes every call to the job and the run', async () => {
    await runCvGenerationStages('run-1', 'p1')
    expect(mockGather).toHaveBeenCalledWith('p1', 'job-1', { runId: 'run-1' })
    expect(mockBrief).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ profileId: 'p1', jobApplicationId: 'job-1', runId: 'run-1' }))
    expect(mockSelect).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ profileId: 'p1', jobApplicationId: 'job-1', runId: 'run-1' }))
  })

  it('records the cost of the last-resort job analysis on the gather entry', async () => {
    mockGather.mockResolvedValue(gathered({ strategy: { ...gathered().strategy, source: 'analysed' } }))
    mockUsage.mockResolvedValue({ total: bucket() as never, byFeature: { 'cv-job-analysis': bucket({ inputTokens: 700, outputTokens: 90, estimatedCostUsd: 0.002 }) as never } })
    await runCvGenerationStages('run-1', 'p1')
    const log = mockUpdate.mock.calls[0][2].log as { entries: Array<Record<string, unknown>> }
    expect(log.entries[0]).toMatchObject({ stage: 'gather', tokens: { input: 700, output: 90 }, costUsd: 0.002 })
  })

  it('fails as no_llm_key before any gathering work', async () => {
    mockConfig.mockResolvedValue({ configured: false } as never)
    await runCvGenerationStages('run-1', 'p1')
    expect(mockFail).toHaveBeenCalledWith('p1', 'run-1', 'no_llm_key', null, expect.objectContaining({
      log: { entries: [expect.objectContaining({ stage: 'gather', status: 'failed' })], partial: false },
    }))
    expect(mockGather).not.toHaveBeenCalled()
    expect(mockBrief).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('fails as no_description when the job has none', async () => {
    mockGather.mockResolvedValue({ ok: false, kind: 'no_description', message: 'none' })
    await runCvGenerationStages('run-1', 'p1')
    expect(mockFail).toHaveBeenCalledWith('p1', 'run-1', 'no_description', null, expect.anything())
    expect(mockBrief).not.toHaveBeenCalled()
  })

  it.each([
    ['rate_limit', 'rate_limited'], ['unavailable', 'overloaded'], ['safety', 'refusal'], ['invalid_output', 'invalid_output'], ['timeout', 'timeout'],
  ] as const)('maps a Brief %s error to %s and keeps the finished stages in the log', async (llmKind, failure) => {
    mockBrief.mockRejectedValue(new LLMError('x', llmKind))
    await runCvGenerationStages('run-1', 'p1')
    expect(mockFail).toHaveBeenCalledTimes(1)
    const [, , kind, , extra] = mockFail.mock.calls[0]
    expect(kind).toBe(failure)
    const log = (extra as { log: { entries: Array<{ stage: string; status: string }> } }).log
    expect(log.entries.map((e) => `${e.stage}:${e.status}`)).toEqual(['gather:ok', 'brief:failed'])
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('fails as error for anything else, without leaking the message', async () => {
    mockBrief.mockRejectedValue(new Error('db password is hunter2'))
    await runCvGenerationStages('run-1', 'p1')
    expect(mockFail).toHaveBeenCalledWith('p1', 'run-1', 'error', null, expect.anything())
    expect(JSON.stringify(mockFail.mock.calls[0][4])).not.toContain('hunter2')
  })

  it('never fails the run when Select fell back', async () => {
    mockSelect.mockResolvedValue({ selection: { ...selection, mode: 'fallback' }, model: null, retries: 0, notes: ['Chose by rules instead: the call failed (timeout).'] })
    await runCvGenerationStages('run-1', 'p1')
    expect(mockFail).not.toHaveBeenCalled()
    const log = mockUpdate.mock.calls[0][2].log as { entries: Array<{ stage: string; model: string | null; notes: string[] }> }
    expect(log.entries[2]).toMatchObject({ model: null, notes: expect.arrayContaining(['Chose by rules instead: the call failed (timeout).']) })
    expect(mockUpdate.mock.calls[0][2]).toMatchObject({ status: 'complete' })
  })

  it('stops quietly when a transition is refused (finished or stale run)', async () => {
    mockSetStatus.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await runCvGenerationStages('run-1', 'p1')
    expect(mockBrief).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockFail).not.toHaveBeenCalled()
  })

  it('does not complete a run that went stale during Select', async () => {
    mockUpdate.mockResolvedValue(false)
    await runCvGenerationStages('run-1', 'p1')
    expect(mockFail).not.toHaveBeenCalled()
  })

  it('does nothing for a run that is not the profile’s', async () => {
    db.cvGeneration.findFirst.mockResolvedValue(null)
    await runCvGenerationStages('run-1', 'other-profile')
    expect(db.cvGeneration.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'run-1', profileId: 'other-profile' } }))
    expect(mockSetStatus).not.toHaveBeenCalled()
    expect(mockGather).not.toHaveBeenCalled()
  })
})
