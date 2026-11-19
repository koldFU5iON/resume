import { describe, expect, it } from 'vitest'
import { combineImpact, formatResult, parseResult, ResultInputSchema } from './result'

const r = { measure: 'asset turnaround time', value: '1 hour', baseline: '3 weeks', period: 'Q3 2023' }

describe('ResultInputSchema', () => {
  it('trims, and turns empty optional fields into null', () => {
    expect(ResultInputSchema.parse({ measure: ' reach ', value: ' 2M ', baseline: '  ', period: undefined })).toEqual({
      measure: 'reach', value: '2M', baseline: null, period: null,
    })
  })
  it('requires a measure and a value', () => {
    expect(ResultInputSchema.safeParse({ measure: '', value: '1' }).success).toBe(false)
    expect(ResultInputSchema.safeParse({ measure: 'reach', value: ' ' }).success).toBe(false)
  })
})

describe('parseResult', () => {
  it('reads a stored value and tolerates junk', () => {
    expect(parseResult(r)).toEqual(r)
    expect(parseResult(null)).toBeNull()
    expect(parseResult({ nonsense: true })).toBeNull()
    expect(parseResult('3 weeks')).toBeNull()
  })
})

describe('formatResult', () => {
  it('writes baseline and period only when present', () => {
    expect(formatResult(r)).toBe('asset turnaround time: 1 hour (from 3 weeks), Q3 2023')
    expect(formatResult({ ...r, baseline: null, period: null })).toBe('asset turnaround time: 1 hour')
  })
})

describe('combineImpact', () => {
  it('is the free text when there is no result', () => {
    expect(combineImpact(' cut release time ', null)).toBe('cut release time')
    expect(combineImpact(null, null)).toBeNull()
  })
  it('is the result alone when there is no free text', () => {
    expect(combineImpact(null, r)).toBe('asset turnaround time: 1 hour (from 3 weeks), Q3 2023')
  })
  it('drops free text that only restates the result figures', () => {
    expect(combineImpact('Cut from 3 weeks to 1 hour', r)).toBe(formatResult(r))
  })
  it('keeps free text with a figure the result lacks, and text with no figure', () => {
    expect(combineImpact('saved 40 hours a month', r)).toBe(`${formatResult(r)}; saved 40 hours a month`)
    expect(combineImpact('praised by the VP', r)).toBe(`${formatResult(r)}; praised by the VP`)
  })
})
