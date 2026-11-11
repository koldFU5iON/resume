import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('./gather', () => ({ currentInputsHash: vi.fn() }))

import { summarizeRows } from '@/modules/llm/job-cost'
import { DeepDiveReportSchema } from './schema'
import { modelReport } from './__fixtures__/inputs'
import { STALE_RUN_MESSAGE, isStaleRun, parseReport, toDeepDiveView } from './queries'

const now = new Date('2026-11-11T12:00:00Z')
const usage = summarizeRows([])

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'dd-1', jobApplicationId: 'job-1', status: 'complete', failureKind: null, failureMessage: null,
    verdict: 'apply', worthTailoredCv: true, report: DeepDiveReportSchema.parse(modelReport({ verdict: 'apply' })),
    research: null, researchModel: 'r', synthesisModel: 's', sourceAssessmentId: null, inputsHash: 'h1',
    stageTimings: null, createdAt: new Date(now.getTime() - 60_000), startedAt: null, completedAt: now,
    ...over,
  }
}

describe('toDeepDiveView', () => {
  it('reads a run stuck in an active status for over 10 minutes as failed / timeout', () => {
    const stuck = row({ status: 'researching', report: null, createdAt: new Date(now.getTime() - 11 * 60_000) })
    expect(isStaleRun(stuck, now)).toBe(true)
    expect(toDeepDiveView(stuck, usage, undefined, now)).toMatchObject({
      status: 'failed', failureKind: 'timeout', failureMessage: STALE_RUN_MESSAGE, report: null,
    })
  })

  it('keeps a recent active run as it is', () => {
    const running = row({ status: 'synthesising', report: null })
    expect(toDeepDiveView(running, usage, undefined, now)).toMatchObject({ status: 'synthesising', outOfDate: null })
  })

  it('flags a complete run whose inputs changed', () => {
    expect(toDeepDiveView(row(), usage, 'h1', now).outOfDate).toBe(false)
    expect(toDeepDiveView(row(), usage, 'h2', now).outOfDate).toBe(true)
    // The job can no longer be deep-dived (e.g. description removed): out of date.
    expect(toDeepDiveView(row(), usage, null, now).outOfDate).toBe(true)
  })

  it('returns the stored report for complete runs only', () => {
    expect(toDeepDiveView(row(), usage, 'h1', now).report?.verdict).toBe('apply')
    expect(toDeepDiveView(row({ status: 'failed' }), usage, undefined, now).report).toBeNull()
  })
})

describe('parseReport', () => {
  it('accepts a stored (already transformed) report and rejects junk', () => {
    expect(parseReport(DeepDiveReportSchema.parse(modelReport()))).not.toBeNull()
    expect(parseReport({ verdict: 'nope' })).toBeNull()
    expect(parseReport(null)).toBeNull()
    expect(parseReport([])).toBeNull()
  })
})
