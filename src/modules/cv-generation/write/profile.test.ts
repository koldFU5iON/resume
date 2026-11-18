import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/llm/complete-json', () => ({ completeJSON: vi.fn() }))
vi.mock('@/modules/llm/prompt-context', () => ({ composeSystem: (...p: Array<string | null>) => p.filter(Boolean).join('\n\n---\n\n') }))

import { completeJSON } from '@/modules/llm/complete-json'
import { extractJSON } from '@/modules/llm/extract-json'
import { scripted, writeSelection, writeVault } from '../__fixtures__/write'
import { buildBriefFor } from '../__fixtures__/gathered'
import { evidenceFromVault } from './evidence'
import { analyseProfile, experienceDigest, fallbackProfile, profilePrompt, writableCompetencies, writeProfile } from './profile'
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

  describe('headline: dropped only for an UNSUPPORTED figure', () => {
    it.each(['B2B SaaS product leader', 'Web3 delivery and platform operator', '24/7 operations and incident leader', 'GA4 and Q3 planning specialist'])('keeps "%s"', async (headline) => {
      const { s, result } = run([{ ...good, headline }])
      const r = await result
      expect(s.calls).toHaveLength(1)
      expect(r.headline).toBe(headline)
    })

    it('drops a headline whose figure the evidence does not support, after one retry', async () => {
      const bad = { ...good, headline: '15 years of delivery leadership' }
      const { s, result } = run([bad, bad])
      const r = await result
      expect(s.calls).toHaveLength(2)
      expect(s.calls[1].prompt).toMatch(/not in the experience section.*15/)
      expect(r.headline).toBeNull()
      expect(r.notes.join(' ')).toMatch(/headline was left out: it has figures the evidence does not support \(15\)/)
    })

    it('keeps a headline figure the evidence supports', async () => {
      const { result } = run([{ ...good, headline: 'Shipped 12 titles at scale' }])
      expect((await result).headline).toBe('Shipped 12 titles at scale')
    })

    it('drops a number word headline the evidence does not support', () => {
      const a = analyseProfile({ ...good, headline: 'Opened five markets' }, ctx(), { digest, competencies: [] })
      expect(a.headlineUnsupported).toEqual(['five'])
    })
  })

  describe('plain text (nothing markup-like reaches Assemble)', () => {
    it('retries with feedback, then cleans the profile, headline and competency lines', async () => {
      const dirty = {
        profile: '# Delivery leader ![x](http://evil.test/i.png)who ships :::, see [my site](http://x.test) {{contact}}',
        headline: '> **Delivery** leader',
        competencies: [{ name: 'Cross-functional leadership', line: '- Cross-functional leadership: shipped 12 titles <i>on schedule</i>' }],
      }
      const { s, result } = run([dirty, dirty])
      const r = await result
      expect(s.calls).toHaveLength(2)
      expect(s.calls[1].prompt).toMatch(/the profile contains links or images, HTML tags|the profile contains/)
      expect(s.calls[1].prompt).toContain('"{{"')
      expect(r.profileMarkdown).toBe('Delivery leader who ships , see my site contact')
      expect(r.headline).toBe('Delivery leader')
      expect(r.competenciesMarkdown).toBe(':::compact-list\n- Cross-functional leadership: shipped 12 titles on schedule\n:::')
      expect(`${r.profileMarkdown}${r.headline}${r.competenciesMarkdown}`).not.toMatch(/\{\{|http|<i>|!\[/)
    })
  })

  describe('numbers by value and words', () => {
    it('flags number words and multipliers the experience text does not support', () => {
      const a = analyseProfile({ ...good, profile: 'Leader who opened five markets and doubled revenue.' }, ctx(), { digest, competencies: [] })
      expect(a.unsupported).toEqual(['five', 'doubled'])
    })

    it('accepts forty percent for 40% and 12 for twelve', () => {
      const a = analyseProfile({ ...good, profile: 'Leader who cut release time by forty percent across eight teams.' }, ctx(), { digest, competencies: [] })
      expect(a.unsupported).toEqual([])
    })
  })

  describe('certifications and education', () => {
    const named = (credentials: Array<{ name: string; inProgress: boolean }>) => ctx({ evidence: { ...evidence, credentials } })

    it('fails "PMP-certified" while the PMP is in progress: retried once with feedback, then accepted with a "worth a quick check" note', async () => {
      const bad = { ...good, profile: 'PMP-certified delivery leader who cut release time by 40% across 8 teams.' }
      const { s, result } = run([bad, bad], named([{ name: 'PMP', inProgress: true }]))
      const r = await result
      expect(s.calls).toHaveLength(2)
      expect(s.calls[1].prompt).toMatch(/"PMP" is not finished yet/)
      expect(r.profileMarkdown).toContain('PMP-certified') // nothing is stripped silently
      expect(r.checkNotes).toEqual([expect.stringMatching(/Profile: "PMP" is still in progress.*Worth a quick check/)])
    })

    it('accepts the in-progress wording', () => {
      const a = analyseProfile({ ...good, profile: 'Delivery leader, currently studying for the PMP.' }, named([{ name: 'PMP', inProgress: true }]), { digest, competencies: [] })
      expect(a.soft).toEqual([])
    })

    it('flags a certification the evidence text does not mention', () => {
      const a = analyseProfile({ ...good, profile: 'CISM-certified delivery leader.' }, named([{ name: 'CISM', inProgress: false }]), { digest, competencies: [] })
      expect(a.soft.join(' ')).toMatch(/"CISM" is a certification or qualification the evidence does not mention/)
    })
  })

  it('flags title-like phrases that are not the candidate\'s titles ("As Head of Delivery...")', async () => {
    const { s, result } = run([{ ...good, profile: 'As Head of Delivery I turned programmes into predictable releases.' }, good])
    await result
    expect(s.calls[1].prompt).toMatch(/do not write job titles.*Head of Delivery/)
  })

  it('does not call a short claimed name in "go-to-market" or "C-suite"', () => {
    const claimedGo = ctx({ evidence: { ...evidence, claimedNames: [...evidence.claimedNames, 'Go', 'C'] } })
    const a = analyseProfile({ ...good, profile: 'Leader of go-to-market launches who briefs the C-suite.' }, claimedGo, { digest, competencies: [] })
    expect(a.claimed).toEqual([])
  })

  describe('fallbackProfile (no model call)', () => {
    const base = ctx()

    it('uses the brief\'s positioning as the profile, the evidenced competency names as lines, and no headline', () => {
      const f = fallbackProfile(base, digest, 'No time.')
      expect(f.model).toBeNull()
      expect(f.usage.calls).toBe(0)
      expect(f.headline).toBeNull()
      expect(f.profileMarkdown).toBe(base.brief.positioning)
      expect(f.competenciesMarkdown).toBe(':::compact-list\n- Cross-functional leadership\n:::')
      expect(f.notes[0]).toMatch(/No time\. The profile section was made by code/)
    })

    it('drops a positioning that claims something the evidence does not support', () => {
      const f = fallbackProfile({ ...base, brief: { ...base.brief, positioning: 'Led 400 people and doubled revenue, PMP-certified.' }, evidence: { ...base.evidence, credentials: [{ name: 'PMP', inProgress: true }] } }, digest, 'No time.')
      expect(f.profileMarkdown).toBe('')
      expect(f.notes.join(' ')).toMatch(/positioning was not used/)
    })

    it('cuts a long positioning to the word limit and cleans it', () => {
      const long = `# ${Array.from({ length: 120 }, () => 'word').join(' ')} :::`
      const f = fallbackProfile({ ...base, brief: { ...base.brief, positioning: long } }, digest, 'No time.')
      expect(f.profileMarkdown.split(' ')).toHaveLength(80)
      expect(f.profileMarkdown).not.toMatch(/#|:::/)
    })
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
