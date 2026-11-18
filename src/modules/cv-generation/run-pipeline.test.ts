import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: { cvGeneration: { findFirst: vi.fn() } } }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/modules/llm/client', () => ({ getLLMConfigStatus: vi.fn() }))
vi.mock('./gather', () => ({ gatherCvInputs: vi.fn() }))
vi.mock('./brief', () => ({ runBrief: vi.fn() }))
vi.mock('./select', async (orig) => ({ ...(await orig<typeof import('./select')>()), runSelect: vi.fn() }))
vi.mock('./queries', () => ({ getRunUsage: vi.fn() }))
vi.mock('@/modules/profile-map/load', () => ({ loadVault: vi.fn() }))
vi.mock('./write/run-write', async (orig) => ({ ...(await orig<typeof import('./write/run-write')>()), runWrite: vi.fn() }))
vi.mock('./reuse', async (orig) => ({ ...(await orig<typeof import('./reuse')>()), findReusableSelection: vi.fn() }))
vi.mock('./land', () => ({ checkLandingTarget: vi.fn(), landCv: vi.fn() }))
vi.mock('./write/review', async (orig) => ({ ...(await orig<typeof import('./write/review')>()), runReview: vi.fn() }))
vi.mock('./run', async (orig) => ({
  ...(await orig<typeof import('./run')>()),
  createCvGenerationRun: vi.fn(), setStatus: vi.fn(), updateActive: vi.fn(), failRun: vi.fn(),
}))

import { after } from 'next/server'
import { prisma } from '@/lib/db'
import { getLLMConfigStatus } from '@/modules/llm/client'
import { LLMError } from '@/modules/llm/errors'
import { runBrief } from './brief'
import { NO_USAGE } from './call'
import { gatherCvInputs } from './gather'
import { getRunUsage } from './queries'
import { createCvGenerationRun, failRun, setStatus, updateActive } from './run'
import { failureKindFor, runCvGenerationStages, startCvGeneration } from './run-pipeline'
import { loadVault } from '@/modules/profile-map/load'
import { checkLandingTarget, landCv } from './land'
import { findReusableSelection } from './reuse'
import { runReview } from './write/review'
import { runSelect } from './select'
import { runWrite, WriteStageError } from './write/run-write'
import { enforceSelection } from './select'
import { bigCandidates } from './__fixtures__/candidates'
import { buildBriefFor, gathered } from './__fixtures__/gathered'
import { writeVault, writtenResult, writtenSections } from './__fixtures__/write'
import { CV_BODY_WORDS_SOFT_LIMIT } from './write/limits'

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
const mockWrite = vi.mocked(runWrite)
const mockVault = vi.mocked(loadVault)
const mockCheckLanding = vi.mocked(checkLandingTarget)
const mockLand = vi.mocked(landCv)
const mockReuse = vi.mocked(findReusableSelection)
const mockReview = vi.mocked(runReview)

const bucket = (over: Record<string, unknown> = {}) => ({ requests: 1, inputTokens: 1000, outputTokens: 200, estimatedCostUsd: 0.05, estimateComplete: true, ...over })
const selection = enforceSelection(
  { employers: [{ id: 'co-0', relevance: 4, reason: 'recent' }], activities: [], skills: [{ id: 's0', reason: 'core' }], tools: [], competencies: [], certifications: [], education: [], projects: [], emphasise: [] },
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
  mockBrief.mockResolvedValue({ value: buildBriefFor(), model: 'm-analysis', retries: 1, usage: NO_USAGE })
  mockSelect.mockResolvedValue({ selection, model: 'm-fast', retries: 0, notes: ['Dropped 1 id that is not in the profile.'] })
  mockUsage.mockResolvedValue({
    total: bucket() as never,
    byFeature: { 'cv-gen-brief': bucket() as never, 'cv-gen-select': bucket({ inputTokens: 5000, outputTokens: 300, estimatedCostUsd: 0.004 }) as never },
  })
  mockVault.mockResolvedValue(writeVault())
  mockWrite.mockResolvedValue(writtenResult())
  mockCheckLanding.mockResolvedValue({ kind: 'ok', documentId: null })
  mockLand.mockResolvedValue({ kind: 'landed', documentId: 'doc-1', created: true })
  mockReuse.mockResolvedValue(null)
  mockReview.mockImplementation(async (input) => ({
    review: { skipped: false, skipReason: null, model: 'm-review', tokens: { input: 900, output: 100 }, costUsd: 0.04, applied: [], discarded: [], concerns: [] },
    assembled: input.assembled, usage: NO_USAGE, notes: [],
  }))
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
    expect(await startCvGeneration('p1', 'job-1')).toEqual({ kind: 'started', runId: 'run-1' })
    expect(mockCreate).toHaveBeenCalledWith('p1', 'job-1')
    expect(mockAfter).toHaveBeenCalledTimes(1)
    await (mockAfter.mock.calls[0][0] as () => Promise<void>)()
    expect(mockSetStatus).toHaveBeenCalledWith('p1', 'run-1', 'gathering', expect.anything())
  })

  it.each([
    [{ kind: 'existing', runId: 'run-0' }], [{ kind: 'limit' }], [{ kind: 'not_found' }],
  ] as const)('starts nothing for %j', async (result) => {
    mockCreate.mockResolvedValue(result)
    expect(await startCvGeneration('p1', 'job-1')).toEqual(result)
    expect(mockAfter).not.toHaveBeenCalled()
  })
})

describe('runCvGenerationStages', () => {
  it('moves through every status, then completes (never partial) with the full log', async () => {
    await runCvGenerationStages('run-1', 'p1')

    expect(mockSetStatus.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([
      ['p1', 'run-1', 'gathering'], ['p1', 'run-1', 'briefing'], ['p1', 'run-1', 'selecting'],
      ['p1', 'run-1', 'writing'], ['p1', 'run-1', 'assembling'], ['p1', 'run-1', 'reviewing'], ['p1', 'run-1', 'landing'],
    ])
    expect(mockSetStatus.mock.calls[0][3]).toMatchObject({ startedAt: expect.any(Date) })
    expect(mockSetStatus.mock.calls[1][3]).toMatchObject({ inputsHash: 'h'.repeat(64), deepDiveId: null })
    expect(mockSetStatus.mock.calls[2][3]).toMatchObject({ brief: expect.objectContaining({ hiddenQuestion: expect.any(String) }), selectionReusedFromRunId: null })

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const [pid, id, data] = mockUpdate.mock.calls[0]
    expect([pid, id]).toEqual(['p1', 'run-1'])
    expect(data).toMatchObject({ status: 'complete', completedAt: expect.any(Date), writingDeskDocumentId: 'doc-1' })
    const log = data.log as { entries: Array<Record<string, unknown>>; partial: boolean }
    expect(log.partial).toBe(false)
    expect(log.entries.map((e) => e.stage)).toEqual(['gather', 'brief', 'select', 'write', 'assemble', 'review', 'land'])
    expect(log.entries[1]).toMatchObject({ stage: 'brief', status: 'ok', model: 'm-analysis', retries: 1, tokens: { input: 1000, output: 200 }, costUsd: 0.05 })
    expect(log.entries[2]).toMatchObject({ stage: 'select', model: 'm-fast', tokens: { input: 5000, output: 300 }, costUsd: 0.004 })
    expect((log.entries[2].kept as string[]).length).toBeGreaterThan(0)
    expect(log.entries[2].notes).toEqual(expect.arrayContaining(['Dropped 1 id that is not in the profile.']))
    expect(log.entries[0].model).toBeNull()
    expect(Object.keys(data.stageTimings as object).sort()).toEqual(['assemble', 'brief', 'gather', 'land', 'review', 'select', 'write'])
    expect(mockFail).not.toHaveBeenCalled()
  })

  it('words the gather and select counts correctly for one and for many', async () => {
    mockSelect.mockResolvedValue({ selection: { ...selection, notSelectedTotal: 1 }, model: 'm-fast', retries: 0, retryReasons: [], notes: [] })
    await runCvGenerationStages('run-1', 'p1')
    const one = (mockUpdate.mock.calls[0][2].log as { entries: Array<{ notes: string[] }> }).entries
    expect(one[2].notes).toContain('1 other profile item was not selected.')
    expect(one[0].notes.join(' ')).toMatch(/Profile: 6 roles at 6 employers with 48 activities;/)
    mockUpdate.mockClear()
    mockSelect.mockResolvedValue({ selection: { ...selection, notSelectedTotal: 5 }, model: 'm-fast', retries: 0, retryReasons: [], notes: [] })
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

describe('runCvGenerationStages: write and assemble (phase 3)', () => {
  const lastLog = () => mockUpdate.mock.calls.at(-1)![2].log as { entries: Array<Record<string, unknown> & { sections: Array<Record<string, unknown>>; notes: string[] }>; partial: boolean }

  it('stores the assembled CV on the row and completes in Land with the document id (post-review markdown)', async () => {
    await runCvGenerationStages('run-1', 'p1')

    expect(mockSetStatus.mock.calls[3][3]).toMatchObject({ selection })
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const data = mockUpdate.mock.calls[0][2]
    expect(data).toMatchObject({ status: 'complete', completedAt: expect.any(Date) })
    expect((data.assembled as { markdown: string }).markdown).toContain('{{contact}}')
    expect((data.assembled as { markdown: string }).markdown).toContain('### Unity')
    expect(mockLand).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'job-1' }), (data.assembled as { markdown: string }).markdown, expect.anything())
    expect(lastLog().partial).toBe(false)
  })

  it('logs the write stage with every section row, the total tokens and cost of the writers, and its time', async () => {
    await runCvGenerationStages('run-1', 'p1')
    const write = lastLog().entries[3]
    expect(write).toMatchObject({ stage: 'write', status: 'ok', model: 'm-sonnet', tokens: { input: 4000, output: 800 }, costUsd: 0.02 })
    expect(write.sections.map((s) => s.id)).toContain('experience:unity')
    expect(write.notes[0]).toMatch(/Wrote 10 sections in .* s \(4 model calls\); the run's budget is 280\.0 s/)
  })

  it('logs the Assemble row with the run total, no cost (code only), and at most three "worth a quick check" notes', async () => {
    mockWrite.mockResolvedValue(writtenResult({ checkNotes: ['one', 'two', 'three', 'four'] }))
    await runCvGenerationStages('run-1', 'p1')
    const assemble = lastLog().entries[4]
    expect(assemble).toMatchObject({ stage: 'assemble', status: 'ok', model: null, tokens: { input: 0, output: 0 }, costUsd: null })
    expect(assemble.notes.filter((n) => n.startsWith('Worth a quick check: '))).toEqual(['Worth a quick check: one', 'Worth a quick check: two', 'Worth a quick check: three'])
    expect(assemble.notes.some((n) => /The whole run took .* s of its 280\.0 s budget/.test(n))).toBe(true)
    expect((mockUpdate.mock.calls[0][2].assembled as { checkNotes: string[] }).checkNotes).toHaveLength(3)
  })

  it('logs a SOFT note when the CV body is over the length limit, trims nothing, and says nothing when it is not (Phase 3c)', async () => {
    await runCvGenerationStages('run-1', 'p1')
    const short = lastLog().entries[4]
    expect(short.notes.join(' ')).toMatch(/Assembled \d+ sections \(about \d+ words\)/)
    expect(short.notes.join(' ')).not.toMatch(/over the ~\d+ that fit/)

    vi.clearAllMocks()
    const filler = Array.from({ length: CV_BODY_WORDS_SOFT_LIMIT + 50 }, (_, i) => `word${i}`).join(' ')
    const sections = writtenSections().map((x) => (x.id === 'profile' ? { ...x, markdown: filler } : x))
    mockWrite.mockResolvedValue(writtenResult({ sections }))
    await runCvGenerationStages('run-1', 'p1')
    const long = lastLog().entries[4]
    expect(long.status).toBe('ok')
    expect(long.notes.join(' ')).toMatch(new RegExp(`The CV body is about \\d+ words, over the ~${CV_BODY_WORDS_SOFT_LIMIT} that fit one to two pages. Nothing was trimmed`))
    expect((mockUpdate.mock.calls.at(-1)![2].assembled as { markdown: string }).markdown).toContain('word0 ')
  })

  it('calls the writers with the run’s own profile and the loaded vault, and the strategy and brief', async () => {
    await runCvGenerationStages('run-1', 'p1')
    expect(mockVault).toHaveBeenCalledWith('p1')
    expect(mockWrite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ hiddenQuestion: expect.any(String) }), selection, expect.objectContaining({ mustHave: ['Delivery'] }), expect.objectContaining({ profileId: 'p1', jobApplicationId: 'job-1', runId: 'run-1', deadline: expect.any(Number) }))
  })

  it('takes brief and select tokens and cost from the call results, not from rows that may not be written yet', async () => {
    mockUsage.mockResolvedValue({ total: bucket() as never, byFeature: {} }) // the usage rows are not there yet
    mockBrief.mockResolvedValue({ value: buildBriefFor(), model: 'm-analysis', retries: 0, usage: { input: 3000, output: 400, costUsd: 0.03, calls: 1 } })
    mockSelect.mockResolvedValue({ selection, model: 'm-fast', retries: 0, retryReasons: [], notes: [], usage: { input: 7000, output: 900, costUsd: 0.0012, calls: 1 } })
    await runCvGenerationStages('run-1', 'p1')
    const log = mockUpdate.mock.calls[0][2].log as { entries: Array<Record<string, unknown>> }
    expect(log.entries[1]).toMatchObject({ stage: 'brief', tokens: { input: 3000, output: 400 }, costUsd: 0.03 })
    expect(log.entries[2]).toMatchObject({ stage: 'select', tokens: { input: 7000, output: 900 }, costUsd: 0.0012 })
  })

  it('shows tokens even when the model has no listed price (cost null)', async () => {
    mockSelect.mockResolvedValue({ selection, model: 'm-fast', retries: 0, retryReasons: [], notes: [], usage: { input: 7000, output: 900, costUsd: null, calls: 1 } })
    await runCvGenerationStages('run-1', 'p1')
    const log = mockUpdate.mock.calls[0][2].log as { entries: Array<Record<string, unknown>> }
    expect(log.entries[2]).toMatchObject({ tokens: { input: 7000, output: 900 }, costUsd: null })
  })

  it('fails as invalid_output, with the section rows written so far, when a writer cannot produce valid output', async () => {
    const rows = [{ id: 'experience:unity', label: 'x', status: 'ok' as const, model: 'm', durationMs: 1, tokens: { input: 1, output: 1 }, costUsd: null, retries: 0, retryReasons: [], notes: [] }]
    mockWrite.mockRejectedValue(new WriteStageError(new LLMError('The experience section could not be used (bad block).', 'invalid_output'), rows))
    await runCvGenerationStages('run-1', 'p1')
    expect(mockFail).toHaveBeenCalledWith('p1', 'run-1', 'invalid_output', null, expect.objectContaining({ log: expect.anything() }))
    const log = mockFail.mock.calls[0][4]!.log as { entries: Array<Record<string, unknown> & { sections: unknown[]; notes: string[] }> }
    const failed = log.entries.at(-1)!
    expect(failed).toMatchObject({ stage: 'write', status: 'failed', sections: rows })
    expect(failed.notes.join(' ')).toMatch(/could not be used/)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('fails as timeout with a clear note naming the stage and the total', async () => {
    mockWrite.mockRejectedValue(new WriteStageError(new LLMError('The run ran out of time before every section was written.', 'timeout'), []))
    await runCvGenerationStages('run-1', 'p1')
    expect(mockFail).toHaveBeenCalledWith('p1', 'run-1', 'timeout', null, expect.anything())
    const log = mockFail.mock.calls[0][4]!.log as { entries: Array<{ notes: string[] }> }
    expect(log.entries.at(-1)!.notes.join(' ')).toMatch(/Timed out in the write stage after .* s; the whole run had taken .* of its 280\.0 s budget/)
  })

  it('fails as invalid_output when the assembled document has invalid blocks, instead of completing', async () => {
    const bad = writtenResult()
    bad.sections = bad.sections.map((s) => (s.id === 'skills' ? { ...s, markdown: ':::skills\n- unclosed\n' } : s))
    mockWrite.mockResolvedValue(bad)
    await runCvGenerationStages('run-1', 'p1')
    expect(mockFail).toHaveBeenCalledWith('p1', 'run-1', 'invalid_output', null, expect.anything())
    const log = mockFail.mock.calls[0][4]!.log as { entries: Array<{ stage: string; notes: string[] }> }
    expect(log.entries.at(-1)).toMatchObject({ stage: 'assemble' })
    expect(log.entries.at(-1)!.notes.join(' ')).toMatch(/invalid blocks/i)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('stops quietly when the run went stale before writing (guarded transition refused)', async () => {
    mockSetStatus.mockImplementation(async (_p, _id, status) => status !== 'writing')
    await runCvGenerationStages('run-1', 'p1')
    expect(mockWrite).not.toHaveBeenCalled()
    expect(mockFail).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

describe('runCvGenerationStages: reuse, review and land (phase 4a)', () => {
  const finalLog = () => mockUpdate.mock.calls.at(-1)![2].log as { entries: Array<Record<string, unknown> & { notes: string[] }> }
  const entry = (stage: string) => finalLog().entries.find((e) => e.stage === stage)!
  const stored = { runId: 'run-0', at: new Date('2026-11-10T09:00:00Z'), brief: buildBriefFor(), selection }

  it('reuses the stored brief and selection: no Brief or Select call, both rows skipped with the reuse note, the source run recorded', async () => {
    mockReuse.mockResolvedValue(stored)
    await runCvGenerationStages('run-1', 'p1')

    expect(mockReuse).toHaveBeenCalledWith('p1', 'job-1', 'h'.repeat(64))
    expect(mockBrief).not.toHaveBeenCalled()
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockSetStatus.mock.calls[2][3]).toMatchObject({ brief: stored.brief, selectionReusedFromRunId: 'run-0' })
    expect(mockSetStatus.mock.calls[3][3]).toMatchObject({ selection })
    const note = 'Reused the brief and selection from the run of 10 Nov 2026 (nothing changed since)'
    expect(entry('brief')).toMatchObject({ status: 'skipped', model: null, notes: [note] })
    expect(entry('select')).toMatchObject({ status: 'skipped', model: null, notes: [note] })
    expect(mockWrite).toHaveBeenCalledWith(expect.anything(), stored.brief, selection, expect.anything(), expect.anything())
    expect(mockUpdate.mock.calls.at(-1)![2]).toMatchObject({ status: 'complete' })
  })

  it('fresh: true never looks for a stored selection and calls Brief and Select', async () => {
    mockReuse.mockResolvedValue(stored)
    await runCvGenerationStages('run-1', 'p1', { fresh: true })
    expect(mockReuse).not.toHaveBeenCalled()
    expect(mockBrief).toHaveBeenCalledTimes(1)
    expect(mockSelect).toHaveBeenCalledTimes(1)
    expect(mockSetStatus.mock.calls[2][3]).toMatchObject({ selectionReusedFromRunId: null })
    expect(entry('gather').notes.join(' ')).toMatch(/fresh brief and selection were requested/)
  })

  it('runs the review with the brief, selection, strategy and the run attribution, ending before the Land reserve', async () => {
    await runCvGenerationStages('run-1', 'p1')
    expect(mockReview).toHaveBeenCalledTimes(1)
    const [input, opts] = mockReview.mock.calls[0]
    expect(input).toMatchObject({ selection, brief: expect.objectContaining({ hiddenQuestion: expect.any(String) }), strategy: expect.objectContaining({ mustHave: ['Delivery'] }) })
    expect(opts).toMatchObject({ profileId: 'p1', jobApplicationId: 'job-1', runId: 'run-1' })
    expect(opts.deadline).toBeLessThan(Date.now() + 280_000)
    expect(entry('review')).toMatchObject({ status: 'ok', model: 'm-review', tokens: { input: 900, output: 100 }, costUsd: 0.04 })
    expect(mockUpdate.mock.calls.at(-1)![2]).toMatchObject({ review: expect.objectContaining({ skipped: false }) })
  })

  it('review: false skips the stage (logged) and lands the unreviewed CV', async () => {
    await runCvGenerationStages('run-1', 'p1', { review: false })
    expect(mockReview).not.toHaveBeenCalled()
    expect(entry('review')).toMatchObject({ status: 'skipped', model: null })
    expect(entry('review').notes.join(' ')).toMatch(/turned off/)
    expect(mockUpdate.mock.calls.at(-1)![2]).toMatchObject({ status: 'complete', review: expect.objectContaining({ skipped: true }) })
    expect(mockLand).toHaveBeenCalledTimes(1)
  })

  it('a review that was skipped (failed, timed out) never fails the run: the CV still lands, the reason is logged', async () => {
    mockReview.mockImplementation(async (input) => ({
      review: { skipped: true, skipReason: 'The review timed out, so the CV landed unreviewed.', model: null, tokens: { input: 300, output: 0 }, costUsd: 0.01, applied: [], discarded: [], concerns: [] },
      assembled: input.assembled, usage: NO_USAGE, notes: ['The review timed out, so the CV landed unreviewed.'],
    }))
    await runCvGenerationStages('run-1', 'p1')
    expect(mockFail).not.toHaveBeenCalled()
    expect(entry('review')).toMatchObject({ status: 'skipped', notes: ['The review timed out, so the CV landed unreviewed.'], tokens: { input: 300, output: 0 } })
    expect(mockLand).toHaveBeenCalledTimes(1)
    expect(mockUpdate.mock.calls.at(-1)![2]).toMatchObject({ status: 'complete' })
  })

  it('lands the REVIEWED markdown, stores it as the final assembled CV, logs applied and discarded edits, and refreshes the warnings', async () => {
    mockReview.mockImplementation(async (input) => ({
      review: {
        skipped: false, skipReason: null, model: 'm-review', tokens: { input: 900, output: 100 }, costUsd: 0.04,
        applied: [{ sectionId: 'experience:unity', bulletId: 'b1', action: 'replace', before: 'old bullet', after: 'new bullet', reason: 'unsupported figure', note: '' }],
        discarded: [{ sectionId: 'header', bulletId: null, action: 'remove', proposed: null, why: 'that section is rendered by code from your profile and is read-only', reason: 'x' }],
        concerns: [{ kind: 'evidence_gap', title: 'No evidence of X', why: 'w', question: 'q?', refs: [] }],
      },
      assembled: { ...input.assembled, markdown: `${input.assembled.markdown}\nEDITED\n` }, usage: NO_USAGE, notes: [],
    }))
    await runCvGenerationStages('run-1', 'p1')
    const data = mockUpdate.mock.calls.at(-1)![2]
    const finalMd = (data.assembled as { markdown: string }).markdown
    expect(finalMd).toContain('EDITED')
    expect(mockLand.mock.calls[0][2]).toBe(finalMd)
    expect(entry('review').notes.join('\n')).toMatch(/Applied 1 edit, discarded 1; 1 concern for the coach\./)
    expect(entry('review').notes.join('\n')).toMatch(/Applied: replace experience:unity b1/)
    expect(entry('review').notes.join('\n')).toMatch(/Discarded: remove header: that section is rendered by code/)
    expect((data.review as { concerns: unknown[] }).concerns).toHaveLength(1)
  })

  it('records the target document on the row as soon as it is known', async () => {
    mockLand.mockImplementation(async (_p, _j, _m, opts) => { await opts!.onTarget!('doc-7'); return { kind: 'landed', documentId: 'doc-7', created: false } })
    await runCvGenerationStages('run-1', 'p1')
    expect(mockUpdate).toHaveBeenCalledWith('p1', 'run-1', { writingDeskDocumentId: 'doc-7' })
    expect(mockUpdate.mock.calls.at(-1)![2]).toMatchObject({ status: 'complete', writingDeskDocumentId: 'doc-7' })
    expect(entry('land').notes.join(' ')).toMatch(/Reused the CV document/)
  })

  it('a draft that appeared meanwhile fails the run as draft_exists and keeps the generated markdown and review on the row', async () => {
    mockLand.mockResolvedValue({ kind: 'draft_exists', documentId: 'doc-9' })
    await runCvGenerationStages('run-1', 'p1')
    expect(mockFail).toHaveBeenCalledTimes(1)
    const [, , kind, , extra] = mockFail.mock.calls[0]
    expect(kind).toBe('draft_exists')
    const data = extra!.data as { assembled: { markdown: string }; review: unknown }
    expect(data.assembled.markdown).toContain('{{contact}}')
    expect(data.review).toBeDefined()
    expect((extra!.log as { entries: Array<{ stage: string; status: string }> }).entries.at(-1)).toMatchObject({ stage: 'land', status: 'failed' })
    expect(mockUpdate).not.toHaveBeenCalledWith('p1', 'run-1', expect.objectContaining({ status: 'complete' }))
  })

  it('fails as document_limit when Land hits the 10-document limit, keeping the CV', async () => {
    mockLand.mockResolvedValue({ kind: 'limit' })
    await runCvGenerationStages('run-1', 'p1')
    expect(mockFail).toHaveBeenCalledWith('p1', 'run-1', 'document_limit', null, expect.objectContaining({ data: expect.objectContaining({ assembled: expect.anything() }) }))
  })

  it('fails as document_limit BEFORE any model spend when the job is at its limit with no CV document to reuse', async () => {
    mockCheckLanding.mockResolvedValue({ kind: 'limit' })
    await runCvGenerationStages('run-1', 'p1')
    expect(mockFail).toHaveBeenCalledWith('p1', 'run-1', 'document_limit', null, expect.anything())
    expect(mockGather).not.toHaveBeenCalled()
    expect(mockBrief).not.toHaveBeenCalled()
  })

  it('startCvGeneration answers draft_exists before creating a run or spending anything', async () => {
    mockCheckLanding.mockResolvedValue({ kind: 'draft_exists', documentId: 'doc-3' })
    expect(await startCvGeneration('p1', 'job-1', {})).toEqual({ kind: 'draft_exists', documentId: 'doc-3' })
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockAfter).not.toHaveBeenCalled()
  })

  it('startCvGeneration passes the options to the run', async () => {
    mockCreate.mockResolvedValue({ kind: 'created', runId: 'run-5' })
    await startCvGeneration('p1', 'job-1', { fresh: true, review: false })
    await (mockAfter.mock.calls[0][0] as () => Promise<void>)()
    expect(mockReuse).not.toHaveBeenCalled()
    expect(mockReview).not.toHaveBeenCalled()
  })
})
