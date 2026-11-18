import { beforeEach, describe, expect, it, vi } from 'vitest'

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
import { BLIZZARD, OLD_CO, UNITY, llmReply, writeSelection, writeVault, writeVaultSource } from '../__fixtures__/write'
import { WRITE_CONCURRENCY } from '../schema'
import { enforceSelection } from '../select'
import { runWrite, WriteStageError } from './run-write'

const mockJSON = vi.mocked(completeJSON)
const strategy = { mustHave: ['Delivery'], niceToHave: [] as string[] }
const ctx = (over: Partial<{ deadline: number }> = {}) => ({ profileId: 'p1', jobApplicationId: 'job-1', runId: 'run-1', deadline: Date.now() + 250_000, ...over })

type Seen = { feature: string; prompt: string; system: string; at: number }
let seen: Seen[] = []
let active = 0
let peak = 0
let experienceOverride: ((prompt: string) => object | 'junk') | null = null

const unityAnswer = {
  summary: 'Ran release and planning for the platform org.',
  block: ':::compact-list\n- Cut platform release time by 40% across 8 teams, saving 2 weeks per release.\n- Ran the quarterly planning cycle for the platform org.\n- Shipped 12 titles on schedule.\n:::',
}
const blizzardAnswer = { summary: 'Launched a live-service title.', block: ':::compact-list\n- Launched a live-service title for 2M players.\n:::' }
const genericAnswer = { summary: 'Did the work.', block: ':::compact-list\n- Did the work well.\n:::' }
const skillsAnswer = {
  skills: [{ label: 'Delivery', names: ['Release management', 'Roadmapping', 'Dependency mapping'] }, { label: 'Governance', names: ['Stakeholder management', 'Risk management', 'Budgeting'] }],
  tools: [{ label: '', names: ['Jira', 'Tableau'] }],
}
const profileAnswer = {
  profile: 'Delivery leader who turns multi-team programmes into predictable releases.',
  headline: 'Delivery and operations leader',
  competencies: [{ name: 'Cross-functional leadership', line: 'Cross-functional leadership: shipped 12 titles on schedule' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  seen = []
  active = 0
  peak = 0
  experienceOverride = null
  vi.mocked(loadWritingContext).mockResolvedValue({ rules: 'USER WRITING RULES', brief: 'USER WRITING BRIEF', searchProfileSummary: null })
  vi.mocked(loadCVWriteExperiencePrompt).mockResolvedValue('EXPERIENCE PROMPT')
  vi.mocked(loadCVWriteSkillsPrompt).mockResolvedValue('SKILLS PROMPT')
  vi.mocked(loadCVWriteProfilePrompt).mockResolvedValue('PROFILE PROMPT')
  mockJSON.mockImplementation((async (_p: string, prompt: string, schema: never, opts: { feature: string; system: string }) => {
    seen.push({ feature: opts.feature, prompt, system: opts.system, at: Date.now() })
    active++
    peak = Math.max(peak, active)
    await new Promise((r) => setTimeout(r, 15))
    active--
    let reply: object | 'junk'
    if (opts.feature === 'cv-gen-write-skills') reply = skillsAnswer
    else if (opts.feature === 'cv-gen-write-profile') reply = profileAnswer
    else if (experienceOverride) reply = experienceOverride(prompt)
    else reply = prompt.includes('[ua1]') ? unityAnswer : prompt.includes('[ba1]') ? blizzardAnswer : genericAnswer
    const text = reply === 'junk' ? 'no json' : `\`\`\`json\n${JSON.stringify(reply)}\n\`\`\``
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
      `experience:${BLIZZARD}`, `experience:${OLD_CO}`, `experience:${UNITY}`,
      'certification', 'competencies', 'education', 'languages', 'profile', 'skills', 'tools',
    ].sort())
    expect(r.headline).toBe('Delivery and operations leader')
    expect(r.models).toEqual(['claude-sonnet-5-5'])
    expect(r.usage.calls).toBe(4)
    expect(r.usage.input).toBe(4000)
    expect(r.notes.join(' ')).not.toMatch(/project/) // no projects selected
  })

  it('renders a header-only employer entirely by code: no model call, title and dates untouched, no "promoted"', async () => {
    const vault = writeVault()
    const r = await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx())
    const old = r.sections.find((s) => s.id === `experience:${OLD_CO}`)!
    expect(old.markdown).toBe('### Old Co\n**Coordinator** · Jan 2010 – Dec 2014')
    expect(old.model).toBeUndefined()
    expect(old.log).toMatchObject({ model: null, tokens: { input: 0, output: 0 } })
    expect(old.log.notes[0]).toMatch(/rendered by code, no model call/)
    const unity = r.sections.find((s) => s.id === `experience:${UNITY}`)!
    expect(unity.markdown).toContain('**Snr. Program Manager** · Jan 2019 – present')
    expect(unity.markdown).toContain('_Two roles at Unity (2019–present): Program Manager → Snr. Program Manager_')
    expect(r.sections.map((s) => s.markdown).join('\n')).not.toMatch(/promot/i)
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
    experienceOverride = () => ({ summary: 'Did the work.', block: ':::compact-list\n- Grew revenue 91%.\n:::' })
    const { vault, sel } = fourEmployers()
    const r = await runWrite(vault, buildBriefFor(), sel, strategy, ctx())
    expect(r.checkNotes).toHaveLength(3)
  })

  it('fails the run (WriteStageError → invalid_output) when an experience writer cannot produce valid output, keeping the section rows so far', async () => {
    experienceOverride = (prompt) => (prompt.includes('[ba1]') ? 'junk' : unityAnswer)
    const vault = writeVault()
    const err = await runWrite(vault, buildBriefFor(), writeSelection(vault), strategy, ctx()).catch((e) => e)
    expect(err).toBeInstanceOf(WriteStageError)
    expect(err.original).toMatchObject({ kind: 'invalid_output' })
    const rows = (err as WriteStageError).sectionLogs
    expect(rows.find((r) => r.id === `experience:${BLIZZARD}`)).toMatchObject({ status: 'failed' })
    expect(rows.find((r) => r.id === `experience:${OLD_CO}`)).toMatchObject({ status: 'ok' })
    // The profile writer never started.
    expect(seen.some((s) => s.feature === 'cv-gen-write-profile')).toBe(false)
    // Each writer made at most two calls: Blizzard's junk was retried once.
    expect(seen.filter((s) => s.prompt.includes('[ba1]'))).toHaveLength(2)
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
    expect(r.sections.find((s) => s.id === `experience:${UNITY}`)!.log.notes[0]).toMatch(/None of its selected activities is still in the profile/)
    expect(r.sections.find((s) => s.id === 'certification')).toBeUndefined()
    expect(r.sections.find((s) => s.id === 'tools')).toBeUndefined()
  })

})
