import { describe, expect, it } from 'vitest'
import { JobAnalysisSchema } from '@/modules/jobs/schema'
import { modelReport } from './__fixtures__/inputs'
import { JOB_ANALYSIS_CAPS, reportToJobAnalysis } from './job-analysis'
import { DeepDiveReportSchema } from './schema'

const ev = [{ kind: 'jd', ref: 'quoted', detail: '' }]

function report(over: Record<string, unknown> = {}) {
  return DeepDiveReportSchema.parse(modelReport(over))
}

const facts = {
  requirements: [
    { text: '5+ years running platform teams', kind: 'experience', importance: 'must' },
    { text: 'Kubernetes', kind: 'skill', importance: 'must' },
    { text: 'Fintech background', kind: 'domain', importance: 'nice' },
    { text: 'kubernetes', kind: 'skill', importance: 'nice' },
    { text: '', kind: 'skill', importance: 'must' },
    { nonsense: true },
  ],
}

describe('reportToJobAnalysis', () => {
  it('takes must and nice requirements from the early assessment facts, de-duplicated', () => {
    const a = reportToJobAnalysis(report(), facts, null)!
    expect(a.mustHave).toEqual(['5+ years running platform teams', 'Kubernetes'])
    expect(a.niceToHave).toEqual(['Fintech background'])
    expect(JobAnalysisSchema.parse(a)).toEqual(a)
  })

  it('without facts, keeps the existing analysis requirements and adds open blockers and gaps', () => {
    const existing = { mustHave: ['Pricing strategy'], niceToHave: ['Marketplaces'], risks: [], positioningStrategy: 'Old.' }
    const a = reportToJobAnalysis(report({
      blockers: [
        { label: 'Right to work in the UK', status: 'confirm_with_recruiter', fromEarlyAssessment: true, reason: 'Ad is unclear.', evidence: ev },
        { label: 'Security clearance', status: 'cleared', fromEarlyAssessment: true, reason: 'Not required.', evidence: [] },
      ],
      gaps: [{ requirement: 'Go experience', closability: 'closable_later', action: 'Ship a Go service.', weeksToClose: 6, evidence: [] }],
    }), null, existing)!
    expect(a.mustHave).toEqual(['Pricing strategy', 'Right to work in the UK', 'Go experience'])
    expect(a.niceToHave).toEqual(['Marketplaces'])
    expect(a.positioningStrategy).toBe('Lead with delivery.')
  })

  it('returns null with neither facts nor an existing analysis, so CV generation runs analyseJob', () => {
    expect(reportToJobAnalysis(report({
      gaps: [{ requirement: 'Go experience', closability: 'closable_later', action: 'Ship it.', weeksToClose: 6, evidence: [] }],
    }), null, null)).toBeNull()
    expect(reportToJobAnalysis(report(), { requirements: [] }, null)).toBeNull()
  })

  it('turns open blockers and gaps into risks, most serious first', () => {
    const a = reportToJobAnalysis(report({
      blockers: [
        { label: 'Right to work', status: 'confirm_with_recruiter', fromEarlyAssessment: true, reason: 'Ad is unclear.', evidence: [] },
        { label: 'Clearance', status: 'cleared', fromEarlyAssessment: false, reason: 'Fine.', evidence: [] },
      ],
      gaps: [
        { requirement: 'Add metrics', closability: 'closable_now', action: 'Add the 40% figure.', weeksToClose: null, evidence: [] },
        { requirement: 'PhD', closability: 'not_closable', action: 'None.', weeksToClose: null, evidence: [] },
      ],
    }), facts, null)!
    expect(a.risks.map((r) => [r.risk, r.severity])).toEqual([
      ['PhD', 'high'],
      ['Right to work', 'medium'],
      ['Add metrics', 'low'],
    ])
    expect(a.risks[1].recommendation).toBe('Confirm with the recruiter. Ad is unclear.')
  })

  it('keeps the lists within the #362 caps', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ text: `Req ${i}`, importance: i % 2 ? 'nice' : 'must' }))
    const gaps = Array.from({ length: 10 }, (_, i) => ({ requirement: `Gap ${i}`, closability: 'closable_later', action: 'Do it.', weeksToClose: 4, evidence: [] }))
    const a = reportToJobAnalysis(report({ gaps }), { requirements: many }, null)!
    expect(a.mustHave).toHaveLength(JOB_ANALYSIS_CAPS.mustHave)
    expect(a.niceToHave).toHaveLength(JOB_ANALYSIS_CAPS.niceToHave)
    expect(a.risks).toHaveLength(JOB_ANALYSIS_CAPS.risks)
  })

  it('builds the positioning strategy from the CV strategy', () => {
    const a = reportToJobAnalysis(report({
      cvStrategy: { leadWith: ['Platform migration', 'Team of 12'], emphasise: [], playDown: ['Agency years'], positioning: 'A platform lead who ships.' },
    }), facts, null)!
    expect(a.positioningStrategy).toBe('A platform lead who ships. Lead with: Platform migration; Team of 12. Play down: Agency years.')
  })
})
