import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/modules/llm/prompt-context', () => ({
  composeSystem: (...p: string[]) => p.join('\n---\n'),
  loadCVSelectPrompt: vi.fn().mockResolvedValue('SELECT INSTRUCTIONS'),
}))
vi.mock('./call', () => ({ completeValidated: vi.fn() }))

import { LLMError } from '@/modules/llm/errors'
import { completeValidated } from './call'
import { ACTIVITIES_PER_ROLE, FLAT_CAPS, MAX_EXPERIENCES, MAX_RECORDED_DROPPED, activityBudget } from './caps'
import {
  briefTerms, enforceSelection, fallbackSelection, runSelect, selectPrompt, selectionLogLines, SelectOutputSchema, type SelectOutput,
} from './select'
import { CvSelectionSchema } from './schema'
import { bigCandidates, brief } from './__fixtures__/candidates'
import { buildBriefFor, gathered } from './__fixtures__/gathered'

const call = vi.mocked(completeValidated)
const pick = (...ids: string[]) => ids.map((id) => ({ id, reason: `why ${id}` }))
const empty: SelectOutput = { experiences: [], activities: [], skills: [], tools: [], competencies: [], certifications: [], education: [], projects: [] }

describe('caps', () => {
  it('are the legacy numbers', () => {
    expect([...ACTIVITIES_PER_ROLE]).toEqual([5, 4, 3])
    expect(MAX_EXPERIENCES).toBe(4)
    expect(FLAT_CAPS).toEqual({ skills: 12, tools: 10, competencies: 6, certifications: 4, education: 3, projects: 2 })
    expect([activityBudget(0), activityBudget(1), activityBudget(2), activityBudget(9)]).toEqual([5, 4, 3, 3])
  })
})

describe('enforceSelection', () => {
  const cands = bigCandidates()

  it('truncates every list to its cap in the model’s rank order', () => {
    const out: SelectOutput = {
      ...empty,
      experiences: pick('e0', 'e1', 'e2', 'e3', 'e4', 'e5'),
      activities: cands.experiences.flatMap((e) => e.activities.map((a) => ({ experienceId: e.id, id: a.id, reason: 'r' }))),
      skills: pick(...cands.skills.map((s) => s.id)),
      tools: pick(...cands.tools.map((s) => s.id)),
      competencies: pick(...cands.competencies.map((s) => s.id)),
      certifications: pick(...cands.certifications.map((s) => s.id)),
      education: pick(...cands.education.map((s) => s.id)),
      projects: pick(...cands.projects.map((s) => s.id)),
    }
    const { selection: s } = enforceSelection(out, cands, brief)
    expect(s.experiences.map((e) => e.id)).toEqual(['e0', 'e1', 'e2', 'e3'])
    expect(s.activities.e0).toHaveLength(5)
    expect(s.activities.e1).toHaveLength(4)
    expect(s.activities.e2).toHaveLength(3)
    expect(s.activities.e3).toHaveLength(3)
    expect(s.activities.e0.map((a) => a.id)).toEqual(['e0a0', 'e0a1', 'e0a2', 'e0a3', 'e0a4'])
    expect(s.skills).toHaveLength(12)
    expect(s.tools).toHaveLength(10)
    expect(s.competencies).toHaveLength(6)
    expect(s.certifications).toHaveLength(4)
    expect(s.education).toHaveLength(3)
    expect(s.projects).toHaveLength(2)
    expect(s.skills.map((i) => i.id)).toEqual(cands.skills.slice(0, 12).map((i) => i.id))
    expect(s.dropped.find((d) => d.id === 's12')?.why).toBe('over_cap')
    expect(s.dropped.find((d) => d.id === 'e4')?.why).toBe('over_cap')
  })

  it('tiers activities by the role’s place among the KEPT roles, not the profile', () => {
    const out: SelectOutput = {
      ...empty,
      experiences: pick('e2', 'e0'),
      activities: [...cands.experiences[2].activities, ...cands.experiences[0].activities].map((a, i) => ({
        experienceId: i < 8 ? 'e2' : 'e0', id: a.id, reason: '',
      })),
    }
    const { selection: s } = enforceSelection(out, cands, brief)
    expect(s.experiences.map((e) => e.id)).toEqual(['e0', 'e2'])
    expect(s.activities.e0).toHaveLength(5)
    expect(s.activities.e2).toHaveLength(4)
  })

  it('drops unknown ids and duplicates, and says so', () => {
    const out: SelectOutput = {
      ...empty,
      experiences: pick('e1', 'e1', 'nope'),
      skills: pick('s0', 'ghost', 's0', 't0', 's1'),
    }
    const r = enforceSelection(out, cands, brief)
    expect(r.selection.skills.map((s) => s.id)).toEqual(['s0', 's1'])
    expect(r.selection.dropped.filter((d) => d.why === 'unknown_id').map((d) => d.id)).toEqual(expect.arrayContaining(['nope', 'ghost', 't0']))
    expect(r.selection.dropped.filter((d) => d.why === 'duplicate').length).toBe(2)
    expect(r.notes.join(' ')).toContain('not in the profile')
    expect(r.recognised).toBe(3) // e1, s0, s1
  })

  it('does not accept an id from another section', () => {
    const r = enforceSelection({ ...empty, skills: pick('t0'), tools: pick('s0') }, cands, brief)
    expect(r.selection.skills).toEqual([])
    expect(r.selection.tools).toEqual([])
  })

  it('always keeps the most recent role, replacing the weakest pick when the budget is full', () => {
    const r = enforceSelection({ ...empty, experiences: pick('e3', 'e2', 'e1', 'e4') }, cands, brief)
    // e4 (the weakest pick) makes room; roles show newest first.
    expect(r.selection.experiences.map((e) => e.id)).toEqual(['e0', 'e1', 'e2', 'e3'])
    expect(r.selection.dropped.find((d) => d.id === 'e4')?.why).toBe('over_cap')
    expect(r.selection.dropped.find((d) => d.id === 'e0')).toBeUndefined()
    expect(r.notes.join(' ')).toContain('most recent role')
  })

  it('keeps the most recent role even when the model picks no role at all', () => {
    const r = enforceSelection(empty, cands, brief)
    expect(r.selection.experiences.map((e) => e.id)).toEqual(['e0'])
  })

  it('honours a smaller brief budget, but never lets a stored brief exceed a cap', () => {
    const small = { budgets: { ...brief.budgets, skills: 3, experiences: 2 } }
    const a = enforceSelection({ ...empty, experiences: pick('e0', 'e1', 'e2'), skills: pick('s0', 's1', 's2', 's3', 's4') }, cands, small)
    expect(a.selection.experiences).toHaveLength(2)
    expect(a.selection.skills).toHaveLength(3)

    const greedy = { budgets: { ...brief.budgets, skills: 999, experiences: 99, tools: -5 } }
    const b = enforceSelection({ ...empty, experiences: pick('e0', 'e1', 'e2', 'e3', 'e4'), skills: pick(...cands.skills.map((s) => s.id)), tools: pick('t0') }, cands, greedy)
    expect(b.selection.experiences).toHaveLength(MAX_EXPERIENCES)
    expect(b.selection.skills).toHaveLength(FLAT_CAPS.skills)
    expect(b.selection.tools).toHaveLength(0)
  })

  it('ignores an activity of a role that was not kept, and uses the activity’s true role', () => {
    const out: SelectOutput = {
      ...empty,
      experiences: pick('e0'),
      activities: [
        { experienceId: 'e0', id: 'e5a0', reason: '' },     // role e5 not kept
        { experienceId: 'e9', id: 'e0a1', reason: 'ok' },  // wrong parent given, but it is e0's
      ],
    }
    const { selection: s } = enforceSelection(out, cands, brief)
    expect(s.activities.e0.map((a) => a.id)).toEqual(['e0a1'])
    expect(s.dropped.find((d) => d.id === 'e5a0')?.why).toBe('role_not_kept')
  })

  it('fills a kept role that got no activities by rule (highlighted, achievements first)', () => {
    const c = bigCandidates(2, 6)
    c.experiences[0].activities[3].highlighted = true
    const r = enforceSelection({ ...empty, experiences: pick('e0', 'e1') }, c, brief)
    expect(r.selection.activities.e0[0].id).toBe('e0a3')
    expect(r.selection.activities.e0).toHaveLength(5)
    expect(r.selection.activities.e1).toHaveLength(4)
    expect(r.notes.join(' ')).toContain('chose the highlighted and achievement ones by rule')
  })

  it('keeps the newest education when the model picked none', () => {
    const r = enforceSelection(empty, cands, brief)
    expect(r.selection.education.map((e) => e.id)).toEqual(['ed0', 'ed1', 'ed2'])
  })

  it('labels what it keeps and records why items were dropped, bounded in size', () => {
    const r = enforceSelection({ ...empty, experiences: pick('e0'), skills: pick('s0') }, cands, brief)
    expect(r.selection.skills[0]).toEqual({ id: 's0', label: 'Skill 0', reason: 'why s0' })
    expect(r.selection.dropped.find((d) => d.id === 's1')?.why).toBe('not_selected')
    const huge = bigCandidates(4, 8, 400)
    const big = enforceSelection(empty, huge, brief)
    expect(big.selection.dropped.length).toBeLessThanOrEqual(MAX_RECORDED_DROPPED)
    expect(big.selection.droppedTotal).toBeGreaterThan(MAX_RECORDED_DROPPED)
  })

  it('produces a selection that passes its own schema (what is stored)', () => {
    const r = enforceSelection({ ...empty, experiences: pick('e0'), skills: pick('s0') }, cands, brief)
    expect(CvSelectionSchema.safeParse(r.selection).success).toBe(true)
  })
})

describe('SelectOutputSchema', () => {
  it('tolerates missing lists and long reasons', () => {
    const parsed = SelectOutputSchema.parse({ skills: [{ id: 's0', reason: 'x'.repeat(500) }] })
    expect(parsed.experiences).toEqual([])
    expect(parsed.skills[0].reason).toHaveLength(160)
  })
})

describe('fallbackSelection', () => {
  it('chooses by recency, highlights and brief terms, within the caps', () => {
    const c = bigCandidates()
    c.skills[7].label = 'Release management'
    c.experiences[2].activities[5].text = 'Led release management for the platform migration'
    const r = fallbackSelection({ ...brief, leadWith: ['Platform migration'], emphasise: [{ item: 'Release management', why: 'x' }] }, c)
    const s = r.selection
    expect(s.mode).toBe('fallback')
    expect(s.experiences[0].id).toBe('e0')
    expect(s.experiences.map((e) => e.id)).toContain('e2') // matches the brief
    expect(s.experiences).toHaveLength(4)
    expect(s.skills[0].id).toBe('s7')
    expect(s.skills[0].reason).toContain('Matches the brief')
    expect(s.skills).toHaveLength(12)
    expect(s.tools).toHaveLength(10)
    expect(s.projects).toHaveLength(2)
    expect(s.education).toHaveLength(3)
    for (const e of s.experiences) expect(s.activities[e.id].length).toBeGreaterThan(0)
  })

  it('extracts distinct terms without filler', () => {
    expect(briefTerms({ leadWith: ['The platform migration'], emphasise: [{ item: 'Platform and Terraform', why: '' }] })).toEqual(['platform', 'migration', 'terraform'])
  })
})

describe('runSelect', () => {
  const g = gathered()
  const ctx = { profileId: 'p1', jobApplicationId: 'job-1', runId: 'run-1', deadline: Date.now() + 60_000 }
  beforeEach(() => vi.clearAllMocks())

  it('calls the fast role with the select tag and the run attribution', async () => {
    call.mockResolvedValue({ value: { ...empty, experiences: pick('e0'), skills: pick('s0') }, model: 'm-fast', retries: 0 })
    const r = await runSelect(g, buildBriefFor(), ctx)
    expect(call).toHaveBeenCalledWith('p1', expect.stringContaining('[e0]'), SelectOutputSchema, expect.objectContaining({
      role: 'fast', feature: 'cv-gen-select', attribution: { jobApplicationId: 'job-1', runId: 'run-1' },
    }))
    expect(r).toMatchObject({ model: 'm-fast', retries: 0 })
    expect(r.selection.mode).toBe('model')
    expect(r.selection.skills.map((s) => s.id)).toEqual(['s0'])
  })

  it('falls back, and records it, when the call throws', async () => {
    call.mockRejectedValue(new LLMError('slow', 'timeout'))
    const r = await runSelect(g, buildBriefFor(), ctx)
    expect(r.model).toBeNull()
    expect(r.selection.mode).toBe('fallback')
    expect(r.notes[0]).toContain('Chose by rules instead')
    expect(r.notes[0]).toContain('timeout')
    expect(r.selection.experiences.length).toBeGreaterThan(0)
  })

  it('falls back when the answer names nothing real', async () => {
    call.mockResolvedValue({ value: { ...empty, skills: pick('x1', 'x2'), experiences: pick('zzz') }, model: 'm-fast', retries: 1 })
    const r = await runSelect(g, buildBriefFor(), ctx)
    expect(r.selection.mode).toBe('fallback')
    expect(r.retries).toBe(1)
    expect(r.notes[0]).toContain('no item that is in the profile')
  })

  it('does not fail on an unexpected error either', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    call.mockRejectedValue(new Error('boom'))
    expect((await runSelect(g, buildBriefFor(), ctx)).selection.mode).toBe('fallback')
  })
})

describe('selectionLogLines', () => {
  it('lists kept items by section and only what code cut', () => {
    const c = bigCandidates()
    const { selection } = enforceSelection({ ...empty, experiences: pick('e0'), skills: pick('s0', 's1', 'ghost'), activities: [{ experienceId: 'e0', id: 'e0a0', reason: '' }] }, c, { budgets: { ...brief.budgets, skills: 1 } })
    const lines = selectionLogLines(selection)
    expect(lines.kept).toEqual(expect.arrayContaining(['Role: Role 0 — Co 0', 'Skill: Skill 0']))
    expect(lines.kept.some((k) => k.startsWith('Activity: Activity 0 of role 0'))).toBe(true)
    expect(lines.dropped).toEqual(expect.arrayContaining(['Skill: Skill 1 (over the limit)', 'Skill: ghost (not in the profile)']))
    expect(lines.dropped.every((d) => !d.includes('not selected'))).toBe(true)
    expect(lines.notSelected).toBeGreaterThan(10)
  })
})

describe('selectPrompt', () => {
  it('carries the brief, the budgets and every candidate id', () => {
    const text = selectPrompt(buildBriefFor(), bigCandidates(2, 2))
    expect(text).toContain('Can they ship a platform migration?')
    expect(text).toContain('Activities per role: 5')
    expect(text).toContain('[e1a1]')
  })
})
