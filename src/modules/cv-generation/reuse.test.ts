import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: { cvGeneration: { findFirst: vi.fn() } } }))
vi.mock('@/modules/llm/prompt-context', () => ({ loadCVBriefPrompt: vi.fn(), loadCVSelectPrompt: vi.fn() }))

import { prisma } from '@/lib/db'
import { loadCVBriefPrompt, loadCVSelectPrompt } from '@/modules/llm/prompt-context'
import { buildBriefFor } from './__fixtures__/gathered'
import { writeSelection, writeVault } from './__fixtures__/write'
import { computeReuseKey, findReusableSelection, readReuseMeta, reuseDate, reuseKeyOf, reuseNote } from './reuse'
import { REUSABLE_FAILURE_KINDS, SELECTION_PIPELINE_VERSION, SELECTION_REUSE_WINDOW_DAYS, SELECTION_REUSE_WINDOW_MS, parseSelection } from './schema'

const db = vi.mocked(prisma, { deep: true })
const mockBriefPrompt = vi.mocked(loadCVBriefPrompt)
const mockSelectPrompt = vi.mocked(loadCVSelectPrompt)
const NOW = new Date('2026-11-18T12:00:00Z')
const HASH = 'a'.repeat(64)
const KEY = 'k'.repeat(64)
const keys = { inputsHash: HASH, reuseKey: KEY }
const brief = buildBriefFor()
const selection = writeSelection(writeVault())
const day = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60_000)

const row = (over: Record<string, unknown> = {}) => ({
  id: 'run-0', inputsHash: HASH, brief, selection, createdAt: day(8),
  log: { entries: [], partial: false, reuseKey: KEY, reuseOrigin: { runId: 'run-0', at: day(8).toISOString() } },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.cvGeneration.findFirst.mockResolvedValue(row() as never)
  mockBriefPrompt.mockResolvedValue('BRIEF PROMPT')
  mockSelectPrompt.mockResolvedValue('SELECT PROMPT')
})

describe('findReusableSelection', () => {
  it('returns the stored brief and selection when the hash and the reuse key are equal', async () => {
    const r = await findReusableSelection('p1', 'job-1', keys, NOW)
    expect(r).toMatchObject({ runId: 'run-0', at: day(8) })
    expect(r!.brief.hiddenQuestion).toBe(brief.hiddenQuestion)
    expect(r!.selection.employers.length).toBeGreaterThan(0)
  })

  it('asks only for the profile’s own runs of this job inside the window that are complete, or failed after Select, newest first', async () => {
    await findReusableSelection('p1', 'job-1', keys, NOW)
    const arg = db.cvGeneration.findFirst.mock.calls[0][0]!
    expect(arg.where).toMatchObject({ profileId: 'p1', jobApplicationId: 'job-1' })
    expect((arg.where!.createdAt as { gte: Date }).gte).toEqual(new Date(NOW.getTime() - SELECTION_REUSE_WINDOW_MS))
    expect(arg.where!.OR).toEqual([{ status: 'complete' }, { status: 'failed', failureKind: { in: ['draft_exists', 'document_limit'] } }])
    expect(SELECTION_REUSE_WINDOW_DAYS).toBe(30)
    expect(REUSABLE_FAILURE_KINDS).toEqual(['draft_exists', 'document_limit'])
    expect(arg.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }])
  })

  it('never reuses across profiles: another profile’s run is not even queried, so nothing comes back', async () => {
    db.cvGeneration.findFirst.mockImplementation((async (args: { where: { profileId: string } }) => (args.where.profileId === 'p-owner' ? row() : null)) as never)
    expect(await findReusableSelection('p-other', 'job-1', keys, NOW)).toBeNull()
    expect(await findReusableSelection('p-owner', 'job-1', keys, NOW)).not.toBeNull()
  })

  it('reuses a run that FAILED at Land (draft_exists, document_limit): it had already paid for its brief and selection', async () => {
    db.cvGeneration.findFirst.mockResolvedValue(row({ status: 'failed', failureKind: 'draft_exists' }) as never)
    expect(await findReusableSelection('p1', 'job-1', keys, NOW)).not.toBeNull()
  })

  it.each([
    ['a different hash', { inputsHash: 'b'.repeat(64) }],
    ['no stored hash (an old run)', { inputsHash: null }],
    ['no stored brief', { brief: null }],
    ['an unreadable brief', { brief: { nonsense: true } }],
    ['no stored selection', { selection: null }],
    ['an unreadable selection', { selection: 'x' }],
    ['a Phase 2 selection with no employers', { selection: { ...selection, employers: [] } }],
    ['a rules fallback selection (the model call had failed)', { selection: { ...selection, mode: 'fallback' } }],
  ])('does not reuse %s', async (_n, over) => {
    db.cvGeneration.findFirst.mockResolvedValue(row(over) as never)
    expect(await findReusableSelection('p1', 'job-1', keys, NOW)).toBeNull()
  })

  it('finds nothing when there is no eligible run in the window', async () => {
    db.cvGeneration.findFirst.mockResolvedValue(null)
    expect(await findReusableSelection('p1', 'job-1', keys, NOW)).toBeNull()
  })

  it('looks only at the newest eligible run: if that one differs, an older equal one is not used', async () => {
    db.cvGeneration.findFirst.mockResolvedValue(row({ inputsHash: 'c'.repeat(64) }) as never)
    expect(await findReusableSelection('p1', 'job-1', keys, NOW)).toBeNull()
    expect(db.cvGeneration.findFirst).toHaveBeenCalledTimes(1)
  })

  describe('the reuse key (pipeline version and the effective prompts)', () => {
    it('does not reuse a pair stored under a different key: a stamp from another pipeline version, or another prompt', async () => {
      db.cvGeneration.findFirst.mockResolvedValue(row({ log: { entries: [], reuseKey: 'stamped-by-an-older-version', reuseOrigin: { runId: 'run-0', at: day(8).toISOString() } } }) as never)
      expect(await findReusableSelection('p1', 'job-1', keys, NOW)).toBeNull()
    })

    it('does not reuse a run stored without a key (before the key existed), or with a log that is not an object', async () => {
      for (const log of [{ entries: [] }, null, 'x', [], { reuseKey: 5 }, { reuseKey: '' }]) {
        db.cvGeneration.findFirst.mockResolvedValue(row({ log }) as never)
        expect(await findReusableSelection('p1', 'job-1', keys, NOW)).toBeNull()
      }
    })

    it('changes with the pipeline version, the inputs hash, an edited brief prompt and an edited select prompt', () => {
      const base = { version: 1, inputsHash: HASH, briefPrompt: 'B', selectPrompt: 'S' }
      const k = reuseKeyOf(base)
      expect(reuseKeyOf(base)).toBe(k)
      expect(reuseKeyOf({ ...base, version: 2 })).not.toBe(k)
      expect(reuseKeyOf({ ...base, inputsHash: 'b'.repeat(64) })).not.toBe(k)
      expect(reuseKeyOf({ ...base, briefPrompt: 'B edited' })).not.toBe(k)
      expect(reuseKeyOf({ ...base, selectPrompt: 'S edited' })).not.toBe(k)
      expect(reuseKeyOf({ ...base, briefPrompt: 'S', selectPrompt: 'B' })).not.toBe(k) // not just the concatenation
    })

    it('still reads the real IDs on version 7 runs but cannot reuse that key', async () => {
      const base = { inputsHash: HASH, briefPrompt: 'BRIEF PROMPT', selectPrompt: 'SELECT PROMPT' }
      const oldKey = reuseKeyOf({ ...base, version: 7 })
      const currentKey = await computeReuseKey('p1', HASH)
      expect(currentKey).not.toBe(oldKey)
      expect(parseSelection(JSON.parse(JSON.stringify(selection)))?.skills.map((s) => s.id)).toEqual(selection.skills.map((s) => s.id))
      db.cvGeneration.findFirst.mockResolvedValue(row({ log: { entries: [], reuseKey: oldKey } }) as never)
      expect(await findReusableSelection('p1', 'job-1', { ...keys, reuseKey: currentKey }, NOW)).toBeNull()
    })

    it('computeReuseKey uses the current version and the EFFECTIVE prompts of this profile (an override included)', async () => {
      const k1 = await computeReuseKey('p1', HASH)
      expect(k1).toBe(reuseKeyOf({ version: SELECTION_PIPELINE_VERSION, inputsHash: HASH, briefPrompt: 'BRIEF PROMPT', selectPrompt: 'SELECT PROMPT' }))
      expect(mockBriefPrompt).toHaveBeenCalledWith('p1')
      mockSelectPrompt.mockResolvedValue('SELECT PROMPT, edited in settings')
      expect(await computeReuseKey('p1', HASH)).not.toBe(k1)
      mockSelectPrompt.mockResolvedValue('SELECT PROMPT')
      mockBriefPrompt.mockResolvedValue('BRIEF PROMPT, edited in settings')
      expect(await computeReuseKey('p1', HASH)).not.toBe(k1)
    })

    it('an edited prompt makes the stored pair unusable end to end', async () => {
      const stored = await computeReuseKey('p1', HASH)
      db.cvGeneration.findFirst.mockResolvedValue(row({ log: { entries: [], reuseKey: stored, reuseOrigin: { runId: 'run-0', at: day(8).toISOString() } } }) as never)
      expect(await findReusableSelection('p1', 'job-1', { inputsHash: HASH, reuseKey: await computeReuseKey('p1', HASH) }, NOW)).not.toBeNull()
      mockBriefPrompt.mockResolvedValue('BRIEF PROMPT, edited in settings')
      expect(await findReusableSelection('p1', 'job-1', { inputsHash: HASH, reuseKey: await computeReuseKey('p1', HASH) }, NOW)).toBeNull()
    })
  })

  describe('the window runs from the ORIGIN of the pair, so reuse cannot chain forever', () => {
    const chained = (originDaysAgo: number, donorDaysAgo = 1) => row({
      id: 'run-chain', createdAt: day(donorDaysAgo),
      log: { entries: [], reuseKey: KEY, reuseOrigin: { runId: 'run-origin', at: day(originDaysAgo).toISOString() } },
    })

    it('reuses a copy of a pair whose origin is inside the window, and reports the ORIGIN run and date', async () => {
      db.cvGeneration.findFirst.mockResolvedValue(chained(20) as never)
      const r = await findReusableSelection('p1', 'job-1', keys, NOW)
      expect(r).toMatchObject({ runId: 'run-origin', at: day(20) })
      expect(reuseNote(r!.at)).toContain(reuseDate(day(20)))
    })

    it('does NOT reuse a copy made yesterday of a pair that is 31 days old, though the donor itself is new', async () => {
      db.cvGeneration.findFirst.mockResolvedValue(chained(31) as never)
      expect(await findReusableSelection('p1', 'job-1', keys, NOW)).toBeNull()
    })

    it('a chain of copies keeps the first run’s date: every copy carries the origin forward', async () => {
      db.cvGeneration.findFirst.mockResolvedValue(chained(29, 0) as never)
      expect(await findReusableSelection('p1', 'job-1', keys, NOW)).not.toBeNull()
      expect(await findReusableSelection('p1', 'job-1', keys, new Date(NOW.getTime() + 2 * 24 * 60 * 60_000))).toBeNull()
    })

    it('a run that made its own pair is its own origin (and a missing origin falls back to the run itself)', async () => {
      db.cvGeneration.findFirst.mockResolvedValue(row({ log: { entries: [], reuseKey: KEY } }) as never)
      expect(await findReusableSelection('p1', 'job-1', keys, NOW)).toMatchObject({ runId: 'run-0', at: day(8) })
    })
  })
})

describe('readReuseMeta', () => {
  it('reads the key and the origin, and anything malformed as absent', () => {
    expect(readReuseMeta({ reuseKey: 'k', reuseOrigin: { runId: 'r', at: '2026-11-01T00:00:00.000Z' } })).toEqual({ key: 'k', origin: { runId: 'r', at: new Date('2026-11-01T00:00:00.000Z') } })
    expect(readReuseMeta({ reuseKey: 'k', reuseOrigin: { runId: 'r', at: 'not a date' } })).toEqual({ key: 'k', origin: null })
    expect(readReuseMeta({ reuseOrigin: { at: '2026-11-01T00:00:00.000Z' } })).toEqual({ key: null, origin: null })
    expect(readReuseMeta(undefined)).toEqual({ key: null, origin: null })
  })
})

describe('reuseNote', () => {
  it('formats the date in UTC', () => {
    expect(reuseDate(new Date('2026-11-10T23:30:00Z'))).toBe('10 Nov 2026')
    expect(reuseNote(new Date('2026-11-10T09:00:00Z'))).toBe('Reused the brief and selection from the run of 10 Nov 2026 (nothing changed since)')
  })
})
