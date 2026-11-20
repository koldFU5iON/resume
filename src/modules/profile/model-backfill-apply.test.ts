import { beforeEach, describe, expect, it, vi } from 'vitest'
import { planBackfill, type BackfillInput } from './model-backfill'
import { applyPlan, blockers, planFingerprint, summarisePlan, type BackfillTx } from './model-backfill-apply'

const input = (over: Partial<BackfillInput> = {}): BackfillInput => ({
  experiences: [{ id: 'e1', company: 'Co', role: 'Lead', type: 'employment', summary: '## Achievements\n- x', revision: 4 }],
  projects: [{ id: 'p1', name: 'Launch', experienceId: 'e1', notes: '', revision: 2 }],
  activities: [
    { id: 'a1', kind: 'achievement', description: 'Shipped the launch', experienceId: 'e1', projectId: 'p1' },
    { id: 'a2', kind: 'responsibility', description: 'Owned the regional budget', experienceId: 'e1', projectId: null },
  ],
  ...over,
})

const tx = () => ({
  experience: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  project: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
}) satisfies BackfillTx

const go = (t: BackfillTx, i: BackfillInput, fingerprint?: string) => {
  const report = planBackfill(i)
  return applyPlan(t, 'prof1', i, report, fingerprint ?? planFingerprint(report, i), new Date('2026-11-20T10:00:00Z'))
}

describe('applyPlan', () => {
  let t: ReturnType<typeof tx>
  beforeEach(() => { t = tx() })

  it('leaves role assignment to the migration', async () => {
    const legacy = input()
    legacy.activities[0].experienceId = null
    await expect(go(t, legacy)).rejects.toThrow(/required profile roles migration/)
    expect(t.experience.updateMany).not.toHaveBeenCalled()
    expect(t.project.updateMany).not.toHaveBeenCalled()
  })

  it('writes the note fold, guarded by profile and revision', async () => {
    await go(t, input())
    const call = t.experience.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'e1', profileId: 'prof1', revision: 4 })
    expect(call.data).toMatchObject({ notesUpdatedAt: new Date('2026-11-20T10:00:00Z'), revision: { increment: 1 } })
    expect(call.data.summary).toContain('- Owned the regional budget')
  })

  it('folds a project-labelled responsibility into the project note', async () => {
    const i = input({ activities: [{ id: 'a9', kind: 'responsibility', description: 'Ran the tour logistics', experienceId: 'e1', projectId: 'p1' }] })
    const res = await go(t, i)
    expect(res).toEqual({ notesFolded: 1, responsibilitiesFolded: 1 })
    expect(t.experience.updateMany).not.toHaveBeenCalled()
    expect(t.project.updateMany.mock.calls[0][0].where).toEqual({ id: 'p1', profileId: 'prof1', revision: 2 })
  })

  it('refuses when what would be written is not what was approved, and writes nothing', async () => {
    await expect(go(t, input(), 'deadbeef0000')).rejects.toThrow(/not what you approved/)
    expect(t.experience.updateMany).not.toHaveBeenCalled()
  })

  it('the fingerprint changes when a note, a revision or a responsibility changes', () => {
    const i = input()
    const base = planFingerprint(planBackfill(i), i)
    const other = (o: Partial<BackfillInput>) => { const x = input(o); return planFingerprint(planBackfill(x), x) }
    expect(other({ experiences: [{ ...i.experiences[0], summary: 'edited' }] })).not.toBe(base)
    expect(other({ experiences: [{ ...i.experiences[0], revision: 5 }] })).not.toBe(base)
    expect(other({ activities: [...i.activities, { id: 'a3', kind: 'responsibility', description: 'More', experienceId: 'e1', projectId: 'p1' }] })).not.toBe(base)
    expect(other({})).toBe(base)
  })

  it('refuses while the owner still has things to resolve, and writes nothing', async () => {
    const i = input({ projects: [{ id: 'p1', name: 'Launch', experienceId: null, notes: '', revision: 2 }] })
    expect(blockers(planBackfill(i))).toContain('1 projects have no role')
    await expect(go(t, i)).rejects.toThrow(/Not applying/)
    const mismatched = input({ activities: [{ id: 'a5', kind: 'achievement', description: 'x', experienceId: 'e1', projectId: 'p2' }], projects: [
      { id: 'p1', name: 'Launch', experienceId: 'e1', notes: '', revision: 1 }, { id: 'p2', name: 'Other', experienceId: 'e9', notes: '', revision: 1 }] ,
      experiences: [...input().experiences, { id: 'e9', company: 'Else', role: 'R', type: 'employment', summary: '', revision: 1 }] })
    expect(blockers(planBackfill(mismatched))).toContain('disagree')
  })

  it('aborts when a note was edited meanwhile', async () => {
    t.experience.updateMany.mockResolvedValue({ count: 0 })
    await expect(go(t, input())).rejects.toThrow(/note for Lead at Co changed/)
    t.project.updateMany.mockResolvedValue({ count: 0 })
    const i = input({ activities: [{ id: 'a9', kind: 'responsibility', description: 'x y z', experienceId: 'e1', projectId: 'p1' }] })
    await expect(go(tx(), i)).resolves.toBeDefined()
    const bad = tx(); bad.project.updateMany.mockResolvedValue({ count: 0 })
    await expect(go(bad, i)).rejects.toThrow(/project "Launch" changed/)
  })

  it('has nothing to do on a second pass', () => {
    const i = input()
    const first = planBackfill(i)
    const next = input({
      experiences: [{ ...i.experiences[0], summary: first.folds[0].after, revision: 5 }],
      })
    expect(summarisePlan(planBackfill(next))).toEqual({ notesFolded: 0, responsibilitiesFolded: 0 })
  })

  it('a plan with nothing to do writes nothing', async () => {
    const i = input({ activities: [{ id: 'a2', kind: 'achievement', description: 'Did it', experienceId: 'e1', projectId: null }] })
    const res = await go(t, i)
    expect(res).toEqual({ notesFolded: 0, responsibilitiesFolded: 0 })
    expect(t.experience.updateMany).not.toHaveBeenCalled()
  })
})
