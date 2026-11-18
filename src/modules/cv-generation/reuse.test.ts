import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: { cvGeneration: { findFirst: vi.fn() } } }))

import { prisma } from '@/lib/db'
import { buildBriefFor } from './__fixtures__/gathered'
import { writeSelection, writeVault } from './__fixtures__/write'
import { findReusableSelection, reuseDate, reuseNote } from './reuse'
import { SELECTION_REUSE_WINDOW_DAYS, SELECTION_REUSE_WINDOW_MS } from './schema'

const db = vi.mocked(prisma, { deep: true })
const NOW = new Date('2026-11-18T12:00:00Z')
const HASH = 'a'.repeat(64)
const brief = buildBriefFor()
const selection = writeSelection(writeVault())

const row = (over: Record<string, unknown> = {}) => ({
  id: 'run-0', inputsHash: HASH, brief, selection, createdAt: new Date('2026-11-10T09:00:00Z'), ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.cvGeneration.findFirst.mockResolvedValue(row() as never)
})

describe('findReusableSelection', () => {
  it('returns the stored brief and selection when the hash is equal', async () => {
    const r = await findReusableSelection('p1', 'job-1', HASH, NOW)
    expect(r).toMatchObject({ runId: 'run-0', at: new Date('2026-11-10T09:00:00Z') })
    expect(r!.brief.hiddenQuestion).toBe(brief.hiddenQuestion)
    expect(r!.selection.employers.length).toBeGreaterThan(0)
  })

  it('asks only for the profile’s own COMPLETE runs of this job, newest first, inside the window', async () => {
    await findReusableSelection('p1', 'job-1', HASH, NOW)
    const arg = db.cvGeneration.findFirst.mock.calls[0][0]!
    expect(arg.where).toMatchObject({ profileId: 'p1', jobApplicationId: 'job-1', status: 'complete' })
    expect((arg.where!.createdAt as { gte: Date }).gte).toEqual(new Date(NOW.getTime() - SELECTION_REUSE_WINDOW_MS))
    expect(SELECTION_REUSE_WINDOW_DAYS).toBe(30)
    expect(arg.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }])
  })

  it('never reuses across profiles: another profile’s run is not even queried, so nothing comes back', async () => {
    db.cvGeneration.findFirst.mockImplementation((async (args: { where: { profileId: string } }) => (args.where.profileId === 'p-owner' ? row() : null)) as never)
    expect(await findReusableSelection('p-other', 'job-1', HASH, NOW)).toBeNull()
    expect(await findReusableSelection('p-owner', 'job-1', HASH, NOW)).not.toBeNull()
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
    expect(await findReusableSelection('p1', 'job-1', HASH, NOW)).toBeNull()
  })

  it('finds nothing when there is no complete run in the window', async () => {
    db.cvGeneration.findFirst.mockResolvedValue(null)
    expect(await findReusableSelection('p1', 'job-1', HASH, NOW)).toBeNull()
  })

  it('looks only at the newest complete run: if that one differs, an older equal one is not used', async () => {
    db.cvGeneration.findFirst.mockResolvedValue(row({ inputsHash: 'c'.repeat(64) }) as never)
    expect(await findReusableSelection('p1', 'job-1', HASH, NOW)).toBeNull()
    expect(db.cvGeneration.findFirst).toHaveBeenCalledTimes(1)
  })
})

describe('reuseNote', () => {
  it('formats the date in UTC', () => {
    expect(reuseDate(new Date('2026-11-10T23:30:00Z'))).toBe('10 Nov 2026')
    expect(reuseNote(new Date('2026-11-10T09:00:00Z'))).toBe('Reused the brief and selection from the run of 10 Nov 2026 (nothing changed since)')
  })
})
