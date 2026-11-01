import { describe, expect, it } from 'vitest'
import type { DraftState } from '@/modules/writing-desk/draft'
import { MAX_TOOL_RESPONSE_CHARS } from '../limits'
import { draftFailureError, draftView } from './draft-view'

const CTRL = '\u0001'.repeat(20_000)
const longId = (i: number) => `${'i'.repeat(75)}-${String(i).padStart(4, '0')}`.slice(0, 80)

function state(over: Partial<DraftState>): DraftState {
  return {
    deskId: 'd',
    jobId: 'j',
    content: '',
    draftRevision: 1,
    liveRevision: 1,
    sections: [],
    warnings: [],
    issues: [],
    ...over,
  }
}

function expectValidUnderCap(view: unknown) {
  const json = JSON.stringify(view)
  expect(json.length).toBeLessThan(MAX_TOOL_RESPONSE_CHARS)
  expect(JSON.parse(json)).toEqual(view)
}

describe('draftView worst cases', () => {
  it('control-character section text stays valid JSON under the cap', () => {
    const sections = Array.from({ length: 80 }, (_, i) => ({ id: longId(i), hash: 'h'.repeat(12), text: CTRL }))
    const view = draftView(state({ sections }))
    expectValidUnderCap(view)
    expect(view.truncated).toBe(true)
  })

  it('escape-heavy warnings and issues with maximum-length ids hit the fallback and stay valid', () => {
    const sections = Array.from({ length: 80 }, (_, i) => ({ id: longId(i), hash: 'h'.repeat(12), text: CTRL }))
    const warnings = Array.from({ length: 200 }, () => ({ kind: 'dates' as const, message: CTRL, excerpt: CTRL }))
    const issues = Array.from({ length: 200 }, () => ({ severity: 'error' as const, message: CTRL, line: 1 }))
    const view = draftView(state({ sections, warnings, issues }))
    expectValidUnderCap(view)
    expect(view.truncated).toBe(true)
    expect(view.notice).toMatch(/shortened/)
    // Level 0 allows 15 warnings; fewer proves the tighter fallback levels ran.
    expect(view.warnings.length).toBeLessThan(15)
  })

  it('reduces down to ids and hashes when nothing else fits', () => {
    const sections = Array.from({ length: 5000 }, (_, i) => ({ id: longId(i), hash: 'h'.repeat(12), text: CTRL }))
    const warnings = Array.from({ length: 500 }, () => ({ kind: 'dates' as const, message: CTRL, excerpt: CTRL }))
    const view = draftView(state({ sections, warnings }))
    expectValidUnderCap(view)
    expect(view.sections.length).toBeGreaterThan(0)
  })
})

describe('draftFailureError bounds', () => {
  it('clips listed ids and caps the whole message', () => {
    const sections = Array.from({ length: 500 }, (_, i) => ({ id: `${'x'.repeat(500)}${i}`, hash: 'h', text: '' }))
    const err = draftFailureError({ ok: false, reason: 'section_not_found', message: 'm'.repeat(50_000), sections })
    expect(err.message.length).toBeLessThanOrEqual(10_100)
    expect(err.message).not.toMatch(/x{200}/)
  })
})
