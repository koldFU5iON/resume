import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/llm/complete-json', () => ({ completeJSON: vi.fn() }))
vi.mock('@/modules/llm/prompt-context', () => ({ composeSystem: (...p: Array<string | null>) => p.filter(Boolean).join('\n\n---\n\n') }))

import { completeJSON } from '@/modules/llm/complete-json'
import { extractJSON } from '@/modules/llm/extract-json'
import { scripted, writeSelection, writeVault } from '../__fixtures__/write'
import { buildBriefFor } from '../__fixtures__/gathered'
import { evidenceFromVault } from './evidence'
import { analyseProfile, experienceDigest, profilePrompt, writableCompetencies, writeProfile } from './profile'
import { requirementText } from './prompt'
import type { WriteContext } from './types'

const mockJSON = vi.mocked(completeJSON)
const vault = writeVault()
const evidence = evidenceFromVault(vault, writeSelection(vault))
const strategy = { mustHave: ['Delivery'], niceToHave: [] as string[] }
const ctx = (over: Partial<WriteContext> = {}): WriteContext => ({
  profileId: 'p1', jobApplicationId: 'job-1', runId: 'run-1', deadline: Date.now() + 200_000,
  brief: buildBriefFor(), strategy, evidence, requirementText: requirementText(strategy), ...over,
})
const instructions = { rules: 'RULES', brief: null, prompt: 'INSTRUCTIONS' }
const digest = experienceDigest([
  { summary: 'Ran release and planning for the platform org.', bullets: ['Cut platform release time by 40% across 8 teams.', 'Shipped 12 titles on schedule.'] },
  { summary: '', bullets: ['Launched a live-service title for 2M players.'] },
])
const good = {
  profile: 'Delivery leader who turns multi-team programmes into predictable releases, cutting release time by 40% across 8 teams.',
  headline: 'Delivery and operations leader | systems thinker',
  competencies: [{ name: 'Cross-functional leadership', line: 'Cross-functional leadership: shipped 12 titles on schedule' }],
}
const run = (replies: Array<object | 'junk'>, c = ctx()) => {
  const s = scripted((t, sch) => extractJSON(t, sch as never), replies)
  mockJSON.mockImplementation(s.impl as never)
  return { s, result: writeProfile(c, digest, instructions) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('writeProfile', () => {
  it('writes the profile, headline and competency lines in one call on the default role', async () => {
    const { s, result } = run([good])
    const r = await result
    expect(s.calls).toHaveLength(1)
    expect(s.calls[0].opts).toMatchObject({ role: 'default', feature: 'cv-gen-write-profile', attribution: { jobApplicationId: 'job-1', runId: 'run-1' } })
    expect(s.calls[0].opts.system).toContain('RULES')
    expect(r.profileMarkdown).toContain('Delivery leader')
    expect(r.headline).toBe('Delivery and operations leader | systems thinker')
    expect(r.competenciesMarkdown).toBe(':::compact-list\n- Cross-functional leadership: shipped 12 titles on schedule\n:::')
  })

  it('shows the model the wave-1 text (no names, titles or dates) and only the evidenced competencies', async () => {
    const { s, result } = run([good])
    await result
    const prompt = s.calls[0].prompt
    expect(prompt).toContain('Cut platform release time by 40% across 8 teams.')
    expect(prompt).toContain('Cross-functional leadership')
    expect(prompt).not.toContain('Change management') // claimed: never given to the writer
    for (const secret of ['robin@example.test', 'Robin Placeholder', 'Unity', 'Snr. Program Manager']) expect(prompt).not.toContain(secret)
  })

  it('leaves out a claimed competency, with a note, instead of giving it an outcome line', async () => {
    const { result } = run([{ ...good, competencies: [...good.competencies, { name: 'Change management', line: 'Change management: led a rollout' }] }])
    const r = await result
    expect(r.competenciesMarkdown).not.toContain('Change management')
    expect(r.notes.join(' ')).toMatch(/Left out of Core Competencies.*Change management.*Skills and Tools lists only/)
  })

  it('retries once when the headline reads as a title, then drops it if it still does', async () => {
    const bad = { ...good, headline: 'Director of Delivery' }
    const { s, result } = run([bad, bad])
    const r = await result
    expect(s.calls).toHaveLength(2)
    expect(s.calls[1].prompt).toMatch(/headline is not acceptable.*"director"/)
    expect(r.headline).toBeNull()
    expect(r.notes.join(' ')).toMatch(/headline was left out/)
  })

  it('keeps the headline the retry fixed', async () => {
    const { s, result } = run([{ ...good, headline: 'Program Manager' }, good])
    const r = await result
    expect(s.calls).toHaveLength(2)
    expect(r.headline).toBe(good.headline)
  })

  it('retries when the profile is over 80 words', async () => {
    const long = { ...good, profile: Array.from({ length: 90 }, (_, i) => `w${i}`).join(' ') }
    const { s, result } = run([long, good])
    await result
    expect(s.calls[1].prompt).toMatch(/profile is 90 words; it must be at most 80/)
  })

  it('retries on a figure that is in neither the experience text nor the evidence', async () => {
    const { s, result } = run([{ ...good, profile: 'Cut release time by 55%.' }, good])
    await result
    expect(s.calls[1].prompt).toMatch(/not in the experience section.*55%/)
  })

  it('accepts a figure from the selected evidence even if the experience text dropped it', () => {
    const a = analyseProfile({ ...good, profile: 'Saved 2 weeks per release.' }, ctx(), { digest: 'nothing numeric', competencies: writableCompetencies(evidence.competencies) })
    expect(a.unsupported).toEqual([])
  })

  it('blocks a claimed tool in the profile unless the job asks for it, and notes the one it asks for', async () => {
    const tableau = { ...good, profile: 'Delivery leader who builds Tableau dashboards for 8 teams.' }
    const blocked = run([tableau, tableau])
    const r1 = await blocked.result
    expect(blocked.s.calls[1].prompt).toMatch(/does not ask for them.*Tableau/)
    expect(r1.checkNotes).toEqual([])

    const asked = run([tableau], ctx({ requirementText: 'Tableau reporting' }))
    const r2 = await asked.result
    expect(asked.s.calls).toHaveLength(1)
    expect(r2.checkNotes).toEqual([expect.stringMatching(/Profile: "Tableau".*the job asks for it/)])
  })

  it('fails with invalid_output on an empty profile twice', async () => {
    const { s, result } = run([{ ...good, profile: '  ' }])
    await expect(result).rejects.toMatchObject({ kind: 'invalid_output' })
    expect(s.calls).toHaveLength(2)
  })

  it('writes no competencies section when none is evidenced', async () => {
    const none = ctx({ evidence: { ...evidence, competencies: evidence.competencies.filter((c) => c.claimed) } })
    const { s, result } = run([{ ...good, competencies: [] }], none)
    const r = await result
    expect(r.competenciesMarkdown).toBe('')
    expect(s.calls[0].prompt).toContain('(none: return an empty list)')
  })
})

describe('profilePrompt and helpers', () => {
  it('lists the limits, and only evidenced competencies are writable', () => {
    expect(writableCompetencies(evidence.competencies).map((c) => c.name)).toEqual(['Cross-functional leadership'])
    const p = profilePrompt(ctx(), digest, writableCompetencies(evidence.competencies))
    expect(p).toMatch(/at most 80 words/)
    expect(p).toMatch(/at most 12 words/)
    expect(p).toMatch(/at most 1 lines/)
  })

  it('numbers the employers without naming them', () => {
    expect(digest).toContain('Employer 1 (most recent):\nRan release and planning')
    expect(digest).toContain('Employer 2:\n- Launched')
  })
})
