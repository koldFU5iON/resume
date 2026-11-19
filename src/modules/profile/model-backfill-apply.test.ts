import { beforeEach, describe, expect, it, vi } from 'vitest'
import { planBackfill, type BackfillInput } from './model-backfill'
import { applyFold, foldFingerprint, summarisePlan, type BackfillTx } from './model-backfill-apply'

const input = (over: Partial<BackfillInput> = {}): BackfillInput => ({
  experiences: [{ id: 'e1', company: 'Co', role: 'Lead', type: 'employment', summary: '## Achievements\n- x', revision: 4 }],
  projects: [{ id: 'p1', name: 'Launch', experienceId: 'e1' }],
  activities: [
    { id: 'a1', kind: 'achievement', description: 'Shipped the launch', experienceId: null, projectId: 'p1' },
    { id: 'a2', kind: 'responsibility', description: 'Owned the regional budget', experienceId: 'e1', projectId: null },
  ],
  ...over,
})

const tx = () => ({ experience: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }) satisfies BackfillTx

describe('applyFold', () => {
  let t: ReturnType<typeof tx>
  beforeEach(() => { t = tx() })

  it('writes only the note, guarded by profile and revision, and leaves activities alone', async () => {
    const i = input()
    const report = planBackfill(i)
    const now = new Date('2026-11-20T10:00:00Z')
    const res = await applyFold(t, 'prof1', i, report, foldFingerprint(report, i), now)
    expect(res).toEqual({ notesFolded: 1, responsibilitiesFolded: 1 })
    expect(t.experience.updateMany).toHaveBeenCalledTimes(1)
    const call = t.experience.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'e1', profileId: 'prof1', revision: 4 })
    expect(call.data).toMatchObject({ notesUpdatedAt: now, revision: { increment: 1 } })
    expect(call.data.summary.startsWith('## Achievements\n- x')).toBe(true)
    expect(call.data.summary).toContain('- Owned the regional budget')
  })

  it('refuses when what would be written is not what was approved, and writes nothing', async () => {
    const i = input()
    const report = planBackfill(i)
    await expect(applyFold(t, 'prof1', i, report, 'deadbeef0000')).rejects.toThrow(/not what you approved/)
    expect(t.experience.updateMany).not.toHaveBeenCalled()
  })

  it('the fingerprint changes when a note, a revision or a responsibility changes', () => {
    const i = input()
    const base = foldFingerprint(planBackfill(i), i)
    const edited = input({ experiences: [{ ...i.experiences[0], summary: '## Achievements\n- x edited' }] })
    expect(foldFingerprint(planBackfill(edited), edited)).not.toBe(base)
    const rev = input({ experiences: [{ ...i.experiences[0], revision: 5 }] })
    expect(foldFingerprint(planBackfill(rev), rev)).not.toBe(base)
    const more = input({ activities: [...i.activities, { id: 'a3', kind: 'responsibility', description: 'Mentored the team', experienceId: 'e1', projectId: null }] })
    expect(foldFingerprint(planBackfill(more), more)).not.toBe(base)
    expect(foldFingerprint(planBackfill(i), i)).toBe(base)
  })

  it('aborts (so the transaction rolls back) when a note was edited meanwhile', async () => {
    t.experience.updateMany.mockResolvedValue({ count: 0 })
    const i = input()
    const report = planBackfill(i)
    await expect(applyFold(t, 'prof1', i, report, foldFingerprint(report, i))).rejects.toThrow(/note for Lead at Co changed/)
  })

  it('has nothing to fold on a second pass', async () => {
    const i = input()
    const first = planBackfill(i)
    await applyFold(t, 'prof1', i, first, foldFingerprint(first, i))
    const next = input({ experiences: [{ ...i.experiences[0], summary: first.folds[0].after, revision: 5 }] })
    expect(summarisePlan(planBackfill(next))).toEqual({ notesFolded: 0, responsibilitiesFolded: 0 })
  })

  it('a plan with nothing to fold writes nothing', async () => {
    const i = input({ activities: [{ id: 'a2', kind: 'achievement', description: 'Did it', experienceId: 'e1', projectId: null }] })
    const report = planBackfill(i)
    const res = await applyFold(t, 'prof1', i, report, foldFingerprint(report, i))
    expect(res).toEqual({ notesFolded: 0, responsibilitiesFolded: 0 })
    expect(t.experience.updateMany).not.toHaveBeenCalled()
  })
})
