import { describe, it, expect } from 'vitest'
import {
  findRegisterCsvUrl,
  licenceRating,
  parseCsv,
  parseRegisterCsv,
  RegisterFormatError,
} from './sponsor-register'

const HEADER = 'Organisation Name,Town/City,County,Type & Rating,Route'

describe('findRegisterCsvUrl', () => {
  it('finds the worker register CSV link on the gov.uk page', () => {
    const html = `<a href="https://assets.publishing.service.gov.uk/media/x/Other.pdf">pdf</a>
      <a class="govuk-link" href="https://assets.publishing.service.gov.uk/media/6af/SP_-_Worker_and_Temporary_Worker_Web_Register_-_2026-11-11.csv">CSV</a>`
    expect(findRegisterCsvUrl(html)).toBe(
      'https://assets.publishing.service.gov.uk/media/6af/SP_-_Worker_and_Temporary_Worker_Web_Register_-_2026-11-11.csv',
    )
  })

  it('returns null when there is no CSV', () => {
    expect(findRegisterCsvUrl('<p>nothing</p>')).toBeNull()
  })
})

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, embedded commas/newlines, CRLF and a BOM', () => {
    const text = '﻿a,b\r\n"x, y","say ""hi"""\r\n"multi\nline",z\n\n'
    expect(parseCsv(text)).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['multi\nline', 'z']])
  })

  it('keeps a last row without a trailing newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('parseRegisterCsv', () => {
  const csv = [
    HEADER,
    ' Asian African Foods Ltd , London  ,,Worker (A rating),Skilled Worker',
    'Acme Ltd,Leeds,West Yorkshire,Worker (B rating),Charity Worker ',
    'Acme Ltd,Leeds,West Yorkshire,Worker (B rating),Charity Worker',
    ',Nowhere,,Worker (A rating),Skilled Worker',
  ].join('\n')

  it('trims values, drops nameless rows and exact duplicates', () => {
    expect(parseRegisterCsv(csv, 1)).toEqual([
      { orgName: 'Asian African Foods Ltd', townCity: 'London', county: null, typeRating: 'Worker (A rating)', route: 'Skilled Worker' },
      { orgName: 'Acme Ltd', townCity: 'Leeds', county: 'West Yorkshire', typeRating: 'Worker (B rating)', route: 'Charity Worker' },
    ])
  })

  it('refuses changed columns', () => {
    expect(() => parseRegisterCsv('Name,Town\nA,B', 0)).toThrow(RegisterFormatError)
  })

  it('refuses a file with too few rows', () => {
    expect(() => parseRegisterCsv(csv, 50_000)).toThrow(/expected at least 50000/)
  })
})

describe('licenceRating', () => {
  it.each([
    ['Worker (A rating)', 'A'],
    ['Worker (B rating)', 'B'],
    ['Worker (A (Premium))', 'A'],
    ['Temporary Worker (A (SME+))', 'A'],
    ['Worker (UK Expansion Worker: Provisional )', 'Worker (UK Expansion Worker: Provisional )'],
  ])('%s → %s', (raw, expected) => {
    expect(licenceRating(raw)).toBe(expected)
  })
})
