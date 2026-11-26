import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))

import { effectiveStatus } from './queries'
import { allowedFrom } from './run'
import { ANGLES_VALID_MS, PROCESSING_STALE_MS } from './schema'

const now = Date.parse('2026-11-26T12:00:00Z')
const row = (status: string, ageMs: number, failureKind: string | null = null) => ({ status, failureKind, failureMessage: null, updatedAt: new Date(now - ageMs) })

describe('effectiveStatus', () => {
  it('reads a processing run with no recent progress as failed / timeout', () => {
    expect(effectiveStatus(row('writing', PROCESSING_STALE_MS + 1), now)).toMatchObject({ status: 'failed', failureKind: 'timeout' })
    expect(effectiveStatus(row('writing', 1000), now)).toMatchObject({ status: 'writing', failureKind: null })
  })

  it('lets angles wait for a choice for days, then reads them as expired', () => {
    expect(effectiveStatus(row('awaiting_choice', PROCESSING_STALE_MS * 10), now)).toMatchObject({ status: 'awaiting_choice' })
    expect(effectiveStatus(row('awaiting_choice', ANGLES_VALID_MS + 1), now)).toMatchObject({ status: 'failed', failureKind: 'expired' })
  })

  it('keeps a stored failure and its message', () => {
    expect(effectiveStatus(row('failed', 0, 'draft_exists'), now)).toMatchObject({ status: 'failed', failureKind: 'draft_exists' })
  })
})

describe('allowedFrom', () => {
  it('only moves forward, through the pause', () => {
    expect(allowedFrom('queued')).toEqual([])
    expect(allowedFrom('awaiting_choice')).toEqual(['queued', 'gathering', 'suggesting'])
    expect(allowedFrom('writing')).toContain('awaiting_choice')
    expect(allowedFrom('complete')).toContain('landing')
  })
})
