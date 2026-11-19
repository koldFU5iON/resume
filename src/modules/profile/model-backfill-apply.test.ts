import { beforeEach, describe, expect, it, vi } from 'vitest'
import { planBackfill, type BackfillInput } from './model-backfill'
import { applyBackfill, blockers, summarisePlan, type BackfillTx } from './model-backfill-apply'

const input = (over: Partial<BackfillInput> = {}): BackfillInput => ({
  experiences: [{ id: 'e1', company: 'Co', role: 'Lead', type: 'employment', summary: '## Achievements\n- x', revision: 4 }],
  projects: [{ id: 'p1', name: 'Launch', experienceId: 'e1' }],
  activities: [
    { id: 'a1', kind: 'achievement', description: 'Shipped the launch', experienceId: null, projectId: 'p1' },
    { id: 'a2', kind: 'responsibility', description: 'Owned the regional budget', experienceId: 'e1', projectId: null },
  ],
  ...over,
})

const tx = () => {
  const t = {
    roleActivity: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    experience: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  }
  return t satisfies BackfillTx
}

describe('applyBackfill', () => {
  let t: ReturnType<typeof tx>
  beforeEach(() => { t = tx() })

  it('assigns project-only activities and folds notes, guarded by revision and "no role yet"', async () => {
    const i = input()
    const now = new Date('2026-11-20T10:00:00Z')
    const res = await applyBackfill(t, 'prof1', i, planBackfill(i), now)
    expect(res).toEqual({ activitiesAssigned: 1, notesFolded: 1 })
    expect(t.roleActivity.updateMany).toHaveBeenCalledWith({ where: { id: 'a1', experienceId: null }, data: { experienceId: 'e1' } })
    const call = t.experience.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'e1', profileId: 'prof1', revision: 4 })
    expect(call.data).toMatchObject({ notesUpdatedAt: now, revision: { increment: 1 } })
    expect(call.data.summary).toContain('- Owned the regional budget')
    expect(call.data.summary.startsWith('## Achievements\n- x')).toBe(true)
  })

  it('refuses to apply while the owner still has things to resolve, and writes nothing', async () => {
    const i = input({ projects: [{ id: 'p1', name: 'Launch', experienceId: null }] })
    const report = planBackfill(i)
    expect(blockers(report)).toContain('1 projects have no role')
    await expect(applyBackfill(t, 'prof1', i, report)).rejects.toThrow(/Not applying/)
    expect(t.roleActivity.updateMany).not.toHaveBeenCalled()
    expect(t.experience.updateMany).not.toHaveBeenCalled()
  })

  it('aborts (so the transaction rolls back) when an activity already got a role meanwhile', async () => {
    t.roleActivity.updateMany.mockResolvedValue({ count: 0 })
    const i = input()
    await expect(applyBackfill(t, 'prof1', i, planBackfill(i))).rejects.toThrow(/activity changed/)
    expect(t.experience.updateMany).not.toHaveBeenCalled()
  })

  it('aborts when a note was edited since the report (revision moved on)', async () => {
    t.experience.updateMany.mockResolvedValue({ count: 0 })
    const i = input()
    await expect(applyBackfill(t, 'prof1', i, planBackfill(i))).rejects.toThrow(/note for Lead at Co changed/)
  })

  it('has nothing to do on a second pass', async () => {
    const i = input()
    const first = planBackfill(i)
    await applyBackfill(t, 'prof1', i, first)
    const folded = first.folds[0].after
    const next = input({
      experiences: [{ ...i.experiences[0], summary: folded, revision: 5 }],
      activities: i.activities.map((a) => (a.id === 'a1' ? { ...a, experienceId: 'e1' } : a)),
    })
    expect(summarisePlan(planBackfill(next))).toEqual({ activitiesAssigned: 0, notesFolded: 0 })
  })

  it('a plan with nothing to change writes nothing', async () => {
    const i = input({ activities: [{ id: 'a2', kind: 'achievement', description: 'Did it', experienceId: 'e1', projectId: null }] })
    const res = await applyBackfill(t, 'prof1', i, planBackfill(i))
    expect(res).toEqual({ activitiesAssigned: 0, notesFolded: 0 })
    expect(t.roleActivity.updateMany).not.toHaveBeenCalled()
    expect(t.experience.updateMany).not.toHaveBeenCalled()
  })
})
