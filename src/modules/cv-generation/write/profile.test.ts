import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/llm/complete-json', () => ({ completeJSON: vi.fn() }))
vi.mock('@/modules/llm/prompt-context', () => ({ composeSystem: (...p: Array<string | null>) => p.filter(Boolean).join('\n\n---\n\n') }))

import { completeJSON } from '@/modules/llm/complete-json'
import { extractJSON } from '@/modules/llm/extract-json'
import { scripted, writeSelection, writeVault } from '../__fixtures__/write'
import { buildBriefFor } from '../__fixtures__/gathered'
import { evidenceFromVault } from './evidence'
import { analyseProfile, experienceDigest, fallbackProfile, labelsFromSelected, maxCompetencyLabels, minCompetencyLabels, profilePrompt, writableCompetencies, writeProfile } from './profile'
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
  profile: 'Delivery leader who turns multi-team programmes into predictable releases for platform organisations.',
  headline: 'Delivery and operations leader | systems thinker',
  competencies: ['Cross-functional leadership'],
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
    expect(r.competenciesMarkdown).toBe(':::skills\n- Cross-functional leadership\n:::')
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
    const { result } = run([{ ...good, competencies: [...good.competencies, 'Change management'] }])
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

  it('shortens a profile over 110 words in code at a clause boundary, with a note and no retry', async () => {
    const first = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ')
    const long = { ...good, profile: `${first}, and then ${Array.from({ length: 20 }, (_, i) => `x${i}`).join(' ')}` }
    const { s, result } = run([long])
    const r = await result
    expect(s.calls).toHaveLength(1)
    expect(r.profileMarkdown).toBe(first)
    expect(r.notes.join(' ')).toMatch(/Shortened the profile from 12\d to 100 words at a clause boundary \(limit 110\)/)
  })

  it('keeps an over-long profile with no clause boundary as written, noted, without a retry', async () => {
    const long = { ...good, profile: Array.from({ length: 125 }, (_, i) => `w${i}`).join(' ') }
    const { s, result } = run([long])
    const r = await result
    expect(s.calls).toHaveLength(1)
    expect(r.notes.join(' ')).toMatch(/profile is 125 words, over the limit of 110/)
  })

  it('shortens an over-long headline at a clause boundary instead of retrying', async () => {
    const long = { ...good, headline: 'Delivery and operations leader, systems thinker, programme builder and release owner for platform teams' }
    const { s, result } = run([long])
    const r = await result
    expect(s.calls).toHaveLength(1)
    expect(r.headline).toBe('Delivery and operations leader, systems thinker')
    expect(r.notes.join(' ')).toMatch(/Shortened the headline/)
  })

  it('retries on a figure that is in neither the experience text nor the evidence', async () => {
    const { s, result } = run([{ ...good, profile: 'Cut release time by 55%.' }, good])
    await result
    expect(s.calls[1].prompt).toMatch(/not in the experience section.*55%/)
  })

  it('accepts a figure from the selected evidence even if the experience text dropped it', () => {
    const a = analyseProfile({ ...good, profile: 'Saved 2 weeks per release.' }, ctx(), { digest: 'nothing numeric', competencies: writableCompetencies(evidence.competencies), maxLabels: 6 })
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
      const a = analyseProfile({ ...good, headline: 'Opened five markets' }, ctx(), { digest, competencies: [], maxLabels: 6 })
      expect(a.headlineUnsupported).toEqual(['five'])
    })
  })

  describe('plain text (nothing markup-like reaches Assemble)', () => {
    it('retries with feedback, then cleans the profile, headline and competency lines', async () => {
      const dirty = {
        profile: '# Delivery leader ![x](http://evil.test/i.png)who ships :::, see [my site](http://x.test) {{contact}}',
        headline: '> **Delivery** leader',
        competencies: ['- Cross-functional <i>leadership</i>'],
      }
      const { s, result } = run([dirty, dirty])
      const r = await result
      expect(s.calls).toHaveLength(2)
      expect(s.calls[1].prompt).toMatch(/the profile contains links or images, HTML tags|the profile contains/)
      expect(s.calls[1].prompt).toContain('"{{"')
      expect(r.profileMarkdown).toBe('Delivery leader who ships , see my site contact')
      expect(r.headline).toBe('Delivery leader')
      expect(r.competenciesMarkdown).toBe(':::skills\n- Cross-functional leadership\n:::')
      expect(`${r.profileMarkdown}${r.headline}${r.competenciesMarkdown}`).not.toMatch(/\{\{|http|<i>|!\[/)
    })
  })

  describe('numbers by value and words', () => {
    it('flags number words and multipliers the experience text does not support', () => {
      const a = analyseProfile({ ...good, profile: 'Leader who opened five markets and doubled revenue.' }, ctx(), { digest, competencies: [], maxLabels: 6 })
      expect(a.unsupported).toEqual(['five', 'doubled'])
    })

    it('accepts forty percent for 40% and 12 for twelve', () => {
      const a = analyseProfile({ ...good, profile: 'Leader who cut release time by forty percent across eight teams.' }, ctx(), { digest, competencies: [], maxLabels: 6 })
      expect(a.unsupported).toEqual([])
    })
  })

  describe('certifications and education', () => {
    const named = (credentials: Array<{ name: string; inProgress: boolean }>) => ctx({ evidence: { ...evidence, credentials } })

    it('fails "PMP-certified" while the PMP is in progress: retried once with feedback, then accepted with a "worth a quick check" note', async () => {
      const bad = { ...good, profile: 'PMP-certified delivery leader for platform organisations.' }
      const { s, result } = run([bad, bad], named([{ name: 'PMP', inProgress: true }]))
      const r = await result
      expect(s.calls).toHaveLength(2)
      expect(s.calls[1].prompt).toMatch(/"PMP" is not finished yet/)
      expect(r.profileMarkdown).toContain('PMP-certified') // nothing is stripped silently
      expect(r.checkNotes).toEqual([expect.stringMatching(/Profile: "PMP" is still in progress.*Worth a quick check/)])
    })

    it('accepts the in-progress wording', () => {
      const a = analyseProfile({ ...good, profile: 'Delivery leader, currently studying for the PMP.' }, named([{ name: 'PMP', inProgress: true }]), { digest, competencies: writableCompetencies(evidence.competencies), maxLabels: 6 })
      expect(a.soft).toEqual([])
    })

    it('flags a certification the evidence text does not mention', () => {
      const a = analyseProfile({ ...good, profile: 'CISM-certified delivery leader.' }, named([{ name: 'CISM', inProgress: false }]), { digest, competencies: [], maxLabels: 6 })
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
    const a = analyseProfile({ ...good, profile: 'Leader of go-to-market launches who briefs the C-suite.' }, claimedGo, { digest, competencies: [], maxLabels: 6 })
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
      expect(f.competenciesMarkdown).toBe(':::skills\n- Cross-functional leadership\n:::')
      expect(f.notes[0]).toMatch(/No time\. The profile section was made by code/)
    })

    it('drops a positioning that claims something the evidence does not support', () => {
      const f = fallbackProfile({ ...base, brief: { ...base.brief, positioning: 'Led 400 people and doubled revenue, PMP-certified.' }, evidence: { ...base.evidence, credentials: [{ name: 'PMP', inProgress: true }] } }, digest, 'No time.')
      expect(f.profileMarkdown).toBe('')
      expect(f.notes.join(' ')).toMatch(/positioning was not used/)
    })

    it('cuts a long positioning to the word limit and cleans it', () => {
      const long = `# ${Array.from({ length: 150 }, () => 'word').join(' ')} :::`
      const f = fallbackProfile({ ...base, brief: { ...base.brief, positioning: long } }, digest, 'No time.')
      expect(f.profileMarkdown.split(' ')).toHaveLength(110)
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
    const p = profilePrompt(ctx(), digest, writableCompetencies(evidence.competencies), 6)
    expect(p).toMatch(/at most 110 words/)
    expect(p).toMatch(/4 to 6 sentences/)
    expect(p).toMatch(/at most 12 words/)
    expect(p).toMatch(/up to 6 labels.*2 to 5 words/)
  })

  it('forbids claiming an outcome or framing for a brief theme the experience section has no bullet about', () => {
    const p = profilePrompt(ctx(), digest, [], 6)
    expect(p).toMatch(/lead-with and emphasise lines are direction, not evidence\. Claim no outcome, programme, result or framing for a project or theme the experience section has no bullet about/)
  })

  it('numbers the employers without naming them', () => {
    expect(digest).toContain('Employer 1 (most recent):\nRan release and planning')
    expect(digest).toContain('Employer 2:\n- Launched')
  })
})

describe('Phase 3b: no cross-section repetition, short competency labels, voice', () => {
  const allowed = { digest, competencies: writableCompetencies(evidence.competencies), maxLabels: 6 }
  // The digest holds 40% (experience bullets); the profile must not restate it.
  const repeating = { ...good, profile: 'Delivery leader who cut release time by 40% for platform organisations.' }

  it('flags a figure that the profile shares with an experience bullet, naming it', () => {
    const a = analyseProfile(repeating, ctx(), allowed)
    expect(a.soft.join(' ')).toMatch(/already appear in the experience bullets.*40%/)
    expect(a.why).toContain('duplicate figure 40%')
    expect(a.repeatedFigures).toEqual(['40%'])
  })

  it('catches the same figure written differently (14k vs 14,000+) in the headline too', () => {
    const d = experienceDigest([{ summary: '', bullets: ['Won the Unity Awards with 14,000+ attendees.'] }])
    const a = analyseProfile({ ...good, headline: 'Event marketer behind 14k-strong awards' }, ctx({ evidence: { ...evidence } }), { ...allowed, digest: d })
    expect(a.repeatedFigures.length).toBeGreaterThan(0)
    expect(a.soft.join(' ')).toMatch(/already appear in the experience bullets/)
  })

  it('retries once with the offending figure named, records why, then accepts with a log note (never fails)', async () => {
    const { s, result } = run([repeating, repeating])
    const r = await result
    expect(s.calls).toHaveLength(2)
    expect(s.calls[1].prompt).toMatch(/already appear in the experience bullets.*40%/)
    expect(r.retryReasons).toEqual(['duplicate figure 40%'])
    expect(r.notes.join(' ')).toMatch(/Accepted with a problem after the retry: these figures already appear in the experience bullets/)
    expect(r.profileMarkdown).toContain('40%') // accepted as written
  })

  it('accepts one figure the experience bullets do not use, and flags a second', () => {
    // 2M players is in the selected evidence but not in this digest.
    const d = experienceDigest([{ summary: '', bullets: ['Shipped on schedule.'] }])
    const one = analyseProfile({ ...good, profile: 'Delivery leader behind a launch for 2M players.' }, ctx(), { ...allowed, digest: d })
    expect(one.soft.join(' ')).not.toMatch(/at most 1 figure/)
    const two = analyseProfile({ ...good, profile: 'Delivery leader behind a launch for 2M players that saved 40% of release time.' }, ctx(), { ...allowed, digest: d })
    expect(two.soft.join(' ')).toMatch(/at most 1 figure.*drop: 40%/)
    expect(two.why).toContain('more than 1 figure in the profile')
  })

  it('does not count small numbers as a repeated figure', () => {
    const a = analyseProfile({ ...good, profile: 'Delivery leader across 8 teams.' }, ctx(), allowed)
    expect(a.repeatedFigures).toEqual([])
  })

  describe('competencies are short noun-phrase labels in a :::skills block', () => {
    it('renders the labels as an inline :::skills list, at most the budget, de-duplicated', async () => {
      const labels = ['Cross-functional leadership', 'cross-functional leadership', 'Release governance', 'Programme planning', 'Stakeholder management', 'Risk and dependency management', 'Delivery operations', 'Change management']
      const { result } = run([{ ...good, competencies: labels }], ctx({ brief: buildBriefFor({ budgets: { experiences: 2, skills: 12, tools: 10, competencies: 5, certifications: 4, education: 3, projects: 2 } }) }))
      const r = await result
      expect(r.competenciesMarkdown).toBe(':::skills\n- Cross-functional leadership\n- Release governance\n- Programme planning\n- Stakeholder management\n- Risk and dependency management\n:::')
    })

    it('retries when a label is a sentence, has a number or is too long; drops what is still bad and notes it', async () => {
      const bad = { ...good, competencies: ['Cross-functional leadership', 'Shipped 12 titles on schedule across eight studios.', 'Leadership', 'Cut release time by 40%'] }
      const { s, result } = run([bad, bad])
      const r = await result
      expect(s.calls).toHaveLength(2)
      expect(s.calls[1].prompt).toMatch(/competency labels must be short noun phrases of 2 to 5 words/)
      expect(r.retryReasons).toContain('competency label format')
      expect(r.competenciesMarkdown).toBe(':::skills\n- Cross-functional leadership\n:::')
      expect(r.notes.join(' ')).toMatch(/Left out of Core Competencies:.*has a number/)
    })

    it('falls back to the selected competency names that already are labels when none is usable', async () => {
      const { result } = run([{ ...good, competencies: ['x'] }])
      const r = await result
      expect(r.competenciesMarkdown).toBe(':::skills\n- Cross-functional leadership\n:::')
      expect(r.notes.join(' ')).toMatch(/no usable competency labels/)
    })

    it('never writes a claimed competency into the section, even as a label', async () => {
      const { result } = run([{ ...good, competencies: ['Cross-functional leadership', 'Change management'] }])
      const r = await result
      expect(r.competenciesMarkdown).not.toContain('Change management')
      expect(r.notes.join(' ')).toMatch(/"Change management" names Change management, which your profile lists without evidence/)
    })

    it('shows no section when the brief budgets none or nothing evidenced is selected', () => {
      expect(maxCompetencyLabels({ brief: buildBriefFor({ budgets: { experiences: 2, skills: 12, tools: 10, competencies: 0, certifications: 4, education: 3, projects: 2 } }), evidence })).toBe(0)
      expect(maxCompetencyLabels({ brief: buildBriefFor(), evidence: { ...evidence, competencies: [] } })).toBe(0)
      expect(maxCompetencyLabels({ brief: buildBriefFor(), evidence })).toBeGreaterThan(0)
    })

    it('labelsFromSelected keeps only names that already are short labels', () => {
      const comp = (name: string) => ({ id: name, name, category: null, level: null, claimed: false })
      expect(labelsFromSelected([comp('Stakeholder management'), comp('Leadership'), comp('Cut release time by 40%'), comp('Stakeholder Management')], 6))
        .toEqual({ labels: ['Stakeholder management'], skipped: ['Leadership', 'Cut release time by 40%'], overflow: [] })
      expect(labelsFromSelected([comp('Stakeholder management'), comp('Release governance')], 1)).toEqual({ labels: ['Stakeholder management'], skipped: [], overflow: ['Release governance'] })
    })

    describe('nothing selected vanishes silently', () => {
      const comp = (name: string, claimed = false) => ({ id: name, name, category: null, level: null, claimed })
      const withComps = (names: string[], budget = 6) => ctx({
        evidence: { ...evidence, competencies: names.map((n) => comp(n)) },
        brief: buildBriefFor({ budgets: { experiences: 2, skills: 12, tools: 10, competencies: budget, certifications: 4, education: 3, projects: 2 } }),
      })

      it('names a selected evidenced competency that no label reflects', async () => {
        const { result } = run([{ ...good, competencies: ['Cross-functional leadership'] }], withComps(['Cross-functional leadership', 'Vendor negotiation']))
        const r = await result
        expect(r.competenciesMarkdown).toBe(':::skills\n- Cross-functional leadership\n:::')
        expect(r.notes.join(' ')).toMatch(/not reflected in Core Competencies.*Vendor negotiation/)
        expect(r.notes.join(' ')).not.toMatch(/Cross-functional leadership\./)
      })

      it('matches on the full name or its words: a reworded label still reflects the competency, a shared first word does not', async () => {
        const { result } = run([{ ...good, competencies: ['Stakeholder and risk management', 'Change communications'] }], withComps(['Stakeholder management', 'Change management']))
        const r = await result
        const note = r.notes.find((n) => /not reflected in Core Competencies/.test(n)) ?? ''
        expect(note).toContain('Change management')
        expect(note).not.toContain('Stakeholder management')
      })

      it('says so when the fallback has more evidenced competencies than room', () => {
        const f = fallbackProfile(withComps(['Release governance', 'Programme planning', 'Stakeholder management'], 2), digest, 'No time.')
        expect(f.competenciesMarkdown).toBe(':::skills\n- Release governance\n- Programme planning\n:::')
        expect(f.notes.join(' ')).toMatch(/not reflected in Core Competencies.*Stakeholder management/)
        expect(f.notes.join(' ')).not.toMatch(/reflected.*Release governance/)
      })

      it('says so when the brief budgets 0 competencies, naming each selected one (writer and fallback)', async () => {
        const c = withComps(['Release governance', 'Programme planning'], 0)
        const f = fallbackProfile(c, digest, 'No time.')
        expect(f.competenciesMarkdown).toBe('')
        expect(f.notes.join(' ')).toMatch(/competency budget is 0.*Release governance, Programme planning/)
        const { result } = run([{ ...good, competencies: [] }], c)
        expect((await result).notes.join(' ')).toMatch(/competency budget is 0.*Release governance, Programme planning/)
      })

      it('when the writer gave no usable label and the fallback names overflow, the overflow is noted', async () => {
        const { result } = run([{ ...good, competencies: ['x'] }], withComps(['Release governance', 'Programme planning', 'Stakeholder management'], 2))
        const r = await result
        expect(r.notes.join(' ')).toMatch(/not reflected in Core Competencies.*Stakeholder management/)
      })
    })

    describe('labels must be grounded in the profile', () => {
      it('flags a label that overlaps no selected competency and no evidence text: one retry, then a check note, label kept', async () => {
        const ungrounded = { ...good, competencies: ['Cross-functional leadership', 'Blockchain tokenomics design'] }
        const { s, result } = run([ungrounded, ungrounded])
        const r = await result
        expect(s.calls).toHaveLength(2)
        expect(s.calls[1].prompt).toMatch(/match none of the selected competencies or the experience evidence.*Blockchain tokenomics design/)
        expect(r.retryReasons.join(' ')).toMatch(/Blockchain tokenomics design/)
        expect(r.competenciesMarkdown).toContain('Blockchain tokenomics design')
        expect(r.checks).toEqual([{ kind: 'competency', text: expect.stringContaining('"Blockchain tokenomics design"') }])
        expect(r.notes.join(' ')).toMatch(/match none of your selected competencies or experience text: Blockchain tokenomics design/)
      })

      it('does not flag a label that shares a word with a selected competency or with the evidence text', () => {
        const a = analyseProfile({ ...good, competencies: ['Leadership across teams', 'Release process improvement'] }, ctx(), { digest, competencies: writableCompetencies(evidence.competencies), maxLabels: 6 })
        expect(a.ungroundedLabels).toEqual([])
      })
    })
  })

  describe('voice', () => {
    it('allows first person in the profile paragraph: no retry, no note', async () => {
      const mine = { ...good, profile: "I build release programmes that run on time. I've designed the planning cadence for platform organisations and I work best with my engineers close." }
      const { s, result } = run([mine])
      const r = await result
      expect(s.calls).toHaveLength(1)
      expect(r.retryReasons).toEqual([])
      expect(r.profileMarkdown).toContain('I build release programmes')
      expect(r.notes.join(' ')).not.toMatch(/first person/)
    })

    it('does not flag first person in the profile, but does flag it everywhere else', () => {
      const a = analyseProfile({ ...good, profile: "I've built things for my teams.", headline: 'My delivery craft', competencies: ['Our delivery model'] }, ctx(), allowed)
      expect(a.soft.filter((x) => /the profile contains/.test(x))).toEqual([])
      expect(a.soft.filter((x) => /first person/.test(x))).toHaveLength(2) // headline and label only
    })

    it('rejects first person in a competency label and in the headline', () => {
      const a = analyseProfile({ ...good, headline: 'My delivery craft', competencies: ['Our delivery model'] }, ctx(), allowed)
      expect(a.soft.filter((x) => /first person/.test(x))).toHaveLength(2)
    })
  })

  describe('the prompt', () => {
    const p = profilePrompt(ctx(), digest, writableCompetencies(evidence.competencies), 6)
    it('opens with positioning for this role, in the brief language and the job key terms', () => {
      expect(p).toMatch(/Open with the positioning for THIS role.*brief's positioning and hidden-question language and the job's key terms/)
      expect(p).toMatch(/what the company or product is/)
    })
    it('allows one figure, and names the ones the experience section already uses', () => {
      expect(p).toMatch(/at most 1 in the profile and headline together/)
      expect(p).toMatch(/those are: 40%, 2M/)
    })
    it('asks for the profile in first person, plain, with no slogans, and no pronouns in the headline or labels', () => {
      expect(p).toMatch(/in the first person \("I build \.\.\.", "I've designed \.\.\."; here and nowhere else\)/)
      expect(p).toMatch(/No slogans and no storyteller phrases/)
      expect(p).toMatch(/never a job title or seniority level; no first person/)
      expect(p).toMatch(/2 to 5 words, with no numbers and no sentence/)
    })
    it('prefers a figure the experience section does not state, or none', () => {
      expect(p).toMatch(/Lead with a figure only when it is NOT stated in the experience section/)
      expect(p).toMatch(/prefer a different figure from the evidence, or none/)
    })
    it('says not to state years of experience while the number is unset (pending the owner)', () => {
      expect(p).toContain('Do not state a number of years of experience.')
      expect(p).not.toMatch(/Open with how long/)
    })
    it('asks for the years opener only when a number is given, and accepts that number as a supported figure', () => {
      const withYears = profilePrompt({ ...ctx(), yearsOfExperience: 15 }, digest, writableCompetencies(evidence.competencies), 6)
      expect(withYears).toMatch(/Open with how long the candidate has done this work: 15 years of experience/)
      const a = analyseProfile({ ...good, profile: "I've spent 15 years turning programmes into predictable releases." }, { ...ctx(), yearsOfExperience: 15 }, allowed)
      expect(a.unsupported).toEqual([])
      expect(analyseProfile({ ...good, profile: "I've spent 15 years turning programmes into predictable releases." }, ctx(), allowed).unsupported).toEqual(['15'])
    })
  })
})

describe('competency labels up to the budget (floors)', () => {
  const comp = (name: string) => ({ id: name, name, category: null, level: null, claimed: false })
  const names = ['Release governance', 'Programme planning', 'Stakeholder management', 'Vendor negotiation', 'Risk management', 'Team coaching', 'Budget ownership', 'Roadmap strategy']
  const withComps = (list: string[], budget = 8) => ctx({
    evidence: { ...evidence, competencies: list.map(comp) },
    brief: buildBriefFor({ budgets: { experiences: 4, skills: 12, tools: 10, competencies: budget, certifications: 6, education: 3, projects: 2 } }),
  })

  it('allows up to 8 labels, and asks for 6 to 8 when the profile has at least 6 competencies', () => {
    const c = withComps(names)
    expect(maxCompetencyLabels(c)).toBe(8)
    expect(minCompetencyLabels(c, 8)).toBe(6)
    const p = profilePrompt(c, digest, writableCompetencies(c.evidence.competencies), 8, 6)
    expect(p).toMatch(/write 6 to 8 labels/)
    expect(p).toMatch(/chosen competencies above and the key terms of the job's requirements/)
  })

  it('asks for no minimum when the profile has fewer than 6 competencies (it is not padded)', () => {
    const c = withComps(names.slice(0, 4))
    expect(minCompetencyLabels(c, 8)).toBe(0)
    expect(profilePrompt(c, digest, writableCompetencies(c.evidence.competencies), 8, 0)).toMatch(/write up to 8 labels/)
  })

  it('keeps eight labels from the writer (the old cap was six)', async () => {
    const c = withComps(names)
    const { s, result } = run([{ ...good, competencies: names }], c)
    const r = await result
    expect(s.calls).toHaveLength(1)
    expect(r.competenciesMarkdown.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(8)
  })

  it('tops up to 6 from the selected competencies when the writer returned fewer, noting it, with no retry', async () => {
    const c = withComps(names)
    const { s, result } = run([{ ...good, competencies: names.slice(0, 5) }], c)
    const r = await result
    expect(s.calls).toHaveLength(1)
    const lines = r.competenciesMarkdown.split('\n').filter((l) => l.startsWith('- '))
    expect(lines).toHaveLength(6)
    expect(lines[5]).toBe(`- ${names[5]}`)
    expect(r.notes.join(' ')).toMatch(/had 5 competency labels; added 1 from your selected competencies to reach 6/)
  })

  it('still names a selected competency that no label reflects', async () => {
    const c = withComps(names)
    const { result } = run([{ ...good, competencies: names.slice(0, 6) }], c)
    const r = await result
    expect(r.notes.join(' ')).toMatch(/not reflected in Core Competencies.*Budget ownership.*Roadmap strategy/)
  })
})
