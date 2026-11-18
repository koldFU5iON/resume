import { describe, expect, it } from 'vitest'
import {
  ACTIVE_STATUSES,
  CV_GENERATION_STAGES,
  CV_GENERATION_STATUSES,
  STAGE_STATUS,
  StageLogEntrySchema,
  asFailureKind,
  asStatus,
  isActiveStatus,
  parseCvGenerationLog,
  parseStageTimings,
  stageForStatus,
} from './schema'

describe('statuses and stages', () => {
  it('has one active status per stage, in pipeline order, between queued and the terminal statuses', () => {
    expect(CV_GENERATION_STATUSES[0]).toBe('queued')
    expect(CV_GENERATION_STATUSES.slice(-2)).toEqual(['complete', 'failed'])
    expect(ACTIVE_STATUSES).toEqual(['queued', ...CV_GENERATION_STAGES.map((s) => STAGE_STATUS[s])])
    expect(ACTIVE_STATUSES.every((s) => isActiveStatus(s))).toBe(true)
    expect(isActiveStatus('complete')).toBe(false)
    expect(isActiveStatus('failed')).toBe(false)
    expect(isActiveStatus('nonsense')).toBe(false)
  })

  it('maps a status to its stage', () => {
    expect(stageForStatus('briefing')).toBe('brief')
    expect(stageForStatus('landing')).toBe('land')
    expect(stageForStatus('queued')).toBeNull()
    expect(stageForStatus('complete')).toBeNull()
  })

  it('reads an unrecognised stored status as failed, never as running', () => {
    expect(asStatus('writing')).toBe('writing')
    expect(asStatus('bogus')).toBe('failed')
    expect(asStatus(null)).toBe('failed')
  })

  it('reads an unknown failure kind as null', () => {
    expect(asFailureKind('timeout')).toBe('timeout')
    expect(asFailureKind('bogus')).toBeNull()
    expect(asFailureKind(null)).toBeNull()
  })
})

describe('StageLogEntrySchema', () => {
  it('fills defaults for a minimal entry', () => {
    expect(StageLogEntrySchema.parse({ stage: 'gather' })).toEqual({
      stage: 'gather', status: 'ok', model: null, startedAt: null, durationMs: null,
      tokens: { input: 0, output: 0 }, costUsd: null, notes: [], kept: [], dropped: [], retries: 0, flaggedClaims: [],
    })
  })

  it('keeps a full entry, flagged claims included', () => {
    const entry = {
      stage: 'review', status: 'ok', model: 'some-model', startedAt: '2026-11-18T10:00:00.000Z', durationMs: 4200,
      tokens: { input: 3000, output: 400 }, costUsd: 0.05, notes: ['removed one claim'],
      kept: ['a'], dropped: ['b'], retries: 1,
      flaggedClaims: [{ claim: 'Led a team of 12', verdict: 'unsupported', section: 'Experience', reason: 'Profile says 4' }],
    }
    expect(StageLogEntrySchema.parse(entry)).toEqual(entry)
  })

  it('rejects an unknown stage or verdict', () => {
    expect(StageLogEntrySchema.safeParse({ stage: 'nope' }).success).toBe(false)
    expect(StageLogEntrySchema.safeParse({ stage: 'review', flaggedClaims: [{ claim: 'x', verdict: 'maybe' }] }).success).toBe(false)
  })
})

describe('parseCvGenerationLog', () => {
  it('returns [] for null, undefined, scalars and objects without entries', () => {
    for (const v of [null, undefined, 'x', 3, {}, { entries: 'no' }]) expect(parseCvGenerationLog(v)).toEqual([])
  })

  it('accepts { entries } and a bare array, in pipeline order', () => {
    const entries = [{ stage: 'select' }, { stage: 'gather' }]
    expect(parseCvGenerationLog({ entries }).map((e) => e.stage)).toEqual(['gather', 'select'])
    expect(parseCvGenerationLog(entries).map((e) => e.stage)).toEqual(['gather', 'select'])
  })

  it('drops bad entries and keeps the good ones', () => {
    const log = parseCvGenerationLog({ entries: [{ stage: 'gather', durationMs: -5 }, { stage: 'brief', durationMs: 10 }, null, 'x', { stage: 'zzz' }] })
    expect(log.map((e) => e.stage)).toEqual(['brief'])
  })

  it('lets a later entry for a stage replace an earlier one', () => {
    const log = parseCvGenerationLog({ entries: [{ stage: 'write', retries: 0 }, { stage: 'write', retries: 2 }] })
    expect(log).toHaveLength(1)
    expect(log[0].retries).toBe(2)
  })
})

describe('parseStageTimings', () => {
  it('keeps numeric stage keys and drops the rest', () => {
    expect(parseStageTimings({ gather: 120, brief: 'x', write: -1, bogus: 5, review: 9000 })).toEqual({ gather: 120, review: 9000 })
    expect(parseStageTimings(null)).toEqual({})
    expect(parseStageTimings([1, 2])).toEqual({})
  })
})
