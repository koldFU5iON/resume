import { describe, expect, it } from 'vitest'
import {
  bucketForRating, compareAll, compareJob, csvField, readJobFit, spearman, toCsv, type CompareJob,
} from './compare'

const job = (over: Partial<CompareJob> & { id: string }): CompareJob => ({
  title: `Job ${over.id}`, company: 'Acme', jobFit: null, assessment: null, ...over,
})
const fit = (rating: number) => ({ rating, label: 'solid' })
const early = (score: number, level: 'weak' | 'consider' | 'pursue' | 'priority', blocked = false) => ({ score, level, blocked })

describe('bucketForRating', () => {
  it('maps onto the 1-2 / 3-4 / 5-7 / 8-10 ladder', () => {
    expect([0, 1, 2, 3, 4, 5, 7, 8, 10].map(bucketForRating)).toEqual([
      'weak', 'weak', 'weak', 'consider', 'consider', 'pursue', 'pursue', 'priority', 'priority',
    ])
  })
  it('rounds fractional ratings', () => {
    expect(bucketForRating(4.6)).toBe('pursue')
    expect(bucketForRating(7.4)).toBe('pursue')
    expect(bucketForRating(7.5)).toBe('priority')
  })
})

describe('readJobFit', () => {
  it('reads valid shapes and rejects junk', () => {
    expect(readJobFit({ rating: 6, label: 'stretch' })).toEqual({ rating: 6, label: 'stretch' })
    expect(readJobFit({ rating: 6 })).toEqual({ rating: 6, label: null })
    expect(readJobFit(null)).toBeNull()
    expect(readJobFit({ rating: 'high' })).toBeNull()
    expect(readJobFit('x')).toBeNull()
  })
})

describe('compareJob flags', () => {
  it('flags buckets two or more steps apart', () => {
    const r = compareJob(job({ id: 'a', jobFit: fit(9), assessment: early(3, 'consider') }))
    expect(r.bucketGap).toBe(2)
    expect(r.disagreement).toBe(true)
  })
  it('does not flag adjacent buckets', () => {
    const r = compareJob(job({ id: 'a', jobFit: fit(6), assessment: early(3, 'consider') }))
    expect(r.bucketGap).toBe(1)
    expect(r.disagreement).toBe(false)
  })
  it('flags blocked against pursue or priority even when adjacent', () => {
    const r = compareJob(job({ id: 'a', jobFit: fit(6), assessment: early(4, 'consider', true) }))
    expect(r.bucketGap).toBe(1)
    expect(r.disagreement).toBe(true)
    expect(r.reasons[0]).toMatch(/blocked/)
  })
  it('does not flag blocked against weak or consider', () => {
    expect(compareJob(job({ id: 'a', jobFit: fit(3), assessment: early(3, 'consider', true) })).disagreement).toBe(false)
  })
  it('never flags a one-sided job', () => {
    const r = compareJob(job({ id: 'a', jobFit: fit(9) }))
    expect(r.earlyScore).toBeNull()
    expect(r.bucketGap).toBeNull()
    expect(r.disagreement).toBe(false)
  })
})

describe('spearman', () => {
  it('is 1 for the same order and -1 for the reverse', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1)
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1)
  })
  it('handles ties with average ranks', () => {
    // ranks x: 1.5,1.5,3,4 ; y: 1,2,3,4
    expect(spearman([1, 1, 2, 3], [1, 2, 3, 4])).toBeCloseTo(0.9487, 3)
  })
  it('is null with too few pairs or no variance', () => {
    expect(spearman([1], [1])).toBeNull()
    expect(spearman([], [])).toBeNull()
    expect(spearman([2, 2, 2], [1, 2, 3])).toBeNull()
  })
})

describe('compareAll', () => {
  const jobs = [
    job({ id: 'ok', title: 'B ok', jobFit: fit(7), assessment: early(6, 'pursue') }),
    job({ id: 'big', title: 'A big', jobFit: fit(9), assessment: early(2, 'weak') }),
    job({ id: 'blk', title: 'C blk', jobFit: fit(6), assessment: early(4, 'consider', true) }),
    job({ id: 'fitonly', title: 'D fit', jobFit: fit(5) }),
    job({ id: 'none', title: 'E none' }),
  ]
  const { rows, summary } = compareAll(jobs)

  it('lists disagreements first, largest gap first', () => {
    expect(rows.map((r) => r.id)).toEqual(['big', 'blk', 'ok', 'fitonly', 'none'])
  })
  it('summarises levels, diff and correlation', () => {
    expect(summary.jobs).toBe(5)
    expect(summary.paired).toBe(3)
    expect(summary.disagreements).toBe(2)
    expect(summary.earlyBlocked).toBe(1)
    expect(summary.fitLevels).toEqual({ weak: 0, consider: 0, pursue: 3, priority: 1 })
    expect(summary.earlyLevels).toEqual({ weak: 1, consider: 1, pursue: 1, priority: 0 })
    // |7-6| + |9-2| + |6-4| = 10 over 3
    expect(summary.meanAbsScoreDiff).toBeCloseTo(10 / 3)
    expect(summary.spearman).not.toBeNull()
  })
  it('handles no jobs', () => {
    const e = compareAll([])
    expect(e.rows).toEqual([])
    expect(e.summary.meanAbsScoreDiff).toBeNull()
    expect(e.summary.spearman).toBeNull()
  })
})

describe('csv', () => {
  it('quotes and neutralises formulas', () => {
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvField(null)).toBe('')
    expect(csvField(7)).toBe('7')
  })
  it('writes a header and one line per row', () => {
    const { rows } = compareAll([job({ id: 'a', jobFit: fit(9), assessment: early(2, 'weak') })])
    const lines = toCsv(rows).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0].startsWith('title,company')).toBe(true)
    expect(lines[1]).toContain('priority')
  })
})
