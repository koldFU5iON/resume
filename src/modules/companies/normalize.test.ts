import { describe, it, expect } from 'vitest'
import { isPlaceholderCompany, normalizeCompanyName, parseCompanyName } from './normalize'

describe('normalizeCompanyName', () => {
  it.each([
    ['Google UK Limited', 'google'],
    ['Deloitte LLP', 'deloitte'],
    ['Amazon UK Services Ltd.', 'amazon uk services'],
    ['The Village Surgery', 'village surgery'],
    ['VS Food & Wine', 'vs food and wine'],
    ['Smith & Co Ltd', 'smith'],
    ['  BRITANNIA   BUSINESS CONSULTING LIMITED ', 'britannia business consulting'],
    ['Société Générale S.A.', 'societe generale'],
    ["McDonald's Restaurants Ltd", 'mcdonalds restaurants'],
    ['Siemens AG', 'siemens'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeCompanyName(raw)).toBe(expected)
  })

  it('keeps a name made only of suffixes rather than emptying it', () => {
    expect(normalizeCompanyName('Limited')).toBe('limited')
    expect(normalizeCompanyName('The')).toBe('the')
  })

  it('returns an empty key for blank input', () => {
    expect(normalizeCompanyName('')).toBe('')
    expect(normalizeCompanyName(null)).toBe('')
    expect(normalizeCompanyName(' — ')).toBe('')
  })
})

describe('isPlaceholderCompany', () => {
  it('spots names that stand for no company', () => {
    for (const p of ['(unknown)', 'Unknown', 'N/A', 'Confidential', '', null, 'Undisclosed Ltd']) {
      expect(isPlaceholderCompany(p)).toBe(true)
    }
    expect(isPlaceholderCompany('Acme Ltd')).toBe(false)
  })
})

describe('parseCompanyName', () => {
  it('splits a trading name into an alias', () => {
    expect(parseCompanyName('BRANOS OXFORD LTD T/A LILO')).toEqual({ normalizedName: 'branos oxford', aliases: ['lilo'] })
    expect(parseCompanyName('Acme Limited trading as Acme Labs')).toEqual({ normalizedName: 'acme', aliases: ['acme labs'] })
  })

  it('has no aliases for a plain name or a trading name equal to the legal one', () => {
    expect(parseCompanyName('Acme Ltd')).toEqual({ normalizedName: 'acme', aliases: [] })
    expect(parseCompanyName('Acme Ltd T/A Acme')).toEqual({ normalizedName: 'acme', aliases: [] })
  })
})
