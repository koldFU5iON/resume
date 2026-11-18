import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/llm/complete-json', () => ({ completeJSON: vi.fn() }))
vi.mock('@/modules/llm/prompt-context', () => ({
  composeSystem: (...p: Array<string | null>) => p.filter(Boolean).join('\n\n---\n\n'),
  loadWritingContext: vi.fn(),
  loadCVWriteExperiencePrompt: vi.fn(),
  loadCVWriteSkillsPrompt: vi.fn(),
  loadCVWriteProfilePrompt: vi.fn(),
}))

import { completeJSON } from '@/modules/llm/complete-json'
import { extractJSON } from '@/modules/llm/extract-json'
import { loadCVWriteExperiencePrompt, loadCVWriteProfilePrompt, loadCVWriteSkillsPrompt, loadWritingContext } from '@/modules/llm/prompt-context'
import { buildVault } from '@/modules/profile-map/build'
import { vaultSource } from '@/modules/profile-map/__fixtures__/source'
import { buildCandidates } from '../candidates'
import { buildBriefFor } from '../__fixtures__/gathered'
import { BLIZZARD, OLD_CO, UNITY, llmReply, projectRow, writeSelection, writeVault, writeVaultSource } from '../__fixtures__/write'
import { LLMError } from '@/modules/llm/errors'
import { WRITE_CONCURRENCY } from '../schema'
import { ASSEMBLE_RESERVE_MS, WAVE2_RESERVE_MS } from './limits'
import { enforceSelection } from '../select'
import { runWrite, WriteStageError } from './run-write'

const mockJSON = vi.mocked(completeJSON)
const strategy = { mustHave: ['Delivery'], niceToHave: [] as string[] }
const ctx = (over: Partial<{ deadline: number }> = {}) => ({ profileId: 'p1', jobApplicationId: 'job-1', runId: 'run-1', deadline: Date.now() + 250_000, ...over })

type Seen = { feature: string; prompt: string; system: string; at: number; deadline: number }
let seen: Seen[] = []
let active = 0
let peak = 0
let experienceOverride: ((prompt: string) => object | 'junk') | null = null
/** Extra milliseconds a call takes, by its prompt (real time). */
let delayFor: ((prompt: string, feature: string) => number) | null = null
/** Runs inside a call, before it answers (to move a faked clock, or to fail it). */
let onCall: ((feature: string, prompt: string) => void) | null = null

const UNITY_TEXT = 'Cut platform release time'
const BLIZZARD_TEXT = 'Launched a live-service title for 2M'
/** The real ids are not in the prompt any more (labels E1.. are): a prompt is identified by its evidence text. */
const isUnity = (prompt: string) => prompt.includes(UNITY_TEXT)
const isBlizzard = (prompt: string) => prompt.includes(BLIZZARD_TEXT)
/** A writer's answer with its bullets cited: a plain string bullet cites E1 (and P1; unknown labels are dropped). */
const withSources = (reply: unknown) => {
  const r = reply as { bullets?: unknown[] } | string
  return typeof r === 'object' && r && Array.isArray(r.bullets)
    ? { ...r, bullets: r.bullets.map((b) => (typeof b === 'string' ? { text: b, sources: ['E1', 'P1'] } : b)) }
    : reply
}

const unityAnswer = {
  summary: 'Ran release and planning for the platform org.',
  bullets: ['Cut platform release time by 40% across 8 teams, saving 2 weeks per release.', 'Ran the quarterly planning cycle for the platform org.', 'Shipped 12 titles on schedule.'],
}
const blizzardAnswer = { summary: 'Launched a live-service title.', bullets: ['Launched a live-service title for 2M players.'] }
const genericAnswer = { summary: 'Did the work.', bullets: ['Did the work well.'] }
const skillsAnswer = {
  skills: [{ label: 'Delivery', names: ['Release management', 'Roadmapping', 'Dependency mapping'] }, { label: 'Governance', names: ['Stakeholder management', 'Risk management', 'Budgeting'] }],
  tools: [{ label: '', names: ['Jira', 'Tableau'] }],
}
const profileAnswer = {
  profile: 'Delivery leader who turns multi-team programmes into predictable releases.',
  headline: 'Delivery and operations leader',
  competencies: ['Cross-functional leadership'],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  seen = []
  active = 0
  peak = 0
  experienceOverride = null
  delayFor = null
  onCall = null
  vi.mocked(loadWritingContext).mockResolvedValue({ rules: 'USER WRITING RULES', brief: 'USER WRITING BRIEF', searchProfileSummary: null })
  vi.mocked(loadCVWriteExperiencePrompt).mockResolvedValue('EXPERIENCE PROMPT')
  vi.mocked(loadCVWriteSkillsPrompt).mockResolvedValue('SKILLS PROMPT')
  vi.mocked(loadCVWriteProfilePrompt).mockResolvedValue('PROFILE PROMPT')
  mockJSON.mockImplementation((async (_p: string, prompt: string, schema: never, opts: { feature: string; system: string; deadline: number }) => {
    seen.push({ feature: opts.feature, prompt, system: opts.system, at: Date.now(), deadline: opts.deadline })
    onCall?.(opts.feature, prompt)
    active++
    peak = Math.max(peak, active)
    await new Promise((r) => setTimeout(r, 15 + (delayFor?.(prompt, opts.feature) ?? 0)))
    active--
    let reply: object | 'junk'
    if (opts.feature === 'cv-gen-write-skills') reply = skillsAnswer
    else if (opts.feature === 'cv-gen-write-profile') reply = profileAnswer
    else if (experienceOverride) reply = experienceOverride(prompt)
    else reply = isUnity(prompt) ? unityAnswer : isBlizzard(prompt) ? blizzardAnswer : genericAnswer
    const text = reply === 'junk' ? 'no json' : `\`\`\`json\n${JSON.stringify(withSources(reply))}\n\`\`\``
    return llmReply(extractJSON(text, schema))
  }) as never)
})

describe('runWrite', () => {
  it('writes employers and skills in wave 1, then the profile, and renders the rest by code', async () => {
    const vault = writeVault()
    const r = await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx())

    expect(seen.filter((s) => s.feature === 'cv-gen-write-experience')).toHaveLength(2) // Unity and Blizzard; Old Co is header-only: no call
    expect(seen.filter((s) => s.feature === 'cv-gen-write-skills')).toHaveLength(1)
    expect(seen.filter((s) => s.feature === 'cv-gen-write-profile')).toHaveLength(1)
    expect(seen).toHaveLength(4)

    // Wave 2 starts after every wave-1 call and sees its text.
    const profile = seen.find((s) => s.feature === 'cv-gen-write-profile')!
    expect(profile.at).toBeGreaterThanOrEqual(Math.max(...seen.filter((s) => s.feature !== 'cv-gen-write-profile').map((s) => s.at)))
    expect(profile.prompt).toContain('Cut platform release time by 40% across 8 teams, saving 2 weeks per release.')
    expect(profile.prompt).toContain('Launched a live-service title for 2M players.')

    expect(r.sections.map((s) => s.id).sort()).toEqual([
      `experience:${BLIZZARD}`, 'earlier-experience', `experience:${UNITY}`,
      'certification', 'competencies', 'education', 'languages', 'profile', 'skills', 'tools',
    ].sort())
    expect(r.headline).toBe('Delivery and operations leader')
    expect(r.models).toEqual(['claude-sonnet-5-5'])
    expect(r.usage.calls).toBe(4)
    expect(r.usage.input).toBe(4000)
    expect(r.notes.join(' ')).not.toMatch(/project/) // no projects selected
  })

  it('renders the header-only employers entirely by code as ONE Earlier experience row: no model call, one line each, titles and dates untouched, no "promoted"', async () => {
    const vault = writeVault()
    const r = await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx())
    const old = r.sections.find((s) => s.id === 'earlier-experience')!
    expect(old.kind).toBe('earlier-experience')
    expect(old.markdown).toBe(':::compact-list\n- Old Co — Coordinator, 2010–2014\n:::')
    expect(r.sections.some((s) => s.id === `experience:${OLD_CO}`)).toBe(false)
    expect(old.model).toBeUndefined()
    expect(old.log).toMatchObject({ label: 'Earlier experience', model: null, tokens: { input: 0, output: 0 } })
    expect(old.log.notes[0]).toMatch(/1 employer listed without bullets.*rendered by code.*no model call/)
    const unity = r.sections.find((s) => s.id === `experience:${UNITY}`)!
    expect(unity.markdown).toContain('**Snr. Program Manager** · Jan 2019 – present')
    expect(unity.markdown).toContain('_Two roles at Unity (2019–present): Program Manager → Snr. Program Manager_')
    expect(r.sections.map((s) => s.markdown).join('\n')).not.toMatch(/promot/i)
  })

  it('carries each employer’s per-bullet provenance on its section (real ids and snippets), and a mixed-source note on its log row', async () => {
    experienceOverride = (prompt) => (isUnity(prompt)
      ? { summary: 'Ran the platform org.', bullets: [{ text: 'Cut platform release time by 40% and shipped 12 titles on schedule.', sources: ['E1', 'E3'] }, { text: 'Ran the quarterly planning cycle for the platform org.', sources: ['E2'] }] }
      : blizzardAnswer)
    const vault = writeVault()
    const r = await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx())
    const unity = r.sections.find((x) => x.id === `experience:${UNITY}`)!
    expect(unity.bullets?.map((b) => b.sources.map((x) => x.id))).toEqual([['ua1', 'ua3'], ['ua2']])
    expect(unity.log.notes.join(' ')).toMatch(/Bullet combines figures from 2 activities: Cut platform release time by 40% across 8 teams \/ Shipped 12 titles on schedule/)
    expect(r.checkNotes).toEqual([]) // the mixed-source note never counts toward the "worth a quick check" notes
    const blizzard = r.sections.find((x) => x.id === `experience:${BLIZZARD}`)!
    expect(blizzard.bullets?.[0].sources[0].id).toBe('ba1')
    expect(r.sections.find((x) => x.id === 'earlier-experience')!.bullets).toBeUndefined()
  })

  it('renders certifications and education from the profile in relevance order, in-progress ones as (in progress)', async () => {
    const vault = writeVault()
    const r = await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx())
    expect(r.sections.find((s) => s.id === 'certification')!.markdown).toBe('- **PMP** — PMI (2018)\n- **SAFe Program Consultant** — Scaled Agile (2099, in progress)')
    const edu = r.sections.find((s) => s.id === 'education')!
    expect(edu.markdown).toContain('- **MSc in Supply chain** — Example University (2012 – 2014)')
    expect(edu.markdown).toContain('- **MBA** — Open College (from 2025, in progress)')
    expect(edu.log.notes.join(' ')).toMatch(/no end date/)
  })

  it('starts the cheap skills call first', async () => {
    const vault = writeVault()
    await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx())
    expect(seen[0].feature).toBe('cv-gen-write-skills')
  })

  it('gives wave 1 its own deadline, the wave-2 reserve before the write stage deadline', async () => {
    const vault = writeVault()
    const run = ctx({ deadline: Date.now() + 250_000 })
    await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, run)
    const wave1 = seen.filter((s) => s.feature !== 'cv-gen-write-profile')
    const wave2 = seen.find((s) => s.feature === 'cv-gen-write-profile')!
    expect(wave2.deadline).toBe(run.deadline - ASSEMBLE_RESERVE_MS)
    for (const c of wave1) expect(c.deadline).toBe(wave2.deadline - WAVE2_RESERVE_MS)
  })

  describe('when time runs short (never lose the wave-1 work)', () => {
    afterEach(() => vi.useRealTimers())

    /** Every wave-1 call "takes" `ms` on a faked clock. */
    const slowWave1 = (ms: number) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      onCall = (feature) => { if (feature !== 'cv-gen-write-profile') vi.setSystemTime(Date.now() + ms) }
    }

    it('renders a deterministic profile and competencies, with a log note, instead of starting wave 2 with only seconds left', async () => {
      slowWave1(20_000)
      const vault = writeVault()
      // 30 s for the stage: wave 1 uses 20 s, leaving 10 s, under the minimum to start the profile call.
      const r = await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx({ deadline: Date.now() + 30_000 + ASSEMBLE_RESERVE_MS }))
      expect(seen.some((s) => s.feature === 'cv-gen-write-profile')).toBe(false)
      const profile = r.sections.find((s) => s.id === 'profile')!
      expect(profile.markdown).toBe(buildBriefFor().positioning)
      expect(profile.log.notes.join(' ')).toMatch(/not enough time left for the profile call.*made by code from the brief and the selection/)
      expect(r.sections.find((s) => s.id === 'competencies')!.markdown).toBe(':::skills\n- Cross-functional leadership\n:::')
      expect(r.headline).toBeNull()
      // The wave-1 work is all there.
      expect(r.sections.find((s) => s.id === `experience:${UNITY}`)!.markdown).toContain('Cut platform release time by 40%')
      expect(r.sections.find((s) => s.id === 'skills')).toBeDefined()
    })

    it('falls back, rather than fails the run as a timeout, when the profile call itself times out', async () => {
      mockJSON.mockImplementation((async (_p: string, prompt: string, schema: never, opts: { feature: string }) => {
        seen.push({ feature: opts.feature, prompt, system: '', at: Date.now(), deadline: 0 })
        if (opts.feature === 'cv-gen-write-profile') throw Object.assign(new LLMError('slow', 'timeout'), { usage: { input: 0, output: 0, costUsd: 0, calls: 0 } })
        const reply = opts.feature === 'cv-gen-write-skills' ? skillsAnswer : isUnity(prompt) ? unityAnswer : isBlizzard(prompt) ? blizzardAnswer : genericAnswer
        return llmReply(extractJSON(`\`\`\`json\n${JSON.stringify(withSources(reply))}\n\`\`\``, schema))
      }) as never)
      const vault = writeVault()
      const r = await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx())
      expect(r.sections.find((s) => s.id === 'profile')!.log.notes.join(' ')).toMatch(/ran out of time.*made by code/)
      expect(r.headline).toBeNull()
    })

    it('lists an employer with its own activity text, and keeps going, when its call times out', async () => {
      mockJSON.mockImplementation((async (_p: string, prompt: string, schema: never, opts: { feature: string }) => {
        seen.push({ feature: opts.feature, prompt, system: '', at: Date.now(), deadline: 0 })
        if (opts.feature === 'cv-gen-write-experience' && isBlizzard(prompt)) throw new LLMError('slow', 'timeout')
        const reply = opts.feature === 'cv-gen-write-skills' ? skillsAnswer : opts.feature === 'cv-gen-write-profile' ? profileAnswer : unityAnswer
        return llmReply(extractJSON(`\`\`\`json\n${JSON.stringify(withSources(reply))}\n\`\`\``, schema))
      }) as never)
      const vault = writeVault()
      const r = await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx())
      const blizzard = r.sections.find((s) => s.id === `experience:${BLIZZARD}`)!
      expect(blizzard.markdown).toContain('- Launched a live-service title for 2M players')
      expect(blizzard.log.notes.join(' ')).toMatch(/ran out of time for this entry/)
      expect(r.sections.find((s) => s.id === `experience:${UNITY}`)!.markdown).toContain('Cut platform release time by 40%')
      expect(r.sections.find((s) => s.id === 'profile')).toBeDefined()
    })

    it('lists an employer with its own activity text, after ONE call, when its answer is cut off at the largest budget (Phase 3c)', async () => {
      const bootCamp = projectRow('pb', 'Boot Camp', 'Ran the studio boot camp for new hires.', { startDate: new Date('2016-06-01T00:00:00Z') })
      mockJSON.mockImplementation((async (_p: string, prompt: string, schema: never, opts: { feature: string }) => {
        seen.push({ feature: opts.feature, prompt, system: '', at: Date.now(), deadline: 0 })
        if (opts.feature === 'cv-gen-write-experience' && isBlizzard(prompt)) return llmReply({ ok: false, reason: 'parse', error: null }, { finishReason: 'length' })
        const reply = opts.feature === 'cv-gen-write-skills' ? skillsAnswer : opts.feature === 'cv-gen-write-profile' ? profileAnswer : unityAnswer
        return llmReply(extractJSON(`\`\`\`json\n${JSON.stringify(withSources(reply))}\n\`\`\``, schema))
      }) as never)
      const vault = writeVault([bootCamp])
      const sel = writeSelection(vault, { projects: [{ id: 'pb', reason: '' }] })
      const r = await runWrite(vault, buildBriefFor(), sel, strategy, ctx())
      expect(seen.filter((x) => x.feature === 'cv-gen-write-experience' && isBlizzard(x.prompt))).toHaveLength(1) // the retry was not spent on the same budget
      const blizzard = r.sections.find((s) => s.id === `experience:${BLIZZARD}`)!
      expect(blizzard.markdown).toContain('- Launched a live-service title for 2M players')
      expect(blizzard.log.notes.join(' ')).toMatch(/cut off at the largest output budget/)
      expect(blizzard.log.notes.join(' ')).toMatch(/Project "Boot Camp" is not on the CV/) // never silent
      expect(r.sections.find((s) => s.id === `experience:${UNITY}`)).toBeDefined()
      expect(r.sections.find((s) => s.id === 'profile')).toBeDefined()
    })

    it('still fails other errors (an invalid wave-2 answer is not a time problem)', async () => {
      mockJSON.mockImplementation((async (_p: string, prompt: string, schema: never, opts: { feature: string }) => {
        const reply = opts.feature === 'cv-gen-write-skills' ? skillsAnswer : opts.feature === 'cv-gen-write-profile' ? 'junk' : isBlizzard(prompt) ? blizzardAnswer : unityAnswer
        const text = reply === 'junk' ? 'no json' : `\`\`\`json\n${JSON.stringify(withSources(reply))}\n\`\`\``
        return llmReply(extractJSON(text, schema))
      }) as never)
      const vault = writeVault()
      const err = await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx()).catch((e) => e)
      expect(err).toBeInstanceOf(WriteStageError)
      expect(err.original).toMatchObject({ kind: 'invalid_output' })
      expect(err.sectionLogs.find((r: { id: string }) => r.id === 'profile')).toMatchObject({ status: 'failed', tokens: { input: 2000, output: 400 } })
    })
  })

  it('applies the user’s writing rules and brief to EVERY writer', async () => {
    const vault = writeVault()
    await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx())
    expect(seen.length).toBeGreaterThan(0)
    for (const s of seen) {
      expect(s.system).toContain('USER WRITING RULES')
      expect(s.system).toContain('USER WRITING BRIEF')
    }
    expect(seen.find((s) => s.feature === 'cv-gen-write-experience')!.system).toContain('EXPERIENCE PROMPT')
    expect(seen.find((s) => s.feature === 'cv-gen-write-skills')!.system).toContain('SKILLS PROMPT')
    expect(seen.find((s) => s.feature === 'cv-gen-write-profile')!.system).toContain('PROFILE PROMPT')
    expect(loadWritingContext).toHaveBeenCalledWith('p1')
  })

  it('sends no contact detail, name or employer to any prompt', async () => {
    const vault = writeVault()
    await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx())
    const all = seen.map((s) => `${s.system}\n${s.prompt}`).join('\n')
    for (const secret of ['robin@example.test', '+33 6 12 34 56 78', 'Robin Placeholder', 'linkedin.com/in/robin', 'github.com/robin', 'Unity', 'Blizzard', 'Old Co', 'Snr. Program Manager']) {
      expect(all).not.toContain(secret)
    }
  })

  /** Four employers with bullets plus the skills grouping: five wave-1 tasks. */
  function fourEmployers() {
    const src = writeVaultSource()
    const base = src.experiences[0]
    for (const [i, name] of ['Alpha', 'Beta'].entries()) {
      ;(src.experiences as unknown[]).push({
        ...base, id: `e-x${i}`, company: `${name} Labs`, role: 'Analyst', startDate: new Date(`200${i}-01-01T00:00:00Z`), endDate: new Date(`200${i}-12-01T00:00:00Z`),
        skills: [], activities: [{ ...base.activities[0], id: `xa${i}`, experienceId: `e-x${i}`, description: `Did ${name} work`, impact: null, order: 0, skills: [] }],
      })
    }
    const vault = buildVault(src)
    const out = {
      employers: [UNITY, BLIZZARD, 'alpha-labs', 'beta-labs'].map((id) => ({ id, relevance: 4 as number | undefined, reason: '' })),
      activities: ['ua1', 'ba1', 'xa0', 'xa1'].map((id) => ({ id, reason: '' })),
      skills: ['sk1', 'sk2', 'sk3', 'sk4', 'sk5'].map((id) => ({ id, reason: '' })), tools: [], competencies: [], certifications: [], education: [], projects: [], emphasise: [],
    }
    const sel = enforceSelection(out, buildCandidates(vault), buildBriefFor({ budgets: { experiences: 4, skills: 12, tools: 10, competencies: 6, certifications: 4, education: 3, projects: 2 } })).selection
    expect(sel.employers.filter((e) => !e.headerOnly)).toHaveLength(4)
    return { vault, sel }
  }

  it('never runs more than WRITE_CONCURRENCY calls at once', async () => {
    experienceOverride = () => genericAnswer
    const { vault, sel } = fourEmployers()
    await runWrite(vault, buildBriefFor(), sel, strategy, ctx())
    expect(WRITE_CONCURRENCY).toBe(3)
    expect(peak).toBe(3)
    expect(seen.filter((s) => s.feature !== 'cv-gen-write-profile')).toHaveLength(5)
  })

  it('collects at most three "worth a quick check" notes, however many employers have one', async () => {
    // Every employer's bullet has a figure that is not in its evidence, and stays wrong after the retry: four candidate notes.
    experienceOverride = () => ({ summary: 'Did the work.', bullets: ['Grew revenue 91%.'] })
    const { vault, sel } = fourEmployers()
    const r = await runWrite(vault, buildBriefFor(), sel, strategy, ctx())
    expect(r.checkNotes).toHaveLength(3)
  })

  it('fails the run (WriteStageError → invalid_output) when an experience writer cannot produce valid output, keeping the section rows so far', async () => {
    experienceOverride = (prompt) => (isBlizzard(prompt) ? 'junk' : unityAnswer)
    const vault = writeVault()
    const err = await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx()).catch((e) => e)
    expect(err).toBeInstanceOf(WriteStageError)
    expect(err.original).toMatchObject({ kind: 'invalid_output' })
    const rows = (err as WriteStageError).sectionLogs
    expect(rows.find((r) => r.id === `experience:${BLIZZARD}`)).toMatchObject({ status: 'failed' })
    expect(rows.find((r) => r.id === 'earlier-experience')).toMatchObject({ status: 'ok' })
    // The profile writer never started.
    expect(seen.some((s) => s.feature === 'cv-gen-write-profile')).toBe(false)
    // Each writer made at most two calls: Blizzard's junk was retried once.
    expect(seen.filter((s) => isBlizzard(s.prompt))).toHaveLength(2)
  })

  it('orders the "worth a quick check" notes by priority (figures, claimed tools, education dates) and employer, not by completion order', async () => {
    const src = writeVaultSource()
    ;(src.educations as Array<{ id: string; startDate: Date }>).find((e) => e.id === 'we2')!.startDate = new Date('2005-09-01T00:00:00Z') // no end date, long ago
    const vault = buildVault(src)
    // Unity names a claimed tool the job asks for; Blizzard has a figure nothing supports. Unity answers LAST.
    experienceOverride = (prompt) => (isUnity(prompt)
      ? { summary: 'Ran releases.', bullets: ['Built Tableau dashboards for 8 teams.'] }
      : { summary: 'Launched a title.', bullets: ['Launched a live-service title for 3M players.'] })
    delayFor = (prompt, feature) => (feature === 'cv-gen-write-experience' && isUnity(prompt) ? 60 : 0)
    const r = await runWrite(vault, buildBriefFor(), writeSelection(vault), { mustHave: ['Tableau'], niceToHave: [] }, ctx())
    expect(r.checkNotes).toHaveLength(3)
    expect(r.checkNotes[0]).toMatch(/^Blizzard Entertainment: "3M" could not be matched/)
    expect(r.checkNotes[1]).toMatch(/^Unity: "Tableau" is listed in your profile without evidence/)
    expect(r.checkNotes[2]).toMatch(/^Education: "MBA" has no end date/)
  })

  it('cuts the education date note first when there are more than three, then everything else by priority', async () => {
    const src = writeVaultSource()
    ;(src.educations as Array<{ id: string; startDate: Date }>).find((e) => e.id === 'we2')!.startDate = new Date('2005-09-01T00:00:00Z')
    const vault = buildVault(src)
    experienceOverride = (prompt) => ({ summary: 'Did the work.', bullets: [isUnity(prompt) ? 'Built Tableau dashboards, grew revenue 91%.' : 'Grew revenue 91%.'] })
    const r = await runWrite(vault, buildBriefFor(), writeSelection(vault), { mustHave: ['Tableau'], niceToHave: [] }, ctx())
    expect(r.checkNotes).toHaveLength(3)
    expect(r.checkNotes.every((n) => !n.startsWith('Education:'))).toBe(true)
  })

  it('cleans markup out of an experience answer so Assemble never sees a stray ":::" (the run does not fail)', async () => {
    experienceOverride = () => ({ summary: ':::compact-list Did the work.', bullets: ['Did the work ::: well.', '{{contact}}'] })
    const vault = writeVault()
    const r = await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx())
    const md = r.sections.filter((s) => s.kind === 'experience').map((s) => s.markdown).join('\n')
    expect(md).not.toMatch(/:::[^c\n]|[^\n]:::/)
    expect(md).not.toContain('{{')
  })

  it('records the tokens of a failed run: the calls that answered, on the error and on the failed row', async () => {
    experienceOverride = (prompt) => (isBlizzard(prompt) ? 'junk' : unityAnswer)
    const vault = writeVault()
    const err = await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx()).catch((e) => e)
    expect(err).toBeInstanceOf(WriteStageError)
    expect(err.usage.calls).toBeGreaterThanOrEqual(2)
    expect(err.usage.input).toBeGreaterThanOrEqual(2000)
    const failed = err.sectionLogs.find((r: { id: string }) => r.id === `experience:${BLIZZARD}`)
    expect(failed).toMatchObject({ status: 'failed', tokens: { input: 2000, output: 400 } })
    expect(failed.costUsd).toBeGreaterThan(0)
  })

  it('counts the tokens of a failed skills grouping in the stage total and on its rows', async () => {
    const skillsRows = new Set(['cv-gen-write-skills'])
    mockJSON.mockImplementation((async (_p: string, prompt: string, schema: never, opts: { feature: string }) => {
      const reply = skillsRows.has(opts.feature) ? 'junk' : opts.feature === 'cv-gen-write-profile' ? profileAnswer : isBlizzard(prompt) ? blizzardAnswer : unityAnswer
      const text = reply === 'junk' ? 'no json' : `\`\`\`json\n${JSON.stringify(withSources(reply))}\n\`\`\``
      return llmReply(extractJSON(text, schema))
    }) as never)
    const vault = writeVault()
    const r = await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx())
    const tools = r.sections.find((s) => s.id === 'tools')!
    expect(tools.log.tokens).toEqual({ input: 2000, output: 400 })
    expect(r.usage.input).toBe(2000 + 3000) // two junk skills calls, then experience x2 and the profile
  })

  it('leaves a certification with an expired date off the CV and says so in its log note', async () => {
    const src = writeVaultSource()
    ;(src.certifications as unknown[]).push({ id: 'wc3', profileId: 'p1', name: 'ITIL 3', issuer: 'Axelos', issueDate: new Date('2018-01-01T00:00:00Z'), expiryDate: new Date('2021-01-01T00:00:00Z'), credentialUrl: null, tags: '[]', createdAt: new Date(0), updatedAt: new Date(0), skills: [] })
    const vault = buildVault(src)
    const sel = writeSelection(vault, { certifications: ['wc1', 'wc2', 'wc3'].map((id) => ({ id, reason: '' })) })
    const r = await runWrite(vault, buildBriefFor(), sel, strategy, ctx())
    const cert = r.sections.find((s) => s.id === 'certification')!
    expect(cert.markdown).not.toContain('ITIL')
    expect(cert.log.notes.join(' ')).toContain('"ITIL 3" expired in 2021 and was left out.')
  })

  it('fails as a timeout when the run has no time left, before any call', async () => {
    const vault = writeVault()
    const err = await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx({ deadline: Date.now() + 1_000 })).catch((e) => e)
    expect(err).toBeInstanceOf(WriteStageError)
    expect(err.original).toMatchObject({ kind: 'timeout' })
    expect(seen).toHaveLength(0)
  })

  it('reads only the given profile’s vault: another profile’s selection resolves to nothing and is rendered by code', async () => {
    const other = buildVault(vaultSource()) // a different profile's data: none of the selected ids exist in it
    const r = await runWrite(other, buildBriefFor(), writeSelection(writeVault()), strategy, ctx())
    expect(seen.filter((s) => s.feature === 'cv-gen-write-experience')).toHaveLength(0)
    // Nothing of the selection resolved, so every employer is listed (without bullets) in the one Earlier experience row, with a note each.
    const earlier = r.sections.find((s) => s.id === 'earlier-experience')!
    expect(earlier.markdown).toContain('- Unity — Snr. Program Manager, 2019–present')
    expect(earlier.markdown).toContain('- Blizzard Entertainment — Program Manager, 2015–2018')
    expect(earlier.log.notes.join(' ')).toMatch(/Unity: none of its selected activities is still in the profile/)
    expect(r.sections.some((s) => s.kind === 'experience')).toBe(false)
    expect(r.sections.find((s) => s.id === 'certification')).toBeUndefined()
    expect(r.sections.find((s) => s.id === 'tools')).toBeUndefined()
  })

  describe('Phase 3b: projects, silent drops, retry reasons', () => {
    const d = (ym: string) => new Date(`${ym}-01T00:00:00Z`)
    const demo = projectRow('pa', 'Enemies Demo Campaign', 'Ran the demo campaign for the new title, reaching 14,000+ players at launch.', { experienceId: 'e-u2' })
    const bootCamp = projectRow('pb', 'Boot Camp', 'Ran the studio boot camp for new hires.', { startDate: d('2016-06') })
    const sideProject = projectRow('pc', 'Side project', 'Built on weekends.')
    const oldCoProject = projectRow('pd', 'Old Co project', 'Built at Old Co.', { experienceId: 'e-o1' })
    const pick = (...ids: string[]) => ids.map((id) => ({ id, reason: '' }))
    const unityWithProject = { summary: 'Ran release and planning for the platform org.', bullets: [unityAnswer.bullets[0], 'Ran the Enemies Demo Campaign, reaching 14,000+ players at launch.', unityAnswer.bullets[2]] }
    const bootCampAnswer = { summary: 'Launched a live-service title.', bullets: ['Launched a live-service title for 2M players, and ran the Boot Camp for new hires.'] }
    const allNotes = (r: Awaited<ReturnType<typeof runWrite>>) => [...r.notes, ...r.sections.flatMap((s) => s.log.notes)].join('\n')

    it('gives each selected project to the writer of the employer it belongs to, and it reaches the CV', async () => {
      experienceOverride = (prompt) => (isUnity(prompt) ? unityWithProject : bootCampAnswer)
      const vault = writeVault([demo, bootCamp])
      const r = await runWrite(vault, buildBriefFor(), writeSelection(vault, { projects: pick('pa', 'pb') }), strategy, ctx())
      const prompts = seen.filter((x) => x.feature === 'cv-gen-write-experience')
      const unityPrompt = prompts.find((x) => isUnity(x.prompt))!.prompt
      const blizzardPrompt = prompts.find((x) => isBlizzard(x.prompt))!.prompt
      expect(unityPrompt).toContain('[P1] project "Enemies Demo Campaign"')
      expect(unityPrompt).not.toContain('Boot Camp')
      expect(blizzardPrompt).toContain('[P1] project "Boot Camp"') // no role: placed by its date (2016-06 is in Blizzard's stint)
      expect(r.sections.find((x) => x.id === `experience:${UNITY}`)!.markdown).toContain('Enemies Demo Campaign')
      expect(r.sections.find((x) => x.id === `experience:${BLIZZARD}`)!.markdown).toContain('Boot Camp')
      expect(r.notes.join(' ')).not.toMatch(/not on the CV/)
    })

    it('never says again that the default structure has no projects section', async () => {
      const vault = writeVault([demo])
      const r = await runWrite(vault, buildBriefFor(), writeSelection(vault, { projects: pick('pa') }), strategy, ctx())
      expect(allNotes(r)).not.toMatch(/no projects section/)
    })

    it('names a project no employer can carry, and why', async () => {
      const vault = writeVault([sideProject, oldCoProject])
      const r = await runWrite(vault, buildBriefFor(), writeSelection(vault, { projects: pick('pc', 'pd') }), strategy, ctx())
      expect(r.notes).toEqual(expect.arrayContaining([
        'Selected project "Side project" is not on the CV: it has no role and no date, so there is no employer to attach it to.',
        'Selected project "Old Co project" is not on the CV: the role it belongs to is listed without bullets, so there is no entry to put it in.',
      ]))
    })

    it('records why an entry retried on its section row', async () => {
      let n = 0
      experienceOverride = (prompt) => {
        if (!isUnity(prompt)) return blizzardAnswer
        return n++ === 0 ? { ...unityAnswer, bullets: ['Led my team to cut release time by 40%.', ...unityAnswer.bullets.slice(1)] } : unityAnswer
      }
      const vault = writeVault()
      const r = await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx())
      const row = r.sections.find((x) => x.id === `experience:${UNITY}`)!.log
      expect(row.retries).toBe(1)
      expect(row.retryReasons).toEqual(['first person'])
      expect(r.sections.find((x) => x.id === `experience:${BLIZZARD}`)!.log.retryReasons).toEqual([])
    })

    it('skips a weak certification (no issuer, no date) that Select did not rank first, and says so', async () => {
      const src = writeVaultSource()
      ;(src.certifications as unknown[]).push({ id: 'wcw', profileId: 'p1', name: 'React Front-End Course', issuer: null, issueDate: null, expiryDate: null, credentialUrl: null, tags: '[]', createdAt: new Date(0), updatedAt: new Date(0), skills: [] })
      const vault = buildVault(src)
      const r = await runWrite(vault, buildBriefFor(), writeSelection(vault, { certifications: pick('wc1', 'wcw') }), strategy, ctx())
      const cert = r.sections.find((x) => x.id === 'certification')!
      expect(cert.markdown).toBe('- **PMP** — PMI (2018)')
      expect(cert.log.notes.join(' ')).toContain('"React Front-End Course" has no issuer and no date, and Select did not rank it first, so it was left out.')
    })

    it('leaves no selected item silently dropped: each is on the CV or named in a log note', async () => {
      const src = writeVaultSource({ projects: [demo, sideProject] })
      ;(src.certifications as unknown[]).push(
        { id: 'wcx', profileId: 'p1', name: 'ITIL 3', issuer: 'Axelos', issueDate: d('2018-01'), expiryDate: d('2021-01'), credentialUrl: null, tags: '[]', createdAt: new Date(0), updatedAt: new Date(0), skills: [] },
        { id: 'wcw', profileId: 'p1', name: 'React Front-End Course', issuer: null, issueDate: null, expiryDate: null, credentialUrl: null, tags: '[]', createdAt: new Date(0), updatedAt: new Date(0), skills: [] },
      )
      const vault = buildVault(src)
      experienceOverride = (prompt) => (isUnity(prompt) ? unityWithProject : blizzardAnswer)
      const sel = writeSelection(vault, { projects: pick('pa', 'pc'), certifications: pick('wc1', 'wcx', 'wcw', 'wc2') })
      const r = await runWrite(vault, buildBriefFor(), sel, strategy, ctx())
      const onCv = r.sections.map((x) => x.markdown).join('\n')
      const notes = allNotes(r)
      // Each selected item is matched by its FULL name (education by its qualification and institution), never by a first word.
      const nameOf = (id: string): string[] => {
        const n = vault.notes.get(id)!
        return n.type === 'education' ? [n.props.qualification, n.props.institution] : [n.title]
      }
      const selected = [
        ...sel.projects, ...sel.certifications, ...sel.competencies, ...sel.tools, ...sel.skills, ...sel.education,
      ].map((i) => ({ id: i.id, names: nameOf(i.id) }))
      expect(selected.length).toBeGreaterThan(10)
      const missing = selected.filter((i) => !i.names.every((n) => onCv.includes(n) || notes.includes(n)))
      expect(missing).toEqual([])
      // The ones the CV leaves out are each named.
      for (const name of ['Side project', 'ITIL 3', 'React Front-End Course', 'Change management']) {
        expect(onCv).not.toContain(name)
        expect(notes).toContain(name)
      }
    })

    it('keeps an in-progress certification that has no issuer and no date, even when it is not Select\'s first pick', async () => {
      const src = writeVaultSource()
      ;(src.certifications as unknown[]).push({ id: 'wcp', profileId: 'p1', name: 'PMP (in progress)', issuer: null, issueDate: null, expiryDate: null, credentialUrl: null, tags: '[]', createdAt: new Date(0), updatedAt: new Date(0), skills: [] })
      const vault = buildVault(src)
      const r = await runWrite(vault, buildBriefFor(), writeSelection(vault, { certifications: pick('wc1', 'wcp') }), strategy, ctx())
      const cert = r.sections.find((x) => x.id === 'certification')!
      expect(cert.markdown).toBe('- **PMP** — PMI (2018)\n- **PMP (in progress)**')
      expect(cert.log.notes.join(' ')).not.toContain('left out')
    })

    it('names a selected item that was removed from the profile since the run', async () => {
      const vault = writeVault([demo])
      const sel = writeSelection(vault, { projects: pick('pa') })
      const r = await runWrite(writeVault(), buildBriefFor(), sel, strategy, ctx()) // the project is gone from this vault
      expect(r.notes.join('\n')).toMatch(/^A selected project item is no longer in your profile, so it is not on the CV\.$/m)
    })
  })
})
