import { describe, expect, it } from 'vitest'
import { makeContactScrubber } from './pii'

const none = { email: null, phone: null, linkedIn: null, github: null, website: null }
const scrub = makeContactScrubber({ ...none, email: 'robin@example.test', phone: '+33 6 12 34 56 78', linkedIn: 'linkedin.com/in/robin' })

describe('makeContactScrubber', () => {
  it('removes contact values case-insensitively, with the blanks before them', () => {
    expect(scrub('Call +33 6 12 34 56 78 or see LinkedIn.com/in/Robin.')).toBe('Call or see.')
  })

  it('removes any email address, not just the user\'s own', () => {
    expect(scrub('Ask a.b+c@sub.example.co.uk, or ops@x-y.io today')).toBe('Ask, or today')
  })

  it('leaves things that only look like emails', () => {
    for (const text of ['@handle', 'a@b', 'name@ host.com', 'x@y.', '@@@', 'user@.com']) {
      expect(scrub(text)).toBe(text)
    }
  })

  it('keeps other whitespace, so Markdown hard breaks and indented lists survive', () => {
    expect(scrub('Line one  \n  - nested\nMail: robin@example.test')).toBe('Line one  \n  - nested\nMail:')
  })

  it('handles non-ASCII text whose lowercase changes length', () => {
    expect(scrub('İstanbul office, robin@example.test')).toBe('İstanbul office,')
  })

  // Regression for Vercel Security Review resume/1: the old regex went
  // quadratic on long text with no match. These inputs must stay linear.
  it.each([
    ['local-part characters with no @', 'a'.repeat(200_000)],
    ['@ signs with no domain', 'a@'.repeat(100_000)],
    ['domain-like runs with no dot', `x@${'b'.repeat(200_000)}`],
    ['long runs of blanks', `${' '.repeat(200_000)}x`],
    ['dots without labels', `a@b${'.'.repeat(200_000)}`],
  ])('stays fast on %s', (_label, input) => {
    const started = performance.now()
    scrub(input)
    expect(performance.now() - started).toBeLessThan(200)
  })
})
