import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: { cvGeneration: { findFirst: vi.fn() }, llmUsageLog: { findMany: vi.fn() } },
}))

import { prisma } from '@/lib/db'
import { CV_GENERATION_STALE_MS } from './schema'
import {
  STALE_RUN_MESSAGE, effectiveStatus, getCvGeneration, getLatestCvGeneration, isStaleRun, summarizeRunUsage, toCvGenerationView,
} from './queries'

const db = vi.mocked(prisma, { deep: true })

const NOW = new Date('2026-11-18T12:00:00.000Z')
const row = (over: Record<string, unknown> = {}) => ({
  id: 'run-1', jobApplicationId: 'job-1', writingDeskDocumentId: null, deepDiveId: null,
  status: 'writing', failureKind: null, failureMessage: null, stageTimings: null, log: null, brief: null, selection: null,
  createdAt: new Date(NOW.getTime() - 60_000), startedAt: null, completedAt: null,
  ...over,
})
const usageRow = (over: Record<string, unknown> = {}) => ({
  provider: 'anthropic', model: 'claude-sonnet-5-5', feature: 'cv-gen-brief',
  promptTokens: 1000, completionTokens: 200, cacheReadTokens: null, cacheWriteTokens: null, serverToolCalls: null,
  usageKnown: true, status: 'ok', errorKind: null, latencyMs: 900, cvDocumentId: null, runId: 'run-1',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.llmUsageLog.findMany.mockResolvedValue([])
})

describe('stale runs', () => {
  it('reads an active run older than the stale limit as failed / timeout', () => {
    const old = row({ createdAt: new Date(NOW.getTime() - CV_GENERATION_STALE_MS - 1) })
    expect(isStaleRun(old, NOW)).toBe(true)
    expect(effectiveStatus(old, NOW)).toBe('failed')
    const view = toCvGenerationView(old, summarizeRunUsage([]), NOW)
    expect(view).toMatchObject({ status: 'failed', failureKind: 'timeout', failureMessage: STALE_RUN_MESSAGE })
  })

  it('leaves a recent active run and any finished run alone', () => {
    expect(isStaleRun(row(), NOW)).toBe(false)
    const oldDone = row({ status: 'complete', createdAt: new Date(0) })
    expect(isStaleRun(oldDone, NOW)).toBe(false)
    expect(effectiveStatus(oldDone, NOW)).toBe('complete')
  })
})

describe('toCvGenerationView', () => {
  it('parses a stored log and timings, tolerating junk', () => {
    const view = toCvGenerationView(row({
      log: { entries: [{ stage: 'brief', model: 'm', durationMs: 5 }, { bad: true }] },
      stageTimings: { gather: 10, junk: 1 },
      failureKind: 'wat',
    }), summarizeRunUsage([]), NOW)
    expect(view.log.map((e) => e.stage)).toEqual(['brief'])
    expect(view.stageTimings).toEqual({ gather: 10 })
    expect(view.failureKind).toBeNull()
  })

  it('exposes the stored brief, selection and the preview flag, tolerating bad JSON', () => {
    const brief = {
      hiddenQuestion: 'Q', leadWith: ['a'], emphasise: [{ item: 'x', why: 'y' }], playDown: [], positioning: 'p', tone: 't',
      budgets: { experiences: 3, skills: 8, tools: 6, competencies: 4, certifications: 2, education: 2, projects: 1 },
    }
    const selection = { mode: 'model', experiences: [{ id: 'e1', label: 'PM — Acme', reason: 'recent' }] }
    const view = toCvGenerationView(row({ status: 'complete', brief, selection, log: { entries: [], partial: true } }), summarizeRunUsage([]), NOW)
    expect(view.partial).toBe(true)
    expect(view.brief?.hiddenQuestion).toBe('Q')
    expect(view.selection?.experiences[0]).toMatchObject({ id: 'e1', label: 'PM — Acme' })
    expect(view.selection?.skills).toEqual([])

    const bad = toCvGenerationView(row({ brief: 'nope', selection: { mode: 'x' }, log: [] }), summarizeRunUsage([]), NOW)
    expect(bad).toMatchObject({ partial: false, brief: null, selection: null })
  })

  it('exposes the assembled CV, and reads a run stored before it existed (no column) as none', () => {
    const assembled = { markdown: ':::header\n# A\n{{contact}}\n:::\n', sections: [{ id: 'header', kind: 'header', markdown: 'x' }], warnings: ['w'], checkNotes: [] }
    expect(toCvGenerationView(row({ assembled }), summarizeRunUsage([]), NOW).assembled).toEqual(assembled)
    expect(toCvGenerationView(row(), summarizeRunUsage([]), NOW).assembled).toBeNull()
    expect(toCvGenerationView(row({ assembled: { markdown: 5 } }), summarizeRunUsage([]), NOW).assembled).toBeNull()
  })

  it('exposes the review and the reuse source, and reads a run stored before Phase 4a (no columns) as none', () => {
    const review = { skipped: false, model: 'm', tokens: { input: 1, output: 1 }, costUsd: 0.01, applied: [], discarded: [], concerns: [{ kind: 'evidence_gap', title: 'T', why: 'w', question: 'q?', refs: [] }] }
    const view = toCvGenerationView(row({ status: 'complete', review, selectionReusedFromRunId: 'run-0' }), summarizeRunUsage([]), NOW)
    expect(view.review?.concerns).toHaveLength(1)
    expect(view.selectionReusedFromRunId).toBe('run-0')
    const old = toCvGenerationView(row(), summarizeRunUsage([]), NOW)
    expect(old.review).toBeNull()
    expect(old.selectionReusedFromRunId).toBeNull()
    expect(toCvGenerationView(row({ review: 'junk', selectionReusedFromRunId: undefined }), summarizeRunUsage([]), NOW)).toMatchObject({ review: null, selectionReusedFromRunId: null })
  })

  it('reads a stored log without section rows (written before phase 3) with empty sections', () => {
    const view = toCvGenerationView(row({ log: { entries: [{ stage: 'select', status: 'ok' }], partial: true } }), summarizeRunUsage([]), NOW)
    expect(view.log[0].sections).toEqual([])
  })

  it('treats an unknown stored status as failed', () => {
    expect(toCvGenerationView(row({ status: 'bogus' }), summarizeRunUsage([]), NOW).status).toBe('failed')
  })
})

describe('summarizeRunUsage', () => {
  it('totals the run and splits by feature', () => {
    const u = summarizeRunUsage([
      usageRow(),
      usageRow({ feature: 'cv-gen-write-experience', promptTokens: 4000, completionTokens: 900 }),
      usageRow({ feature: 'cv-gen-write-experience', promptTokens: 10, completionTokens: 10 }),
      usageRow({ feature: null }),
    ])
    expect(u.total.requests).toBe(4)
    expect(Object.keys(u.byFeature).sort()).toEqual(['cv-gen-brief', 'cv-gen-write-experience', 'unknown'])
    expect(u.byFeature['cv-gen-write-experience'].requests).toBe(2)
    expect(u.byFeature['cv-gen-write-experience'].inputTokens).toBe(4010)
  })

  it('is empty for a run with no calls', () => {
    expect(summarizeRunUsage([]).total.requests).toBe(0)
  })
})

describe('queries filter by profile', () => {
  it('getLatestCvGeneration scopes to profile and job, newest first, and sums that run’s usage', async () => {
    db.cvGeneration.findFirst.mockResolvedValue(row() as never)
    db.llmUsageLog.findMany.mockResolvedValue([usageRow()] as never)
    const view = await getLatestCvGeneration('p1', 'job-1')
    expect(db.cvGeneration.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId: 'p1', jobApplicationId: 'job-1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }))
    expect(db.llmUsageLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { profileId: 'p1', runId: 'run-1' } }))
    expect(view?.usage.total.requests).toBe(1)
  })

  it('returns null when the job has no run', async () => {
    db.cvGeneration.findFirst.mockResolvedValue(null)
    expect(await getLatestCvGeneration('p1', 'job-1')).toBeNull()
    expect(db.llmUsageLog.findMany).not.toHaveBeenCalled()
  })

  it('getCvGeneration looks a run up by id within the profile', async () => {
    db.cvGeneration.findFirst.mockResolvedValue(null)
    expect(await getCvGeneration('p1', 'run-9')).toBeNull()
    expect(db.cvGeneration.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'run-9', profileId: 'p1' } }))
  })
})
