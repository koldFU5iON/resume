import { describe, expect, it } from 'vitest'
import { EXPERIENCE_TOKENS, PROJECT_EVIDENCE_MAX_CHARS, THIN_PROJECT_MIN_CHARS, capProjectText, experienceTokenCaps, isThinProject } from './limits'

describe('experienceTokenCaps', () => {
  it('scales with the bullet allowance and the retry is larger', () => {
    const small = experienceTokenCaps(2, false)
    const big = experienceTokenCaps(6, false)
    expect(big.first).toBeGreaterThan(small.first)
    expect(small.retry).toBeGreaterThan(small.first)
    expect(big.first).toBe(EXPERIENCE_TOKENS.base + 6 * EXPERIENCE_TOKENS.perBullet)
  })
  it('is well above the fixed 1,500 that truncated a six-bullet entry on the first real run', () => {
    expect(experienceTokenCaps(6, false).first).toBeGreaterThan(1_500)
    expect(experienceTokenCaps(1, false).first).toBeGreaterThan(1_500)
  })
  it('an employer with project evidence starts at the larger cap', () => {
    const c = experienceTokenCaps(6, true)
    expect(c.first).toBe(c.retry)
    expect(c.first).toBeGreaterThan(experienceTokenCaps(6, false).first)
  })
  it('never exceeds the maximum', () => {
    const c = experienceTokenCaps(40, true)
    expect(c.first).toBeLessThanOrEqual(EXPERIENCE_TOKENS.max)
    expect(c.retry).toBeLessThanOrEqual(EXPERIENCE_TOKENS.max)
  })
})

describe('capProjectText', () => {
  it('leaves a short text alone', () => {
    expect(capProjectText('Short text.')).toBe('Short text.')
  })
  it('cuts a long text at a word boundary within the cap, with an ellipsis', () => {
    const text = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ')
    const out = capProjectText(text)
    expect(out.length).toBeLessThanOrEqual(PROJECT_EVIDENCE_MAX_CHARS + 1)
    expect(out.endsWith('…')).toBe(true)
    expect(out.slice(0, -1).split(' ').every((w) => /^word\d+$/.test(w))).toBe(true)
  })
})

describe('isThinProject', () => {
  const N = 'Enemies Demo Campaign'
  it('a title-only project is thin: empty text, the name alone, the name with punctuation', () => {
    for (const text of ['', N, `${N}:`, `  ${N} - `, `${N.toUpperCase()}.`]) expect(isThinProject({ name: N, text })).toBe(true)
  })
  it('the name repeated in the text does not count as detail', () => {
    expect(isThinProject({ name: N, text: `${N}. ${N}: ${N}` })).toBe(true)
  })
  it('a project with a real description is not thin', () => {
    expect(isThinProject({ name: N, text: 'Ran the demo campaign for the new title: a go-to-market and launch-timing decision, reaching 14,000+ players.' })).toBe(false)
  })
  it('the threshold is on the characters beyond the name', () => {
    expect(isThinProject({ name: N, text: 'x'.repeat(THIN_PROJECT_MIN_CHARS - 1) })).toBe(true)
    expect(isThinProject({ name: N, text: 'x'.repeat(THIN_PROJECT_MIN_CHARS) })).toBe(false)
  })
})
