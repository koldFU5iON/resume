import { describe, expect, it } from 'vitest'
import {
  ACTIVE_STATUSES,
  CV_GENERATION_STAGES,
  CV_GENERATION_STATUSES,
  STAGE_STATUS,
  CvSelectionSchema,
  StageLogEntrySchema,
  employersWithBullets,
  asFailureKind,
  asStatus,
  isActiveStatus,
  parseCvGenerationLog,
  parseSelection,
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

describe('CvSelectionSchema', () => {
  it('reads a row stored before header-only roles and the not-selected count existed', () => {
    const old = {
      mode: 'model',
      experiences: [{ id: 'e1', label: 'PM — Acme', reason: '' }],
      activities: {},
      dropped: [{ section: 'skills', id: 's1', label: 'x', why: 'not_selected' }],
      droppedTotal: 1,
    }
    const parsed = CvSelectionSchema.parse(old)
    expect(parsed.headerOnlyRoles).toEqual([])
    expect(parsed.notSelectedTotal).toBeUndefined()
  })

  it('keeps header-only roles, and reads the new drop reason', () => {
    const parsed = CvSelectionSchema.parse({
      mode: 'fallback',
      headerOnlyRoles: [{ id: 'e2', label: 'Intern — Old Co' }],
      dropped: [{ section: 'activities', id: 'a1', why: 'role_header_only' }],
      notSelectedTotal: 0,
    })
    expect(parsed.headerOnlyRoles).toEqual([{ id: 'e2', label: 'Intern — Old Co', reason: '' }])
    expect(parsed.dropped[0].why).toBe('role_header_only')
  })

  it('reads rows stored before employers existed (PR 415 shape and older) with no employers', () => {
    const pr415 = CvSelectionSchema.parse({
      mode: 'model',
      experiences: [{ id: 'e1', label: 'PM — Acme', reason: 'recent' }],
      headerOnlyRoles: [{ id: 'e2', label: 'Intern — Old Co' }],
      activities: { e1: [{ id: 'a1', label: 'Cut release time' }] },
      dropped: [{ section: 'activities', id: 'a2', parentId: 'e1', why: 'over_cap' }],
      droppedTotal: 1,
      notSelectedTotal: 0,
    })
    expect(pr415.employers).toEqual([])
    expect(pr415.experiences).toHaveLength(1)
    expect(pr415.activities.e1[0].label).toBe('Cut release time')
    expect(parseSelection({ mode: 'model' })?.employers).toEqual([])
  })

  it('stores employers with roles, progression, bullets (with their role), relevance and the header-only flag', () => {
    const row = {
      mode: 'model',
      employers: [{
        key: 'unity', company: 'Unity', latestTitle: 'Snr. Program Manager', start: '2019-01-01', end: null,
        roles: [{ experienceId: 'u1', title: 'Program Manager', start: '2019-01-01', end: '2021-06-30' }, { experienceId: 'u2', title: 'Snr. Program Manager', start: '2021-07-01' }],
        progression: 'Two roles at Unity (2019–present): Program Manager → Snr. Program Manager',
        relevance: 4,
        bullets: [{ id: 'a1', label: 'Cut release time', experienceId: 'u1' }],
      }],
    }
    const parsed = CvSelectionSchema.parse(row)
    const e = parsed.employers[0]
    expect(e.headerOnly).toBe(false)
    expect(e.reason).toBe('')
    expect(e.roles[1].end).toBeNull()
    expect(e.stints).toBeUndefined() // rows stored before stints still parse
    expect(e.bullets[0]).toEqual({ id: 'a1', label: 'Cut release time', reason: '', experienceId: 'u1' })
    // Relevance is on the 1-5 scale; a bullet must say which role it came from.
    expect(CvSelectionSchema.safeParse({ ...row, employers: [{ ...row.employers[0], bullets: [{ id: 'a1', label: 'x' }] }] }).success).toBe(false)
    // An unreadable row reads as null, never throws.
    expect(parseSelection({ mode: 'model', employers: [{ key: 'x' }] })).toBeNull()
  })

  it('reads a bad relevance as a score instead of hiding the whole selection', () => {
    const base = { key: 'unity', company: 'Unity', latestTitle: 'PM', bullets: [] }
    const sel = (relevance: unknown) => CvSelectionSchema.parse({ mode: 'model', employers: [{ ...base, relevance }, { ...base, key: 'blizzard', relevance: 5 }] })
    expect(sel('high').employers.map((e) => e.relevance)).toEqual([3, 5]) // not a number: the middle score
    expect(sel(null).employers[0].relevance).toBe(3)
    expect(sel(7).employers[0].relevance).toBe(5) // clamped
    expect(sel(0).employers[0].relevance).toBe(1)
    expect(sel(3.6).employers[0].relevance).toBe(4) // rounded
    expect(parseSelection({ mode: 'model', employers: [{ ...base, relevance: 'high' }] })).not.toBeNull()
  })

  it('a header-only employer needs no relevance, and stints are kept', () => {
    const e = CvSelectionSchema.parse({
      mode: 'model',
      employers: [{ key: 'acme', company: 'Acme', latestTitle: 'Dev', headerOnly: true, stints: [{ start: '2015-01-01', end: '2017-01-01' }, { start: '2019-01-01' }] }],
    }).employers[0]
    expect(e.relevance).toBeUndefined()
    expect(e.stints).toEqual([{ start: '2015-01-01', end: '2017-01-01' }, { start: '2019-01-01', end: null }])
  })

  it('exposes the employers-with-bullets budget under its true name', () => {
    expect(employersWithBullets({ budgets: { experiences: 3, skills: 1, tools: 1, competencies: 1, certifications: 1, education: 1, projects: 1 } })).toBe(3)
  })
})
