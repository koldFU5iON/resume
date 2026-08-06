import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { extractJSON } from './extract-json'

const DOC = z.object({ name: z.string(), count: z.number() })
const FIXTURE = { name: 'devon', count: 3 }

describe('extractJSON', () => {
  it('parses plain JSON output', () => {
    const res = extractJSON(JSON.stringify(FIXTURE), DOC)
    expect(res).toEqual({ ok: true, value: FIXTURE })
  })

  it('parses JSON wrapped in a ```json code fence', () => {
    const res = extractJSON(`Here you go:\n\`\`\`json\n${JSON.stringify(FIXTURE)}\n\`\`\`\nHope that helps.`, DOC)
    expect(res).toEqual({ ok: true, value: FIXTURE })
  })

  it('parses JSON wrapped in a bare code fence', () => {
    const res = extractJSON(`\`\`\`\n${JSON.stringify(FIXTURE)}\n\`\`\``, DOC)
    expect(res).toEqual({ ok: true, value: FIXTURE })
  })

  it('parses JSON when the closing fence is missing', () => {
    const res = extractJSON(`\`\`\`json\n${JSON.stringify(FIXTURE)}\n`, DOC)
    expect(res).toEqual({ ok: true, value: FIXTURE })
  })

  it('parses JSON embedded in prose without fences', () => {
    const res = extractJSON(`The result is ${JSON.stringify(FIXTURE)} — done.`, DOC)
    expect(res).toEqual({ ok: true, value: FIXTURE })
  })

  it('ignores braces inside JSON string values when scanning for the object', () => {
    const text = `Prefix ${JSON.stringify({ name: 'a} b { c', count: 1 })} suffix`
    const res = extractJSON(text, DOC)
    expect(res).toEqual({ ok: true, value: { name: 'a} b { c', count: 1 } })
  })

  it('returns no_json when the output contains no object or array', () => {
    const res = extractJSON('I am sorry, I cannot do that.', DOC)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('no_json')
  })

  it('returns no_json for truncated output with an unclosed fence and unbalanced braces', () => {
    const res = extractJSON('```json\n{"name": "devon"', DOC)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('no_json')
  })

  it('returns parse for malformed JSON', () => {
    const res = extractJSON('```json\n{ name: "unquoted" }\n```', DOC)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('parse')
  })

  it('returns schema for JSON that fails validation', () => {
    const res = extractJSON(JSON.stringify({ name: 'devon', count: 'not-a-number' }), DOC)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('schema')
  })

  it('parses without a schema', () => {
    const res = extractJSON(JSON.stringify(FIXTURE))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value).toEqual(FIXTURE)
  })
})
