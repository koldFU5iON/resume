import { describe, expect, it } from 'vitest'
import { validateDraftMarkdown } from '@/modules/writing-desk/validate'
import { checkLetter, findCliches, figuresIn, isFactSupported, letterMarkdown, unsupportedFigures, wordCount } from './checks'

const words = (n: number) => Array.from({ length: n }, () => "steady").join(" ")

describe('findCliches', () => {
  it('finds generic phrases regardless of case and curly apostrophes', () => {
    expect(findCliches('I’m excited to apply. I am a Team Player who is passionate about results.')).toEqual(["i'm excited to apply", 'team player', 'passionate about'])
  })
  it('does not match inside other words', () => {
    expect(findCliches('A dynamic steam player')).toEqual([])
  })
})

describe('figures', () => {
  it('reads multi-digit figures and ignores single digits', () => {
    expect(figuresIn('Cut costs 40% across 3 teams and 14,000 users in 2021; £1.2m saved.')).toEqual(['40', '14000', '2021', '1.2'])
  })
  it('flags figures no source contains, ignoring thousands separators', () => {
    expect(unsupportedFigures('Grew 14,000 users and 35% revenue', ['grew to 14000 users'])).toEqual(['35'])
  })
})

describe('isFactSupported', () => {
  const sources = ['The company builds payment infrastructure for small retailers across Europe.']
  it('accepts a fact whose content words are in the sources', () => {
    expect(isFactSupported('builds payment infrastructure for small retailers', sources)).toBe(true)
  })
  it('rejects a fact the sources do not contain', () => {
    expect(isFactSupported('recently raised a Series C from a large investor', sources)).toBe(false)
  })
})

describe('letterMarkdown and checkLetter', () => {
  const out = { salutation: 'Dear Hiring Team,', paragraphs: [words(90), words(90), words(80)], closing: 'Kind regards,' }

  it('builds desk Markdown with the name and the {{contact}} placeholder, and the desk accepts it', () => {
    const md = letterMarkdown('Jane Doe', out)
    expect(md.startsWith(':::header\n# Jane Doe\n{{contact}}\n:::\n\nDear Hiring Team,')).toBe(true)
    expect(md.endsWith('Kind regards,\n\nJane Doe')).toBe(true)
    expect(validateDraftMarkdown(md).ok).toBe(true)
  })

  it('passes a letter within its length with no clichés or unsupported figures', () => {
    expect(checkLetter('Jane Doe', out, { length: 'short', sources: [] })).toEqual({ hard: [], soft: [], why: [] })
    expect(wordCount(out.paragraphs)).toBe(260)
  })

  it('reports length, clichés and figures as soft problems', () => {
    const bad = { ...out, paragraphs: ['I am writing to apply. I grew revenue 45%.', words(20), words(20)] }
    const result = checkLetter('Jane Doe', bad, { length: 'standard', sources: ['revenue grew 30%'] })
    expect(result.hard).toEqual([])
    expect(result.why).toEqual([expect.stringMatching(/^\d+ words \(270-420\)$/), 'generic phrases: i am writing to apply', 'figures not in sources: 45'])
  })
})
