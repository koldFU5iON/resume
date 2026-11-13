import { describe, it, expect } from 'vitest'
import { applyExtractedData, duplicateKey, isHttpUrl } from './form-utils'

function fakeForm(initial: Record<string, unknown>) {
  const values = { ...initial }
  return {
    values,
    getValues: (name: string) => values[name],
    setValue: (name: string, value: unknown) => { values[name] = value },
  }
}

const extracted = {
  title: 'PM', company: 'Acme', location: 'UK', jobDescription: 'JD',
  jobNumber: 'J1', salaryBand: '£1', datePublished: new Date('2026-01-02'),
}

describe('applyExtractedData', () => {
  it('without a snapshot overwrites with every non-empty value', () => {
    const form = fakeForm({ title: 'typed', company: '' })
    applyExtractedData(form, { ...extracted, location: '' })
    expect(form.values).toMatchObject({ title: 'PM', company: 'Acme', jobNumber: 'J1' })
    expect(form.values.location).toBeUndefined()
  })

  it('with a snapshot keeps fields changed during extraction and fills the rest', () => {
    const date = new Date('2025-05-05')
    const snapshot = { title: '', company: '', location: '', datePublished: new Date(date) }
    const form = fakeForm({ ...snapshot, title: 'typed while waiting', datePublished: date })
    applyExtractedData(form, extracted, snapshot)
    expect(form.values.title).toBe('typed while waiting')
    expect(form.values.company).toBe('Acme')
    // Same date, different Date instance: unchanged, so it is filled.
    expect(form.values.datePublished).toBe(extracted.datePublished)
  })

  it('with a snapshot skips a date the user changed', () => {
    const snapshot = { datePublished: undefined }
    const typed = new Date('2025-05-05')
    const form = fakeForm({ datePublished: typed })
    applyExtractedData(form, extracted, snapshot)
    expect(form.values.datePublished).toBe(typed)
  })
})

describe('duplicateKey', () => {
  it('ignores order and differs for different sets', () => {
    expect(duplicateKey([{ id: 'b' }, { id: 'a' }])).toBe(duplicateKey([{ id: 'a' }, { id: 'b' }]))
    expect(duplicateKey([{ id: 'a' }])).not.toBe(duplicateKey([{ id: 'a' }, { id: 'c' }]))
  })
})

describe('isHttpUrl', () => {
  it.each([
    ['https://x.com', true], ['http://x.com/a?b#c', true],
    ['javascript:alert(1)', false], ['ftp://x.com', false], ['', false], [null, false], ['x.com', false],
  ])('%j → %s', (value, expected) => {
    expect(isHttpUrl(value)).toBe(expected)
  })
})
