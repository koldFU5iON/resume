import { describe, it, expect } from 'vitest'
import type { AssessmentView } from '@/modules/job-assessment/queries'
import type { Blocker } from '@/modules/job-assessment/schema'
import {
  blockerItems,
  canDeepAnalyse,
  earlyAriaLabel,
  earlyFilterKey,
  earlyHeading,
  earlyPillText,
  earlySortValue,
  earlyTone,
  enrichmentNote,
  failureSummary,
  footerLine,
  formatProcessTime,
  isAssessmentInProgress,
  parseEarlyFilter,
  yearsGapItems,
} from './early-assessment-view'

const view = (over: Partial<AssessmentView> = {}): AssessmentView => ({
  id: 'a1',
  jobId: 'job-1',
  status: 'complete',
  level: 'pursue',
  score: 7,
  blocked: false,
  blockers: [],
  strengths: [],
  gaps: [],
  unsettled: [],
  notes: [],
  enrichedFields: [],
  descriptionReplaced: false,
  failureKind: null,
  failureReasons: [],
  jevModel: 'jev-1.14.0',
  pipelineVersion: 'early-v1',
  processTimeMs: 4200,
  completedAt: null,
  createdAt: new Date('2026-11-10T12:00:00Z'),
  ...over,
})

describe('isAssessmentInProgress', () => {
  it.each(['queued', 'checking', 'fetching', 'assessing'] as const)('%s is in progress', (status) => {
    expect(isAssessmentInProgress(view({ status }))).toBe(true)
  })
  it('complete, failed and missing runs are not', () => {
    expect(isAssessmentInProgress(view())).toBe(false)
    expect(isAssessmentInProgress(view({ status: 'failed' }))).toBe(false)
    expect(isAssessmentInProgress(null)).toBe(false)
    expect(isAssessmentInProgress(undefined)).toBe(false)
  })
})

describe('earlyFilterKey', () => {
  it('maps each state to its filter bucket', () => {
    expect(earlyFilterKey(null)).toBe('none')
    expect(earlyFilterKey(view({ status: 'queued', level: null, score: null }))).toBe('none')
    expect(earlyFilterKey(view({ status: 'failed', level: null }))).toBe('attention')
    expect(earlyFilterKey(view({ blocked: true }))).toBe('blocked')
    expect(earlyFilterKey(view({ level: 'priority' }))).toBe('priority')
    expect(earlyFilterKey(view({ level: 'weak' }))).toBe('weak')
  })
})

describe('parseEarlyFilter', () => {
  it('keeps known keys only', () => {
    expect([...parseEarlyFilter(['pursue', 'blocked', 'bogus', 3])]).toEqual(['pursue', 'blocked'])
    expect(parseEarlyFilter(undefined).size).toBe(0)
    expect(parseEarlyFilter('pursue').size).toBe(0)
  })
})

describe('earlySortValue', () => {
  it('orders unblocked by score, then blocked by score, then everything else', () => {
    const items = [
      view({ id: 'none', status: 'queued', score: null }),
      view({ id: 'b9', blocked: true, score: 9 }),
      view({ id: 'p6', score: 6 }),
      view({ id: 'f', status: 'failed', score: null }),
      view({ id: 'w2', score: 2, level: 'weak' }),
      view({ id: 'b3', blocked: true, score: 3 }),
    ]
    const sorted = [...items].sort((a, b) => earlySortValue(b) - earlySortValue(a)).map((v) => v.id)
    expect(sorted.slice(0, 4)).toEqual(['p6', 'w2', 'b9', 'b3'])
    expect(earlySortValue(null)).toBe(-1)
  })
})

describe('pill text, tone, heading and aria-label', () => {
  it('complete', () => {
    const v = view()
    expect(earlyPillText(v)).toBe('7/10')
    expect(earlyTone(v)).toBe('pursue')
    expect(earlyHeading(v)).toBe('Pursue')
    expect(earlyAriaLabel(v)).toBe('Early assessment: pursue, 7 out of 10. Click for details.')
  })
  it('blocked', () => {
    const v = view({ blocked: true })
    expect(earlyPillText(v)).toBe('Blocked · 7/10')
    expect(earlyTone(v)).toBe('blocked')
    expect(earlyHeading(v)).toBe('Blocked')
    expect(earlyAriaLabel(v, 'Tap')).toBe('Early assessment: blocked, 7 out of 10. Tap for details.')
  })
  it('failed', () => {
    expect(earlyAriaLabel(view({ status: 'failed', score: null }))).toBe('Early assessment: needs attention. Click for details.')
  })
})

describe('blocker sections', () => {
  const blockers: Blocker[] = [
    { kind: 'pay', severity: 'unconfirmed', label: 'Pay range straddles your floor' },
    { kind: 'years', severity: 'warn', label: 'Short on years (~3.7 of 5): biz ops', detail: '~3.7 yrs: A 2.3 + B 0.7' },
    { kind: 'credential', severity: 'hard', label: 'Missing requirement: BSc' },
    { kind: 'years', severity: 'stretch', label: 'Short on years (~2.0 of 5) — strong transferable experience across your CV' },
    { kind: 'work_rights', severity: 'hard', label: 'Needs sponsorship for US' },
  ]
  it('blockers: hard first (stored order), then unconfirmed; no years warn/stretch', () => {
    expect(blockerItems(blockers).map((b) => b.label)).toEqual([
      'Missing requirement: BSc', 'Needs sponsorship for US', 'Pay range straddles your floor',
    ])
  })
  it('years gaps: warn and stretch with their detail', () => {
    expect(yearsGapItems(blockers).map((b) => b.severity)).toEqual(['warn', 'stretch'])
    expect(yearsGapItems(blockers)[0].detail).toBe('~3.7 yrs: A 2.3 + B 0.7')
  })
})

describe('canDeepAnalyse', () => {
  it('pursue or priority and not blocked', () => {
    expect(canDeepAnalyse(view())).toBe(true)
    expect(canDeepAnalyse(view({ level: 'priority' }))).toBe(true)
    expect(canDeepAnalyse(view({ level: 'consider' }))).toBe(false)
    expect(canDeepAnalyse(view({ blocked: true }))).toBe(false)
    expect(canDeepAnalyse(view({ status: 'failed' }))).toBe(false)
  })
})

describe('formatProcessTime / footerLine', () => {
  it.each([
    [850, '850ms'],
    [4200, '4.2s'],
    [59_940, '59.9s'],
    [65_000, '1m 05s'],
  ])('%i ms → %s', (ms, out) => {
    expect(formatProcessTime(ms)).toBe(out)
  })
  it('builds the footer and leaves out missing parts', () => {
    expect(footerLine(view())).toBe('jev-1.14.0 · early-v1 · assessed in 4.2s')
    expect(footerLine(view({ jevModel: null, processTimeMs: null }))).toBe('early-v1')
    expect(footerLine(view({ status: 'failed', jevModel: null, processTimeMs: 1500 }))).toBe('early-v1 · stopped after 1.5s')
  })
})

describe('failureSummary', () => {
  it('has a plain line per kind', () => {
    expect(failureSummary('verification')).toMatch(/too thin/)
    expect(failureSummary('daily_cap')).toMatch(/tomorrow/)
    expect(failureSummary(null)).toBeNull()
  })
})

describe('enrichmentNote', () => {
  it('says when the description was replaced', () => {
    expect(enrichmentNote(view({ descriptionReplaced: true, enrichedFields: ['jobDescription (replaced truncated)'] })))
      .toMatch(/replaced with the full text from the job page/)
  })
  it('lists other filled fields', () => {
    expect(enrichmentNote(view({ enrichedFields: ['company', 'salaryBand'] }))).toBe('Filled in from the job page: company, salary band.')
  })
  it('is null when nothing came from the page', () => {
    expect(enrichmentNote(view())).toBeNull()
  })
})
