import { describe, expect, it } from 'vitest'
import { deepDiveHref, deepDiveSignature, formatMoney, formatRunCost, hostOf, researchNote, stageIndex } from './deep-dive-view'

describe('deep-dive-view', () => {
  it('polls only while a run is active', () => {
    expect(deepDiveSignature({ id: 'a', status: 'researching' })).toBe('a:researching')
    expect(deepDiveSignature({ id: 'a', status: 'complete' })).toBe('')
    expect(deepDiveSignature(null)).toBe('')
  })

  it('orders stages', () => {
    expect(stageIndex('queued')).toBe(-1)
    expect(stageIndex('gathering')).toBe(0)
    expect(stageIndex('synthesising')).toBe(2)
    expect(stageIndex('complete')).toBe(3)
  })

  it('says nothing for a tested provider and is honest about the others', () => {
    expect(researchNote({ research: 'tested', providerName: 'Anthropic' })).toBeNull()
    expect(researchNote({ research: 'untested', providerName: 'OpenAI' })).toContain("With OpenAI, web research runs but hasn't been tested")
    expect(researchNote({ research: 'none', providerName: 'Mistral' })).toMatch(/^No web research with your provider/)
  })

  it('formats links, money and cost', () => {
    expect(deepDiveHref('j1')).toBe('/dashboard/job-applications/view/j1/deep-dive')
    expect(deepDiveHref('j1', 'r 1')).toBe('/dashboard/job-applications/view/j1/deep-dive?run=r%201')
    expect(formatMoney(85000, 'GBP')).toBe('£85,000')
    expect(formatMoney(85000, 'XX')).toBe('85,000 XX')
    expect(formatRunCost(0.744, true)).toBe('$0.74')
    expect(formatRunCost(0.004, false)).toBe('under $0.01 + web searches')
    expect(hostOf('https://www.monzo.com/careers')).toBe('monzo.com')
    expect(hostOf('not a url')).toBeNull()
  })
})
