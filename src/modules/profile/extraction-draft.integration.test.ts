// Opt in against a disposable migrated Postgres with PROFILE_EXTRACTION_INTEGRATION=1.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { completeStructured, getLLMConfigStatus } from '@/modules/llm/client'
import { isLocalDatabaseUrl } from '@/modules/job-assessment/local-db-guard'
import { loadVault } from '@/modules/profile-map/load'
import { checkProfileReadiness } from '@/modules/profile-readiness'
import { buildCandidates } from '@/modules/cv-generation/candidates'
import { buildProfileSnapshot } from './snapshot'
import { changeExtractionDraft, loadExtractionReview, regenerateExtractionDraft } from './extraction-draft'
import { saveExperienceNote, saveProjectNote } from './note-revision'
import type { DraftChange, ExtractionOwner } from './extract-schema'

vi.mock('@/modules/llm/client', () => ({ getLLMConfigStatus: vi.fn(), completeStructured: vi.fn() }))

const enabled = process.env.PROFILE_EXTRACTION_INTEGRATION === '1'
const startDate = new Date('2022-01-01')
const fixedNow = new Date('2026-11-20')
let users: string[] = []
let profileId: string

async function profile() {
  const id = crypto.randomUUID()
  await prisma.user.create({ data: { id, name: 'Draft test', email: `${id}@example.test` } })
  users.push(id)
  return (await prisma.profile.create({ data: { userId: id, name: 'Draft test' } })).id
}

const role = (summary: string, owner = profileId, type = 'employment') =>
  prisma.experience.create({ data: { profileId: owner, company: 'Fixture Co', role: 'Lead', startDate, summary, type } })
const project = (experienceId: string, name: string, notes = '', status = 'active', owner = profileId) =>
  prisma.project.create({ data: { profileId: owner, experienceId, name, description: '', notes, status } })
const activity = (experienceId: string, description: string, projectId: string | null = null, kind = 'achievement') =>
  prisma.roleActivity.create({ data: { experienceId, projectId, kind, description } })

async function review(owner: ExtractionOwner) {
  const loaded = await loadExtractionReview(profileId, owner)
  if (!loaded) throw new Error('Fixture note missing')
  return loaded
}
async function regenerate(owner: ExtractionOwner, replace = false) {
  const before = await review(owner)
  await regenerateExtractionDraft(profileId, owner, before, replace)
  return review(owner)
}
function decide(owner: ExtractionOwner, state: Awaited<ReturnType<typeof review>>, index: number, decision: DraftChange['decision'], extra: Partial<DraftChange> = {}) {
  const { version, sourceVersion } = state
  return changeExtractionDraft(profileId, owner, { version, sourceVersion, itemId: state.items[index].item.id, decision, ...extra })
}

describe.skipIf(!enabled)('saved extraction drafts in Postgres', () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL || !isLocalDatabaseUrl(process.env.DATABASE_URL)) throw new Error('Integration tests require local Postgres.')
  })
  beforeEach(async () => {
    vi.resetAllMocks()
    vi.mocked(getLLMConfigStatus).mockResolvedValue({ configured: false } as never)
    users = []
    profileId = await profile()
  })
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } })
  })

  it('persists edits across reload, keeps one draft, preserves a failed refresh, and resolves skipped items', async () => {
    const row = await role('Unstructured prose.\n## Achievements\n- Built Sable exports\n- Fixed the refund backlog')
    const owner = { experienceId: row.id }
    const first = await regenerate(owner)
    const item = first.items[0].item
    if (item.kind !== 'achievement') throw new Error('Expected achievement')
    await decide(owner, first, 0, 'save', { edit: { ...item, description: 'I automated the Sable exports and added quarterly scheduling.' } })
    const edited = await review(owner)
    expect(edited.items[0].item).toMatchObject({ id: item.id, original: item.original, description: 'I automated the Sable exports and added quarterly scheduling.' })
    await expect(regenerate(owner)).rejects.toThrow(/confirm/i)
    vi.mocked(getLLMConfigStatus).mockResolvedValue({ configured: true } as never)
    vi.mocked(completeStructured).mockRejectedValue(new Error('Unavailable'))
    await expect(regenerate(owner, true)).rejects.toThrow(/still available/)
    expect(await review(owner)).toEqual(edited)
    vi.mocked(getLLMConfigStatus).mockResolvedValue({ configured: false } as never)
    await decide(owner, edited, 1, 'skip')
    const refreshed = await regenerate(owner, true)
    expect(refreshed.items.map(({ item }) => item)).toMatchObject([{ id: item.id, description: 'I built Sable exports' }])
    await expect(decide(owner, edited, 1, 'skip')).rejects.toThrow(/draft changed/)
    expect(await prisma.profileExtractionDraft.count({ where: owner })).toBe(1)
    expect(await prisma.roleActivity.count({ where: owner })).toBe(0)
  })

  it('keeps drafts out of accepted readers and accepts a new project and result once on an Independent projects role', async () => {
    const row = await role('## Achievements\n- Cut turnaround time from 3 weeks to 1 hour in Q3 2025.\n  > Project: Atlas\n## Skills\n- CockroachDB', profileId, 'independent')
    const owner = { experienceId: row.id }
    const vaultBefore = await loadVault(profileId)
    const snapshotBefore = await buildProfileSnapshot(profileId)
    const draft = await regenerate(owner)
    const vaultAfter = await loadVault(profileId)
    expect(vaultAfter).toEqual(vaultBefore)
    expect(await buildProfileSnapshot(profileId)).toEqual(snapshotBefore)
    expect(checkProfileReadiness(vaultAfter, fixedNow)).toEqual(checkProfileReadiness(vaultBefore, fixedNow))
    expect(buildCandidates(vaultAfter)).toEqual(buildCandidates(vaultBefore))
    expect(await prisma.project.count({ where: owner })).toBe(0)
    expect(await prisma.skill.count({ where: { profileId } })).toBe(0)
    const attempts = await Promise.allSettled([decide(owner, draft, 0, 'accept'), decide(owner, draft, 0, 'accept')])
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual(['fulfilled', 'rejected'])
    const rows = await prisma.roleActivity.findMany({ where: owner, include: { project: true } })
    expect(rows).toMatchObject([{
      description: 'I cut turnaround time from 3 weeks to 1 hour in Q3 2025.',
      result: { measure: 'turnaround time', value: '1 hour', baseline: '3 weeks', period: 'Q3 2025' },
      project: { profileId, experienceId: row.id, name: 'Atlas' },
    }])
    const pending = await review(owner)
    expect(pending.items.map(({ item }) => item.kind)).toEqual(['skill'])
    await decide(owner, pending, 0, 'skip')
    expect((await regenerate(owner)).items).toEqual([])
    expect(await prisma.roleActivity.count({ where: owner })).toBe(1)
    expect(await prisma.project.count({ where: owner })).toBe(1)
    expect((await prisma.experience.findUniqueOrThrow({ where: { id: row.id } })).summary).toBe(row.summary)
  })

  it('matches all same-role achievements from role and project notes, with replacement preserving links and project label', async () => {
    const summary = '## Achievements\n- Built the launch dashboard'
    const e1 = await role(summary)
    const e2 = await role('')
    const label = await project(e1.id, 'Launch')
    const input = await project(e1.id, 'Incident review', summary)
    const existing = await activity(e1.id, 'Built the launch dashboard', label.id)
    await activity(e1.id, 'Built the launch dashboard', null, 'responsibility')
    const foreignRole = await activity(e2.id, 'Built the launch dashboard', input.id)
    const skill = await prisma.skill.create({ data: { profileId, name: 'SQL' } })
    const result = { measure: 'dashboard views', value: '25' }
    await prisma.roleActivity.update({ where: { id: existing.id }, data: {
      impact: 'Legacy outcome', result, highlighted: true, order: 9, tags: '["fixture"]',
      skills: { create: { skillId: skill.id, status: 'confirmed', source: 'manual' } },
    } })
    const roleDraft = await regenerate({ experienceId: e1.id })
    expect(roleDraft.items[0].match).toMatchObject({ id: existing.id, project: 'Launch', replaceable: true })
    const owner = { projectId: input.id }
    const draft = await regenerate(owner)
    const target = draft.items[0].match!
    expect(target.id).toBe(existing.id)
    await expect(decide(owner, draft, 0, 'accept')).rejects.toThrow(/similar evidence/i)
    await expect(decide(owner, draft, 0, 'replace', { target: { id: foreignRole.id, version: foreignRole.updatedAt.toISOString() } })).rejects.toThrow(/no longer be replaced/)
    const item = draft.items[0].item
    if (item.kind !== 'achievement') throw new Error('Expected achievement')
    await decide(owner, draft, 0, 'replace', { target, edit: { ...item, description: 'I built the launch dashboard for operators' } })
    const kept = await prisma.roleActivity.findUniqueOrThrow({ where: { id: existing.id }, include: { skills: true } })
    expect(kept).toMatchObject({
      description: 'I built the launch dashboard for operators', projectId: label.id, impact: 'Legacy outcome', result,
      highlighted: true, order: 9, tags: '["fixture"]', skills: [{ skillId: skill.id, source: 'manual', status: 'confirmed' }],
    })
    expect(kept.result).toEqual(result)
    expect(await prisma.roleActivity.findUniqueOrThrow({ where: { id: foreignRole.id } })).toEqual(foreignRole)
    expect((await review(owner)).items).toEqual([])
  })

  it('preserves omitted baseline and period on replacement and requires a choice for conflicting results', async () => {
    const row = await role('## Achievements\n- Cut turnaround time')
    const owner = { experienceId: row.id }
    const existing = await activity(row.id, 'Cut turnaround time')
    const originalResult = { measure: 'turnaround time', value: '1 hour', baseline: '3 weeks', period: 'Q3 2025' }
    await prisma.roleActivity.update({ where: { id: existing.id }, data: { result: originalResult } })
    let draft = await regenerate(owner)
    const item = draft.items[0].item
    if (item.kind !== 'achievement') throw new Error('Expected achievement')
    expect(draft.items[0].match).toMatchObject({ result: originalResult })
    await decide(owner, draft, 0, 'replace', { target: draft.items[0].match!, edit: { ...item, result: { ...originalResult, baseline: null, period: null } } })
    expect((await prisma.roleActivity.findUniqueOrThrow({ where: { id: existing.id } })).result).toEqual(originalResult)

    // A new source passage proposes a different measurement for the same accepted achievement.
    const current = await prisma.experience.findUniqueOrThrow({ where: { id: row.id } })
    await saveExperienceNote(profileId, row.id, '## Achievements\n- Cut turnaround time for exports', current.revision)
    draft = await regenerate(owner)
    const next = draft.items[0].item
    if (next.kind !== 'achievement') throw new Error('Expected achievement')
    const proposed = { ...originalResult, value: '2 hours', baseline: null, period: null }
    await decide(owner, draft, 0, 'save', { edit: { ...next, result: proposed } })
    draft = await review(owner)
    expect(draft.items[0].match).toMatchObject({ result: originalResult, resultConflict: true })
    const target = draft.items[0].match!
    await expect(decide(owner, draft, 0, 'replace', { target })).rejects.toThrow(/choose which result/i)
    await decide(owner, draft, 0, 'replace', { target: { ...target, resultChoice: 'existing' } })
    expect((await prisma.roleActivity.findUniqueOrThrow({ where: { id: existing.id } })).result).toEqual(originalResult)

    const latest = await prisma.experience.findUniqueOrThrow({ where: { id: row.id } })
    await saveExperienceNote(profileId, row.id, '## Achievements\n- Cut turnaround time for new exports', latest.revision)
    draft = await regenerate(owner)
    const last = draft.items[0].item
    if (last.kind !== 'achievement') throw new Error('Expected achievement')
    await decide(owner, draft, 0, 'save', { edit: { ...last, result: proposed } })
    draft = await review(owner)
    await decide(owner, draft, 0, 'replace', { target: { ...draft.items[0].match!, resultChoice: 'suggestion' } })
    expect((await prisma.roleActivity.findUniqueOrThrow({ where: { id: existing.id } })).result).toEqual(proposed)
  })

  it('allows explicitly distinct fuzzy matches but never an exact duplicate or repeated submission', async () => {
    const row = await role('## Achievements\n- Built billing exports for Asia\n- Built billing exports for Europe')
    const owner = { experienceId: row.id }
    await activity(row.id, 'I built billing exports for Europe')
    const draft = await regenerate(owner)
    expect(draft.items[0].match).toMatchObject({ exact: false })
    expect(draft.items[1].match).toMatchObject({ exact: true })
    await expect(decide(owner, draft, 0, 'accept')).rejects.toThrow(/similar evidence/i)
    await expect(decide(owner, draft, 1, 'add-distinct')).rejects.toThrow(/similar evidence/i)
    await decide(owner, draft, 0, 'add-distinct')
    expect(await prisma.roleActivity.count({ where: owner })).toBe(2)
    await expect(decide(owner, draft, 0, 'add-distinct')).rejects.toThrow(/draft changed/)
    const accepted = await prisma.roleActivity.findMany({ where: owner })
    expect(accepted.map(a => a.description).sort()).toEqual(['I built billing exports for Asia', 'I built billing exports for Europe'])
  })

  it('keeps skipped source passages resolved when the model changes kind and quote punctuation', async () => {
    const body = 'I maintained the billing service.'
    const row = await role(body)
    const owner = { experienceId: row.id }
    vi.mocked(getLLMConfigStatus).mockResolvedValue({ configured: true } as never)
    const suggestion = { original: body, description: body, kind: 'scope', result: null, impact: null, projectName: null }
    vi.mocked(completeStructured)
      .mockResolvedValueOnce({ object: { activities: [suggestion], skills: [] } } as never)
      .mockResolvedValueOnce({ object: { activities: [{ ...suggestion, original: body.slice(0, -1), kind: 'achievement' }], skills: [] } } as never)
    const draft = await regenerate(owner)
    expect(draft.items).toHaveLength(1)
    await decide(owner, draft, 0, 'skip')
    expect((await regenerate(owner)).items).toEqual([])
    expect(await prisma.roleActivity.count({ where: owner })).toBe(0)
  })

  it('rejects foreign and archived project labels and replacement targets, leaving the draft and rows intact', async () => {
    const e1 = await role('## Achievements\n- Fixed the invoice bug\n- Rebuilt mobile search')
    const e2 = await role('')
    const otherProfile = await profile()
    const otherRole = await role('', otherProfile)
    const foreign = await project(otherRole.id, 'Foreign', '', 'active', otherProfile)
    const wrongRole = await project(e2.id, 'Wrong role')
    const archived = await project(e1.id, 'Closed', '## Achievements\n- Built archive tools', 'archived')
    const existing = await activity(e1.id, 'Rebuilt mobile search', archived.id)
    const owner = { experienceId: e1.id }
    const draft = await regenerate(owner)
    expect(await loadExtractionReview(otherProfile, owner)).toBeNull()
    await expect(changeExtractionDraft(otherProfile, owner, { ...draft, itemId: draft.items[0].item.id, decision: 'skip' })).rejects.toThrow(/note could not be found/)
    const item = draft.items[0].item
    if (item.kind !== 'achievement') throw new Error('Expected achievement')
    for (const id of [foreign.id, wrongRole.id, archived.id]) {
      await expect(decide(owner, draft, 0, 'accept', { edit: { ...item, project: { kind: 'existing', id }, projectEdited: true } })).rejects.toThrow(/active project from this role/)
    }
    await expect(decide(owner, draft, 0, 'accept', { edit: { ...item, project: { kind: 'new', name: archived.name }, projectEdited: true } })).rejects.toThrow(/that name is archived/)
    expect(draft.items[1].match).toMatchObject({ id: existing.id, replaceable: false })
    await expect(decide(owner, draft, 1, 'accept')).rejects.toThrow(/similar evidence/i)
    await expect(decide(owner, draft, 1, 'replace', { target: draft.items[1].match! })).rejects.toThrow(/no longer be replaced/)
    await expect(regenerate({ projectId: archived.id })).rejects.toThrow(/project is archived/)
    expect(await review(owner)).toEqual(draft)
    expect(await prisma.roleActivity.findMany({ where: owner })).toEqual([existing])
  })

  it('serializes competing accept and skip decisions and resolves project scope without touching its description', async () => {
    const row = await role('')
    const notes = '## Scope\n- Responsible for documenting access\n## Achievements\n- Fixed permission errors'
    const p = await project(row.id, 'Gate')
    const source = await prisma.project.update({ where: { id: p.id }, data: { notes, description: 'Original description  ' } })
    const owner = { projectId: p.id }
    const draft = await regenerate(owner)
    const race = await Promise.allSettled([decide(owner, draft, 1, 'accept'), decide(owner, draft, 1, 'skip')])
    expect(race.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(await prisma.roleActivity.count({ where: owner })).toBe(race[0].status === 'fulfilled' ? 1 : 0)
    const remaining = await review(owner)
    expect(remaining.items.map(({ item }) => item.kind)).toEqual(['scope'])
    await decide(owner, remaining, 0, 'accept')
    expect(await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({
      description: source.description,
      notes: `${notes}\n\n## Overview\n\n- I was responsible for documenting access\n`,
      revision: source.revision + 1,
    })
    expect((await review(owner)).items).toEqual([])
  })

  it('rolls back project creation when the evidence insert fails', async () => {
    const row = await role('## Achievements\n- Added billing exports\n  > Project: Billing')
    const owner = { experienceId: row.id }
    const draft = await regenerate(owner)
    const item = draft.items[0].item
    if (item.kind !== 'achievement') throw new Error('Expected achievement')
    await expect(decide(owner, draft, 0, 'accept', { edit: { ...item, description: 'I added billing exports\0' } })).rejects.toThrow(/byte sequence/)
    expect(await prisma.project.count({ where: owner })).toBe(0)
    expect(await prisma.roleActivity.count({ where: owner })).toBe(0)
    expect(await review(owner)).toEqual(draft)
  })

  it('rejects stale source and stale replacement snapshots and appends scope with a bumped revision', async () => {
    const body = '## Overview\nOriginal wording  \n## Scope\n- Responsible for staffing\n- Manage the calendar\n## Achievements\n- Owned the launch'
    const e = await role(body)
    const existing = await activity(e.id, 'Owned the launch')
    const owner = { experienceId: e.id }
    const initial = await regenerate(owner)
    await prisma.roleActivity.update({ where: { id: existing.id }, data: { description: 'Owned the wider launch', updatedAt: new Date('2025-01-01') } })
    await expect(decide(owner, initial, 2, 'replace', { target: initial.items[2].match! })).rejects.toThrow(/no longer be replaced/)
    const changed = body + '\n'
    await expect(saveExperienceNote(profileId, e.id, changed, e.revision)).resolves.toMatchObject({ ok: true })
    await expect(decide(owner, initial, 0, 'accept')).rejects.toThrow(/saved note changed/)
    const stale = await review(owner)
    expect(stale.stale).toBe(true)
    await expect(decide(owner, stale, 0, 'accept')).rejects.toThrow(/extract again/i)
    const draft = await regenerate(owner, true)
    await decide(owner, draft, 0, 'accept')
    const current = await review(owner)
    expect(current.stale).toBe(false)
    await decide(owner, current, 0, 'accept')
    const landed = await prisma.experience.findUniqueOrThrow({ where: { id: e.id } })
    expect(landed.summary).toBe('## Overview\nOriginal wording  \n\n- I was responsible for staffing\n\n- I manage the calendar\n\n## Scope\n- Responsible for staffing\n- Manage the calendar\n## Achievements\n- Owned the launch\n')
    expect(landed.revision).toBe(e.revision + 3)
    expect(await prisma.roleActivity.count({ where: owner })).toBe(1)
    await expect(saveExperienceNote(profileId, e.id, 'Old editor', e.revision + 1)).resolves.toMatchObject({ ok: false, content: landed.summary })
  })

  it('does not let a delayed extraction clobber edits, decisions, a newer run or project note writes', async () => {
    const e = await role('')
    const p = await project(e.id, 'Atlas', 'Loose prose.\n## Achievements\n- Built a dashboard\n- Grew the team')
    const owner = { projectId: p.id }
    let state = await regenerate(owner)
    vi.mocked(getLLMConfigStatus).mockResolvedValue({ configured: true } as never)
    async function holdExtraction() {
      const started = Promise.withResolvers<void>()
      const finish = Promise.withResolvers<never>()
      vi.mocked(completeStructured).mockImplementationOnce(() => { started.resolve(); return finish.promise })
      const run = regenerateExtractionDraft(profileId, owner, state, true)
      const outcome = run.catch((error: unknown) => error)
      await started.promise
      return { finish: () => finish.resolve({ object: { activities: [], skills: [] } } as never), outcome }
    }
    const run1 = await holdExtraction()
    const item = state.items[0].item
    if (item.kind !== 'achievement') throw new Error('Expected achievement')
    await decide(owner, state, 0, 'save', { edit: { ...item, description: 'I built a dashboard for support' } })
    run1.finish()
    expect(await run1.outcome).toMatchObject({ message: expect.stringMatching(/draft changed/i) })
    state = await review(owner)

    const run2 = await holdExtraction()
    await decide(owner, state, 0, 'accept')
    run2.finish()
    expect(await run2.outcome).toMatchObject({ message: expect.stringMatching(/draft changed/i) })
    expect(await prisma.roleActivity.findFirst({ where: { projectId: p.id } })).toMatchObject({ description: 'I built a dashboard for support', experienceId: e.id })
    state = await review(owner)

    const run3 = await holdExtraction()
    await expect(saveProjectNote(profileId, p.id, p.notes + '\nNew line', p.revision)).resolves.toMatchObject({ ok: true })
    run3.finish()
    expect(await run3.outcome).toMatchObject({ message: expect.stringMatching(/saved note changed/i) })
    state = await review(owner)

    const slower = await holdExtraction()
    const faster = await holdExtraction()
    faster.finish()
    expect(await faster.outcome).toBeUndefined()
    slower.finish()
    expect(await slower.outcome).toMatchObject({ message: expect.stringMatching(/draft changed/i) })
    expect((await review(owner)).items.map(({ item }) => item)).toMatchObject([{ description: 'I grew the team' }, { description: 'I worked on New line' }])
  })
})
