import { describe, expect, it } from 'vitest'
import { contactLine, fillContactPlaceholder, hasContactPlaceholder } from './contact'

const contact = { email: 'robin@example.test', phone: null, linkedIn: 'linkedin.com/in/robin', github: ' ', website: 'robin.example.test' }
const none = { email: null, phone: null, linkedIn: null, github: null, website: null }

describe('contact placeholder', () => {
  it('builds the contact line from non-empty fields', () => {
    expect(contactLine(contact)).toBe('robin@example.test | linkedin.com/in/robin | robin.example.test')
  })

  it('detects the placeholder, tolerating spacing and case', () => {
    expect(hasContactPlaceholder('x {{ Contact }} y')).toBe(true)
    expect(hasContactPlaceholder('no placeholder')).toBe(false)
  })

  it('fills every placeholder, keeping surrounding text', () => {
    const md = ':::header\n# Robin\n{{contact}}\nLyon · {{contact}}\n:::'
    expect(fillContactPlaceholder(md, contact)).toBe(
      ':::header\n# Robin\nrobin@example.test | linkedin.com/in/robin | robin.example.test\n' +
      'Lyon · robin@example.test | linkedin.com/in/robin | robin.example.test\n:::',
    )
  })

  it('drops a line that would be left empty', () => {
    expect(fillContactPlaceholder('# Robin\n{{contact}}\n## Profile', none)).toBe('# Robin\n## Profile')
  })

  it('removes an inline placeholder with its separator when there is nothing to fill', () => {
    expect(fillContactPlaceholder('Lyon · {{contact}}', none)).toBe('Lyon')
  })

  it('keeps $ in contact values literal', () => {
    expect(fillContactPlaceholder('{{contact}}', { ...none, website: "x.test/?a=$'&b=$&" })).toBe("x.test/?a=$'&b=$&")
  })
})
