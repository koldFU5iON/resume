import { describe, expect, it } from 'vitest'
import {
  DeepDiveReportSchema,
  FindingSchema,
  StructuredFindingsSchema,
  flattenFindings,
  type ResearcherOutcome,
} from './schema'
import { modelReport } from './__fixtures__/inputs'

const ev = (over: Partial<Record<'kind' | 'quote' | 'ref' | 'text' | 'index', unknown>>) => ({
  kind: 'jd', quote: null, ref: null, text: null, index: null, ...over,
})

describe('DeepDiveReportSchema', () => {
  it('turns flat evidence into the Evidence union and drops entries missing their fields', () => {
    const report = DeepDiveReportSchema.parse(modelReport({
      strengths: [{
        point: 'Ran a platform team',
        evidence: [
          ev({ kind: 'jd', quote: ' lead a platform team ' }),
          ev({ kind: 'jd', quote: '  ' }),
          ev({ kind: 'profile', ref: 'Head of Platform — Acme', text: 'Led 8 engineers' }),
          ev({ kind: 'profile', ref: null, text: 'no ref' }),
          ev({ kind: 'finding', index: 2 }),
          ev({ kind: 'finding', index: -1 }),
          ev({ kind: 'finding', index: 1.5 }),
          ev({ kind: 'register' }),
        ],
      }],
    }))
    expect(report.strengths[0].evidence).toEqual([
      { kind: 'jd', quote: 'lead a platform team' },
      { kind: 'profile', ref: 'Head of Platform — Acme', text: 'Led 8 engineers' },
      { kind: 'finding', index: 2 },
      { kind: 'register' },
    ])
  })

  it('cuts over-long lists to the spec maximums instead of failing', () => {
    const blocker = { label: 'x', status: 'hard', fromEarlyAssessment: false, reason: 'r', evidence: [] }
    const report = DeepDiveReportSchema.parse(modelReport({
      blockers: Array(12).fill(blocker),
      questionsToAsk: Array(9).fill('Q?'),
      strengths: Array(8).fill({ point: 'p', evidence: Array(6).fill(ev({ kind: 'register' })) }),
    }))
    expect(report.blockers).toHaveLength(8)
    expect(report.questionsToAsk).toHaveLength(6)
    expect(report.strengths).toHaveLength(6)
    expect(report.strengths[0].evidence).toHaveLength(4)
  })

  it('rejects an unknown verdict', () => {
    expect(DeepDiveReportSchema.safeParse(modelReport({ verdict: 'maybe' })).success).toBe(false)
  })
})

describe('FindingSchema', () => {
  it('trims and cuts text, and reads blank optional text as null', () => {
    const f = FindingSchema.parse({
      topic: ' pay_band ', claim: 'x'.repeat(500), sourceUrl: '  ', quote: 'q'.repeat(400), publishedAt: null, confidence: 'high',
    })
    expect(f.topic).toBe('pay_band')
    expect(f.claim).toHaveLength(400)
    expect(f.sourceUrl).toBeNull()
    expect(f.quote).toHaveLength(300)
  })

  it('caps the structured list at 15', () => {
    const one = { topic: 't', claim: 'c', sourceUrl: null, quote: null, publishedAt: null, confidence: 'low' }
    expect(StructuredFindingsSchema.parse({ findings: Array(20).fill(one) }).findings).toHaveLength(15)
  })
})

describe('flattenFindings', () => {
  it('orders findings company, pay, practicalities and tags each with its researcher', () => {
    const f = (claim: string) => ({ topic: 't', claim, sourceUrl: null, quote: null, publishedAt: null, confidence: 'low' as const })
    const o = (claims: string[]): ResearcherOutcome => ({ status: 'ok', reason: null, findings: claims.map(f), model: 'm', sourceCount: 0 })
    const flat = flattenFindings({ practicalities: o(['p1']), company: o(['c1', 'c2']), pay: o([]) })
    expect(flat.map((x) => [x.researcher, x.claim])).toEqual([['company', 'c1'], ['company', 'c2'], ['practicalities', 'p1']])
  })
})
