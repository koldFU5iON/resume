import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/llm/complete-json', () => ({ completeJSON: vi.fn() }))
vi.mock('@/modules/llm/prompt-context', () => ({
  composeSystem: (...p: Array<string | null>) => p.filter(Boolean).join('\n\n---\n\n'),
  loadCVReviewPrompt: vi.fn(async () => 'REVIEW INSTRUCTIONS'),
  loadWritingContext: vi.fn(async () => ({ rules: 'WRITING RULES', brief: null, searchProfileSummary: null })),
}))

import { completeJSON } from '@/modules/llm/complete-json'
import * as z from 'zod'
import { extractJSON } from '@/modules/llm/extract-json'
import { LLMError } from '@/modules/llm/errors'
import { toProfileSnapshot } from '@/modules/profile/snapshot'
import { assembleCv, recheckMarkdown } from '../assemble'
import { buildBriefFor } from '../__fixtures__/gathered'
import { INDEPENDENT_CLAIM, INDEPENDENT_RESULT, independentProjectsFixture } from '../__fixtures__/independent-projects'
import { BLIZZARD, UNITY, projectRow, scripted, writeSelection, writeVault, writtenSections } from '../__fixtures__/write'
import { REVIEW_LIMITS, ReviewOutputContract, ReviewOutputSchema, type CvAssembled, type ReviewOutput } from '../schema'
import { evidenceFromVault } from './evidence'
import { experiencePrompt } from './experience'
import { PROJECT_EVIDENCE_MAX_CHARS, capProjectText } from './limits'
import { renderEmployerEntry, renderIndependentProject } from './render'
import {
  REVIEW_SUMMARY_EVIDENCE_MAX, applyEdits, renderExperience, reviewDoc, reviewPrompt, runReview, splitExperience, toConcernRecords, writeBack, type ApplyContext, type ReviewPromptInput,
} from './review'
import type { WrittenSection } from './types'
import { leads } from '../__fixtures__/candidates'

const mockJSON = vi.mocked(completeJSON)

const vault = writeVault()
const selection = writeSelection(vault)
const evidence = evidenceFromVault(vault, selection)
const snapshot = toProfileSnapshot(vault)
const strategy = { mustHave: ['Delivery at scale', 'Stakeholder management'], niceToHave: [] as string[] }
const brief = buildBriefFor()
const emp = (key: string) => evidence.employers.find((e) => e.employer.key === key)!

const UNITY_SUMMARY = 'Ran release and planning for the platform org.'
const UNITY_BULLETS: Array<{ text: string; id: string; kind?: 'activity' | 'project' }> = [
  { text: 'Cut platform release time by 40% across 8 teams, saving 2 weeks per release.', id: 'ua1' },
  { text: 'Ran the quarterly planning cycle for the platform org.', id: 'ua2' },
  { text: 'Shipped 12 titles on schedule.', id: 'ua3' },
]
const PROFILE = 'Programme leader who ships platforms on schedule.'

const wsec = (id: string, kind: string, markdown: string, over: Partial<WrittenSection> = {}): WrittenSection => ({
  id, kind, markdown, log: { id, label: id, status: 'ok', model: null, durationMs: 0, tokens: { input: 0, output: 0 }, costUsd: null, retries: 0, retryReasons: [], notes: [] }, ...over,
})

function assembled(over: { profile?: string; unity?: Array<{ text: string; id: string; kind?: 'activity' | 'project' }> } = {}): CvAssembled {
  const ub = over.unity ?? UNITY_BULLETS
  const unity = emp(UNITY).employer
  const blizzard = emp(BLIZZARD).employer
  const res = assembleCv({
    name: 'Robin Placeholder',
    headline: null,
    employerOrder: [UNITY, BLIZZARD],
    checkNotes: [],
    snapshot,
    sections: [
      wsec(`experience:${UNITY}`, 'experience', renderEmployerEntry(unity, UNITY_SUMMARY, ub.map((b) => b.text)), {
        employerKey: UNITY,
        bullets: ub.map((b) => ({ text: b.text, sources: [{ id: b.id, kind: b.kind ?? ('activity' as const), snippet: 'short snippet' }] })),
      }),
      wsec(`experience:${BLIZZARD}`, 'experience', renderEmployerEntry(blizzard, 'Launched a title.', ['Launched a live-service title for 2M players.']), {
        employerKey: BLIZZARD, bullets: [{ text: 'Launched a live-service title for 2M players.', sources: [{ id: 'ba1', kind: 'activity' as const, snippet: 'x' }] }],
      }),
      wsec('profile', 'profile', over.profile ?? PROFILE),
      wsec('competencies', 'competencies', ':::skills\n- Cross-functional leadership\n:::'),
      wsec('skills', 'skills', ':::skills\n- Release management\n:::'),
      wsec('tools', 'tools', ':::inline-list\n- Jira\n:::'),
      wsec('certification', 'certification', '- **PMP** — PMI (2018)'),
      wsec('education', 'education', '- **MSc in Supply chain** — Example University (2012 – 2014)'),
      wsec('earlier-experience', 'earlier-experience', ':::compact-list\n- Old Co — Coordinator, 2010–2014\n:::'),
    ],
  })
  if (!res.ok) throw new Error(`fixture invalid: ${res.issues.join('; ')}`)
  return res.assembled
}

const input = (over: Partial<ReviewPromptInput> = {}): ReviewPromptInput => ({
  assembled: assembled(), selection: { ...selection, uncovered: ['Platform migration delivery'] }, brief, strategy, evidence, ...over,
})
const actx = (over: Partial<ApplyContext> = {}): ApplyContext => ({ brief, strategy, evidence, ...over })
const freshDoc = () => reviewDoc(assembled(), selection, evidence)

type Edit = ReviewOutput['edits'][number]
const edit = (sectionId: string, bulletId: string | undefined, action: 'replace' | 'remove', newText?: string): Edit => ({ target: { sectionId, bulletId }, action, newText, reason: 'because' })
const U = `experience:${UNITY}`

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

it('gives Review the independent evidence for coverage and concerns and protects it during write-back', async () => {
  const { vault, selection } = independentProjectsFixture()
  const evidence = evidenceFromVault(vault, selection)
  const projects = evidence.independentProjects.flatMap((p) => {
    const rendered = renderIndependentProject(p)
    return rendered.markdown ? [wsec(`projects:${p.id}`, 'projects', rendered.markdown, rendered)] : []
  })
  const snapshot = toProfileSnapshot(vault)
  const cv = assembleCv({ name: 'Candidate', headline: null, sections: [...writtenSections(), ...projects], employerOrder: [UNITY, BLIZZARD], checkNotes: [], snapshot })
  if (!cv.ok) throw new Error(cv.issues.join(', '))
  const reviewInput = input({ assembled: cv.assembled, selection, evidence })
  const { prompt, labels } = reviewPrompt(reviewInput, reviewDoc(cv.assembled, selection, evidence))
  const resultRef = labels.find((l) => l.id === 'workshop-atom')
  const contextRef = labels.find((l) => l.id === 'assistant')
  expect(resultRef).toMatchObject({ kind: 'activity', snippet: expect.stringContaining(INDEPENDENT_RESULT) })
  expect(contextRef).toMatchObject({ kind: 'project', snippet: expect.stringContaining('Handled ~1,400 requests') })
  expect(prompt).toContain('## projects:workshop [read-only]')
  expect(prompt).toContain('Workshop Campaign 18')
  expect(prompt).not.toMatch(/1970|@example|https?:|Pending extraction|Independent sentinel/)

  const reply = scripted(extractJSON as never, [{
    edits: [
      edit('projects:workshop', 'b1', 'remove'),
      edit('projects:assistant', undefined, 'replace', 'A rewritten project.'),
      edit(U, 'b1', 'replace', `${INDEPENDENT_CLAIM}.`),
      edit(U, 'b1', 'replace', 'Handled 1,400 requests.'),
      edit('profile', undefined, 'replace', 'I run release programmes for platform teams.'),
    ],
    concerns: [{ kind: 'evidence_gap', title: 'Pilot scope', why: 'Scope could be clearer', question: 'Who used the pilot?', refs: [resultRef!.label, contextRef!.label] }],
  }])
  mockJSON.mockImplementation(reply.impl as never)
  const out = await runReview({ ...reviewInput, validate: (md) => recheckMarkdown(md, snapshot).errors }, {
    profileId: 'p1', jobApplicationId: 'job', runId: 'run', deadline: Date.now() + 120_000,
  })
  expect(out.review.applied.map((edit) => edit.sectionId)).toEqual(['profile'])
  expect(out.review.discarded.map((d) => d.why)).toEqual([
    expect.stringContaining('read-only'),
    expect.stringContaining('read-only'),
    'attributes independent project evidence to this employer',
    expect.stringContaining("figures not in the employer's evidence"),
  ])
  expect(out.review.concerns[0].refs.map((r) => r.label)).toEqual([resultRef!.label, contextRef!.label])
  expect(out.assembled.sections.filter((s) => s.kind === 'projects')).toEqual(cv.assembled.sections.filter((s) => s.kind === 'projects'))
})

describe('splitExperience / renderExperience', () => {
  const unity = emp(UNITY).employer
  it.each([
    ['with a summary', UNITY_SUMMARY],
    ['without a summary', ''],
  ])('round-trips a rendered entry %s, byte for byte', (_n, summary) => {
    const md = `## Professional Experience\n\n${renderEmployerEntry(unity, summary, ['One thing done.', 'Another thing done.'])}`
    const split = splitExperience(md)!
    expect(split.summary).toBe(summary)
    expect(split.bullets).toEqual(['One thing done.', 'Another thing done.'])
    expect(renderExperience({ head: split.head, summary: split.summary, bullets: split.bullets.map((text, i) => ({ id: `b${i}`, text, sources: [], removed: false })) })).toBe(md)
  })

  it('keeps the heading, the title line and the progression line out of the editable text', () => {
    const split = splitExperience(`## Professional Experience\n\n${renderEmployerEntry(unity, 'Sum.', ['A done.'])}`)!
    expect(split.head).toContain('## Professional Experience')
    expect(split.head).toContain('### Unity')
    expect(split.head).toContain('**Snr. Program Manager**')
    expect(split.summary).toBe('Sum.')
  })

  it('returns null for a section with no bullet block', () => {
    expect(splitExperience('### Unity\n\nText only')).toBeNull()
  })
})

describe('reviewPrompt', () => {
  const { prompt, labels } = reviewPrompt(input(), freshDoc())

  it('carries the section ids, the bullet ids, the summary and the profile', () => {
    expect(prompt).toContain(`## ${U} — Snr. Program Manager at Unity (current role)`)
    expect(prompt).toContain('b1: Cut platform release time by 40%')
    expect(prompt).toContain('b3: Shipped 12 titles on schedule.')
    expect(prompt).toContain(`summary: ${UNITY_SUMMARY}`)
    expect(prompt).toContain(`## profile\n${PROFILE}`)
    expect(prompt).toContain(`${BLIZZARD}`)
  })

  it('shows each bullet its evidence by label with the real text the writer saw (not the stored short snippet)', () => {
    expect(labels.length).toBeGreaterThanOrEqual(4)
    expect(prompt).toMatch(/S1 \(activity\): \S+: Cut platform release time by 40% across 8 teams — impact: saved 2 weeks per release/)
  })

  it('gives the reviewer the same project text, with the same cap, as the experience writer (a figure late in a long project text is visible)', () => {
    const tail = 'Outcomes and Metrics: reached 14,000+ voters.'
    const text = `${'Built the campaign. '.repeat(40)}${tail}` // the figure sits past 300 characters but inside the writer's cap
    expect(text.indexOf(tail)).toBeGreaterThan(300)
    expect(text.indexOf(tail) + tail.length).toBeLessThan(PROJECT_EVIDENCE_MAX_CHARS)
    const ev = evidenceFromVault(vault, selection)
    ev.employers.find((e) => e.employer.key === UNITY)!.projects = [{ id: 'up1', name: 'Awards Demo', text }]
    const asm = assembled({ unity: [...UNITY_BULLETS.slice(0, 2), { text: 'Reached 14,000+ voters with the demo.', id: 'up1', kind: 'project' }] })
    const { prompt: p, labels: ls } = reviewPrompt(input({ evidence: ev, assembled: asm }), reviewDoc(asm, selection, ev))
    expect(p).toContain(tail)
    const writer = experiencePrompt({ brief, strategy }, ev.employers.find((e) => e.employer.key === UNITY)!)
    expect(writer).toContain(capProjectText(text))
    expect(ls.find((l) => l.id === 'up1')!.snippet).toBe(`Awards Demo: ${capProjectText(text)}`)
  })

  it('caps a very long project text at the writer cap, never at 300 characters', () => {
    const ev = evidenceFromVault(vault, selection)
    ev.employers.find((e) => e.employer.key === UNITY)!.projects = [{ id: 'up1', name: 'Big', text: 'word '.repeat(600) }]
    const asm = assembled({ unity: [{ text: 'Did a thing for the demo.', id: 'up1', kind: 'project' }] })
    const { labels: ls } = reviewPrompt(input({ evidence: ev, assembled: asm }), reviewDoc(asm, selection, ev))
    const len = ls.find((l) => l.id === 'up1')!.snippet.length
    expect(len).toBeGreaterThan(300)
    expect(len).toBeLessThanOrEqual('Big: '.length + PROJECT_EVIDENCE_MAX_CHARS + 1)
  })

  it('lists the employer\'s selected activities that no bullet cites as labelled evidence for its summary, capped', () => {
    const asm = assembled({ unity: UNITY_BULLETS.slice(0, 2) }) // ua3 is selected but not cited
    const out = reviewPrompt(input({ assembled: asm }), reviewDoc(asm, selection, evidence))
    expect(out.prompt).toMatch(/summary evidence[^\n]*\n\s+S\d+ \(activity\): \S+: Shipped 12 titles on schedule/)
    expect(out.labels.some((l) => l.id === 'ua3')).toBe(true)
    const many = evidenceFromVault(vault, selection)
    const u = many.employers.find((e) => e.employer.key === UNITY)!
    u.activities = Array.from({ length: 20 }, (_, i) => ({ ...u.activities[0], id: `x${i}`, text: `Extra ${i}`, impact: null }))
    const capped = reviewPrompt(input({ evidence: many, assembled: asm }), reviewDoc(asm, selection, many))
    expect(capped.prompt.match(/\(activity\): \S+: Extra/g) ?? []).toHaveLength(REVIEW_SUMMARY_EVIDENCE_MAX)
  })

  it('shows an activity whole, as the writer sees it', () => {
    const long = evidenceFromVault(vault, selection)
    long.employers[0].activities[0] = { ...long.employers[0].activities[0], text: 'word '.repeat(200).trim(), impact: null }
    const { labels: l2 } = reviewPrompt(input({ evidence: long }), reviewDoc(assembled(), selection, long))
    expect(l2[0].snippet.length).toBeGreaterThan(300)
  })

  it('carries the brief, the requirement terms, the claimed tools, the in-progress items and the uncovered emphasise items', () => {
    expect(prompt).toContain(brief.hiddenQuestion)
    expect(prompt).toContain('Platform migration delivery')
    expect(prompt).toContain('Delivery at scale')
    expect(prompt).toMatch(/<claimed>[\s\S]*Tableau[\s\S]*<\/claimed>/)
    expect(prompt).toMatch(/<in_progress>[\s\S]*SAFe Program Consultant[\s\S]*<\/in_progress>/)
    expect(prompt).toMatch(/<uncovered>[\s\S]*Platform migration delivery[\s\S]*<\/uncovered>/)
  })

  it('is lean: no header, no name, no contact placeholder, no email, none of the code-rendered sections, not the whole profile', () => {
    expect(prompt).not.toContain('Robin Placeholder')
    expect(prompt).not.toContain('{{contact}}')
    expect(prompt).not.toMatch(/@|https?:\/\//)
    expect(prompt).not.toContain('Example University')
    expect(prompt).not.toContain('Old Co')
    expect(prompt).not.toContain('PMI')
  })
})

describe('applyEdits: edits applied only after the checks', () => {
  it('applies a reworded bullet that stays inside the evidence, and keeps its sources', () => {
    const doc = freshDoc()
    const r = applyEdits(doc, [edit(U, 'b2', 'replace', 'Led quarterly planning for the platform org.')], actx())
    expect(r.discarded).toEqual([])
    expect(r.applied).toEqual([{ sectionId: U, bulletId: 'b2', action: 'replace', before: UNITY_BULLETS[1].text, after: 'Led quarterly planning for the platform org.', reason: 'because', note: '' }])
    expect(doc.experience.get(U)!.bullets[1].sources[0].id).toBe('ua2')
    expect(doc.experience.get(U)!.bullets[1].edited).toBe(true)
  })

  it('applies a removal and a summary reword, and rewords the profile', () => {
    const doc = freshDoc()
    const r = applyEdits(doc, [
      edit(U, 'b3', 'remove'),
      edit(U, 'summary', 'replace', 'Ran release cycles for the platform org.'),
      edit('profile', undefined, 'replace', 'Delivery leader for platform organisations.'),
    ], actx())
    expect(r.discarded).toEqual([])
    expect(r.applied.map((a) => a.action)).toEqual(['remove', 'replace', 'replace'])
    expect(doc.profile!.paragraph).toBe('Delivery leader for platform organisations.')
  })

  it.each([
    ['a figure that is not in the employer evidence', 'Ran planning that saved £2m.', /figures not in the employer's evidence/],
    ['a figure from ANOTHER employer', 'Launched a live-service title for 2M players.', /figures not in the employer's evidence/],
    ['first person', 'I ran the quarterly planning cycle.', /not plain text \(first person\)/],
    ['Markdown', 'Ran the **quarterly** planning [cycle](http://x.test).', /not plain text/],
    ['the contact placeholder', 'Ran planning {{contact}}.', /not plain text/],
    ['an unevidenced tool the job does not ask for', 'Ran planning reviews in Tableau.', /without evidence/],
    ['an introduced title', 'Ran planning as Program Manager.', /introduces a job title/],
    ['an introduced company', 'Ran planning after Blizzard Entertainment.', /introduces a company name/],
    ['an in-progress certification as held', 'Ran planning and earned SAFe Program Consultant certification.', /not finished yet/],
    ['the present tense on a measured result in the current role', 'Cuts platform release time by 40% across 8 teams.', /present tense/],
    ['more than the word limit', Array.from({ length: 30 }, (_, i) => `word${i}`).join(' '), /30 words; the limit is 25/],
    ['a figure that the entry already states', 'Cut release time by 40%.', /repeats a figure already stated in this entry or the profile/],
  ])('discards a replace with %s, naming why', (_n, text, why) => {
    const doc = freshDoc()
    // These two reuse figures of the first bullet's evidence, so the bullet must cite it for the check under test to be reached.
    if (/40%/.test(text)) doc.experience.get(U)!.bullets[2].sources = [{ id: 'ua1', kind: 'activity', snippet: '' }]
    const r = applyEdits(doc, [edit(U, 'b3', 'replace', text)], actx())
    expect(r.applied).toEqual([])
    expect(r.discarded).toHaveLength(1)
    expect(r.discarded[0].why).toMatch(why)
    expect(r.discarded[0]).toMatchObject({ sectionId: U, bulletId: 'b3', action: 'replace', proposed: text, reason: 'because' })
    expect(doc.experience.get(U)!.bullets[2].text).toBe(UNITY_BULLETS[2].text) // untouched
  })

  it('allows a claimed tool the job names (the writers allow it too)', () => {
    const r = applyEdits(freshDoc(), [edit(U, 'b2', 'replace', 'Ran quarterly planning reviews in Tableau.')], actx({ strategy: { mustHave: ['Tableau dashboards'], niceToHave: [] } }))
    expect(r.discarded).toEqual([])
    expect(r.applied).toHaveLength(1)
  })

  it('discards a bullet about a play-down item', () => {
    const r = applyEdits(freshDoc(), [edit(U, 'b2', 'replace', 'Led early career support work for the platform org.')], actx())
    expect(r.discarded[0].why).toMatch(/play-down item/)
  })

  it('discards a bullet edit that adds a negation its cited evidence lacks', () => {
    const r = applyEdits(freshDoc(), [edit(U, 'b1', 'replace', 'Cut platform release time by 40% with no handoffs across 8 teams.')], actx())
    expect(r.applied).toEqual([])
    expect(r.discarded[0].why).toMatch(/adds "no".*must not change the meaning/)
  })

  it('does not refuse a profile edit for dynamic pricing or proactive monitoring', () => {
    const r = applyEdits(freshDoc(), [edit('profile', undefined, 'replace', 'I run release programmes for platform teams, from dynamic pricing to proactive monitoring.')], actx())
    expect(r.discarded).toEqual([])
  })

  it('allows a profile edit to repeat a figure from the experience section, but not a personality claim', () => {
    const shared = applyEdits(freshDoc(), [edit('profile', undefined, 'replace', 'Cut release time by 40% for platform teams.')], actx())
    expect(shared.discarded).toEqual([])
    const style = applyEdits(freshDoc(), [edit('profile', undefined, 'replace', 'I run release programmes for platform teams and I work best where roles are clear.')], actx())
    expect(style.discarded[0].why).toMatch(/working-style or personality claim/)
  })

  it('keeps a profile edit in first person (the profile is written that way), but still refuses first person in a bullet or summary', () => {
    const profile = applyEdits(freshDoc(), [edit('profile', undefined, 'replace', "I run release programmes for platform organisations and I've built the planning cadence for my teams.")], actx())
    expect(profile.discarded).toEqual([])
    expect(profile.applied).toHaveLength(1)
    const bullet = applyEdits(freshDoc(), [edit(U, 'b2', 'replace', 'I led quarterly planning for the platform org.')], actx())
    expect(bullet.discarded[0].why).toMatch(/not plain text \(first person\)/)
  })

  describe('the supplied years phrase (code-computed, supported)', () => {
    const years = (text: string, yearsOfExperience: number | null = 20) =>
      applyEdits(freshDoc(), [edit('profile', undefined, 'replace', text)], actx({ yearsOfExperience }))
    it('applies a profile edit that keeps the supplied phrase', () => {
      const r = years("I've spent 20+ years running release programmes for platform teams.")
      expect(r.discarded).toEqual([])
      expect(r.applied).toHaveLength(1)
    })
    it('discards an edit that changes it to another number', () => {
      expect(years("I've spent 25+ years running release programmes for platform teams.").discarded[0].why).toMatch(/years.*"20\+ years"/)
      expect(years("I've spent 20 years running release programmes for platform teams.").discarded[0].why).toMatch(/years/)
    })
    it('accepts an edit that drops it when the replacement states no years', () => {
      expect(years('I run release programmes for platform teams.').discarded).toEqual([])
    })
    it('with no phrase supplied, a stated number of years is still refused', () => {
      expect(years("I've spent 20+ years running release programmes.", null).discarded).toHaveLength(1)
    })
  })

  it('shows the reviewer the supplied years phrase as supported evidence for the profile', () => {
    const { prompt } = reviewPrompt(input({ yearsOfExperience: 20 }), freshDoc())
    expect(prompt).toContain('Years of experience (computed from the profile, supported): 20+ years')
    expect(reviewPrompt(input(), freshDoc()).prompt).not.toContain('Years of experience')
  })

  it('discards a replace with no new text, and a no-op replace', () => {
    const r = applyEdits(freshDoc(), [edit(U, 'b2', 'replace'), edit(U, 'b2', 'replace', UNITY_BULLETS[1].text)], actx())
    expect(r.discarded.map((d) => d.why)).toEqual(['a replace needs the new text', 'the new text is the same as the old'])
  })

  describe('remove', () => {
    it('never leaves an employer with zero bullets: the last removal is discarded, the earlier ones apply', () => {
      const doc = freshDoc()
      const r = applyEdits(doc, [edit(U, 'b1', 'remove'), edit(U, 'b2', 'remove'), edit(U, 'b3', 'remove')], actx())
      expect(r.applied.map((a) => a.bulletId)).toEqual(['b1', 'b2'])
      expect(r.discarded).toHaveLength(1)
      expect(r.discarded[0]).toMatchObject({ bulletId: 'b3', why: expect.stringMatching(/last bullet/) })
      expect(doc.experience.get(U)!.bullets.filter((b) => !b.removed)).toHaveLength(1)
    })

    it('discards removing the only bullet of a one-bullet employer', () => {
      const r = applyEdits(freshDoc(), [edit(`experience:${BLIZZARD}`, 'b1', 'remove')], actx())
      expect(r.applied).toEqual([])
      expect(r.discarded[0].why).toMatch(/last bullet/)
    })

    it('discards a second edit of a bullet that was already removed', () => {
      const r = applyEdits(freshDoc(), [edit(U, 'b1', 'remove'), edit(U, 'b1', 'replace', 'Ran planning.')], actx())
      expect(r.discarded[0].why).toMatch(/already removed/)
    })

    it('does not allow removing the profile paragraph', () => {
      const r = applyEdits(freshDoc(), [edit('profile', undefined, 'remove')], actx())
      expect(r.discarded[0].why).toMatch(/only be reworded/)
    })
  })

  describe('forbidden targets are rejected (code renders them)', () => {
    it.each(['header', 'earlier-experience', 'certification', 'education', 'languages', 'competencies', 'tools', 'skills'])('%s', (id) => {
      const doc = freshDoc()
      const before = writeBack(assembled(), doc).markdown
      const r = applyEdits(doc, [edit(id, undefined, 'replace', 'Anything at all.'), edit(id, 'b1', 'remove')], actx())
      expect(r.applied).toEqual([])
      expect(r.discarded).toHaveLength(2)
      expect(r.discarded[0].why).toMatch(/rendered by code from your profile and is read-only/)
      expect(writeBack(assembled(), doc).markdown).toBe(before)
    })

    it('an unknown section, an unknown bullet, a missing bullet id on an entry, a bullet id on the profile', () => {
      const r = applyEdits(freshDoc(), [
        edit('experience:nope', 'b1', 'remove'), edit(U, 'b9', 'remove'), edit(U, undefined, 'replace', 'Ran planning.'), edit('profile', 'b1', 'replace', 'Ran planning.'),
      ], actx())
      expect(r.applied).toEqual([])
      expect(r.discarded.map((d) => d.why)).toEqual([
        'there is no editable section "experience:nope"', 'there is no bullet "b9" in this entry',
        'name a bullet ("b1"...) or "summary" to edit in an experience entry', 'the profile has no bullets: leave bulletId out to reword its paragraph',
      ])
    })

    it('titles, companies and dates cannot be reached: the heading lines are never in the document model', () => {
      const doc = freshDoc()
      applyEdits(doc, [edit(U, 'summary', 'replace', 'Ran release cycles for the platform org.')], actx())
      const md = writeBack(assembled(), doc).markdown
      expect(md).toContain('### Unity')
      expect(md).toContain('**Snr. Program Manager** · Jan 2019 – present')
      expect(md).toContain('{{contact}}')
    })
  })

  it('applies at most the edit limit', () => {
    const many = Array.from({ length: 12 }, () => edit(U, 'b9', 'remove'))
    const r = applyEdits(freshDoc(), many, actx())
    expect(r.discarded).toHaveLength(REVIEW_LIMITS.maxEdits)
  })
})

describe('applyEdits: names, tools and claims the evidence does not make (review fix 3)', () => {
  it.each([
    ['a tool', 'Shipped 12 titles on Kubernetes.', /Kubernetes/],
    ['an acronym', 'Shipped 12 titles at EA.', /\bEA\b/],
    ['a dotted tool', 'Shipped 12 titles using Node.js.', /Node\.js/],
    ['a digit-bearing name', 'Shipped 12 titles on GA4.', /GA4/],
    ['a capitalised name', 'Shipped 12 titles across Europe.', /Europe/],
  ])('discards a replace that introduces %s', (_n, text, mention) => {
    const r = applyEdits(freshDoc(), [edit(U, 'b3', 'replace', text)], actx())
    expect(r.applied).toEqual([])
    expect(r.discarded[0].why).toMatch(/introduces a name, tool or acronym/)
    expect(r.discarded[0].why).toMatch(mention)
  })

  it('does NOT let the job\'s requirement text allow a name: job keywords cannot be stuffed in', () => {
    const r = applyEdits(freshDoc(), [edit(U, 'b3', 'replace', 'Shipped 12 titles on Kubernetes.')], actx({ strategy: { mustHave: ['Kubernetes orchestration', 'Delivery at scale'], niceToHave: ['EA'] } }))
    expect(r.applied).toEqual([])
    expect(r.discarded[0].why).toMatch(/Kubernetes/)
  })

  it('discards an unsupported qualitative claim', () => {
    const r = applyEdits(freshDoc(), [edit(U, 'b3', 'replace', 'Shipped 12 award-winning titles on schedule.')], actx())
    expect(r.discarded[0].why).toMatch(/adds a claim the evidence does not make: award-winning/)
  })

  it('allows a name the old text, the evidence or the profile already has (a tool the profile lists with evidence)', () => {
    const r = applyEdits(freshDoc(), [edit(U, 'b2', 'replace', 'Ran quarterly planning in Jira.')], actx())
    expect(r.discarded).toEqual([])
    expect(r.applied).toHaveLength(1)
  })

  it('checks number words in a replace by value, like digits', () => {
    const r = applyEdits(freshDoc(), [edit(U, 'b2', 'replace', 'Ran planning for forty teams.')], actx())
    expect(r.discarded[0].why).toMatch(/figures not in the employer's evidence: forty/)
  })
})

describe('applyEdits: the writers\' lead-with and project rules still hold after an edit (review fix 2)', () => {
  const PROJ = 'Enemies Demo Campaign'
  const pvault = writeVault([projectRow('pr1', PROJ, 'Ran the demo campaign for a new title and chose the launch timing, then tracked how the first day went against the plan.', { experienceId: 'e-u2' })])
  const pselection = writeSelection(pvault, { projects: [{ id: 'pr1', reason: '' }] })
  const pevidence = evidenceFromVault(pvault, pselection)
  const lead = buildBriefFor({ leadWith: leads([`The ${PROJ}: a go-to-market launch-timing decision`]) })
  const noLead = buildBriefFor({ leadWith: leads([]) })
  const bullets = [
    { text: `${PROJ}: led the launch timing decision for the new title.`, id: 'pr1', kind: 'project' as const },
    { text: 'Ran the quarterly planning cycle for the platform org.', id: 'ua2' },
    { text: 'Shipped 12 titles on schedule.', id: 'ua3' },
  ]
  const pdoc = () => reviewDoc(assembled({ unity: bullets }), pselection, pevidence)
  const pctx = (brief: typeof lead) => ({ brief, strategy, evidence: pevidence })

  it('discards removing the lead-with project\'s own bullet', () => {
    const r = applyEdits(pdoc(), [edit(U, 'b1', 'remove')], pctx(lead))
    expect(r.applied).toEqual([])
    expect(r.discarded[0].why).toMatch(/own bullet of the lead-with project "Enemies Demo Campaign"/)
  })

  it('discards a replace that moves the lead-with project out of its own bullet (named only late, or not at all)', () => {
    const gone = applyEdits(pdoc(), [edit(U, 'b1', 'replace', 'Led launch timing for the new title.')], pctx(lead))
    expect(gone.discarded[0].why).toMatch(/own bullet of the lead-with project/)
    const trailing = applyEdits(pdoc(), [edit(U, 'b1', 'replace', `Led the launch timing decision for the new title in the ${PROJ}.`)], pctx(lead))
    expect(trailing.discarded[0].why).toMatch(/own bullet of the lead-with project/)
  })

  it('keeps a rewrite that names the project by its distinctive words early in the bullet (no full name)', () => {
    const r = applyEdits(pdoc(), [edit(U, 'b1', 'replace', 'Led the Enemies launch timing decision for the new title.')], pctx(lead))
    expect(r.discarded).toEqual([])
    expect(r.applied).toHaveLength(1)
  })

  it('still discards a rewrite that no longer mentions the project at all, or only by a generic word', () => {
    const r = applyEdits(pdoc(), [edit(U, 'b1', 'replace', 'Led the demo campaign launch timing decision for the new title.')], pctx(lead))
    expect(r.discarded[0].why).toMatch(/own bullet of the lead-with project/)
  })

  it('still allows rewording that keeps the project as the bullet\'s subject', () => {
    const r = applyEdits(pdoc(), [edit(U, 'b1', 'replace', `${PROJ}: led the launch timing for the new title.`)], pctx(lead))
    expect(r.discarded).toEqual([])
    expect(r.applied).toHaveLength(1)
  })

  it('discards removing or rewording away the only bullet that reflects a selected (not lead-with) project', () => {
    const removed = applyEdits(pdoc(), [edit(U, 'b1', 'remove')], pctx(noLead))
    expect(removed.discarded[0].why).toMatch(/leaves the selected project "Enemies Demo Campaign" out of the entry/)
    const reworded = applyEdits(pdoc(), [edit(U, 'b1', 'replace', 'Led launch timing for the new title.')], pctx(noLead))
    expect(reworded.discarded[0].why).toMatch(/leaves the selected project/)
  })

  it('does not blame an edit for a rule the entry already broke', () => {
    const broken = [{ ...bullets[0], text: 'Led launch timing for the new title.' }, bullets[1], bullets[2]]
    const r = applyEdits(reviewDoc(assembled({ unity: broken }), pselection, pevidence), [edit(U, 'b2', 'remove')], pctx(noLead))
    expect(r.applied).toHaveLength(1)
  })
})

describe('applyEdits: a bullet whose only source is a thin project may be removed', () => {
  const PROJ = 'Enemies Demo Campaign'
  const tv = writeVault([projectRow('pr1', PROJ, `${PROJ}:`, { experienceId: 'e-u2' })])
  const tsel = writeSelection(tv, { projects: [{ id: 'pr1', reason: '' }] })
  const tev = evidenceFromVault(tv, tsel)
  const lead = buildBriefFor({ leadWith: leads([`The ${PROJ}: launch and GTM decision`]) })
  const bullets = [
    { text: `${PROJ}: set the timing and positioning narrative, and tracked the first-day result.`, id: 'pr1', kind: 'project' as const },
    { text: 'Ran the quarterly planning cycle for the platform org.', id: 'ua2' },
  ]
  const doc = () => reviewDoc(assembled({ unity: bullets }), tsel, tev)

  it('the removal is applied (it used to be discarded as "the own bullet of the lead-with project")', () => {
    const r = applyEdits(doc(), [edit(U, 'b1', 'remove')], { brief: lead, strategy, evidence: tev })
    expect(r.discarded).toEqual([])
    expect(r.applied).toHaveLength(1)
  })

  it('rewording it to drop the project name is allowed too', () => {
    const r = applyEdits(doc(), [edit(U, 'b1', 'replace', 'Set the launch timing for the new title.')], { brief: lead, strategy, evidence: tev })
    expect(r.discarded).toEqual([])
  })
})

describe('applyEdits: summary removal, the profile paragraph and provenance (review fixes 7, 8, 9)', () => {
  it('refuses to remove an entry\'s summary (every entry keeps one) and says so', () => {
    const r = applyEdits(freshDoc(), [edit(U, 'summary', 'remove')], actx())
    expect(r.applied).toEqual([])
    expect(r.discarded[0].why).toMatch(/summary cannot be removed/)
  })

  it('does not count the profile paragraph when checking a bullet edit for a repeated figure (the profile may repeat a bullet figure)', () => {
    const doc = reviewDoc(assembled({ profile: 'Delivery leader behind a title for 2M players.' }), selection, evidence)
    const r = applyEdits(doc, [edit(`experience:${BLIZZARD}`, 'b1', 'replace', 'Launched a live-service title for 2M players worldwide.')], actx())
    expect(r.discarded).toEqual([])
    expect(r.applied).toHaveLength(1)
  })

  it('marks a replaced bullet as edited by review and keeps its sources while it still states the figures it took from them', () => {
    const a = assembled()
    const doc = reviewDoc(a, selection, evidence)
    const r = applyEdits(doc, [edit(U, 'b1', 'replace', 'Cut platform release time by 40% across 8 teams.')], actx())
    expect(r.applied[0].note).toBe('')
    const out = writeBack(a, doc).sections.find((x) => x.id === U)!
    expect(out.bullets![0]).toMatchObject({ text: 'Cut platform release time by 40% across 8 teams.', editedByReview: true })
    expect(out.bullets![0].sources.map((x) => x.id)).toEqual(['ua1'])
    expect(out.bullets![1].editedByReview).toBeUndefined()
  })

  it('clears the sources and says so when the new text no longer states the figures of the evidence it cited', () => {
    const a = assembled()
    const doc = reviewDoc(a, selection, evidence)
    const r = applyEdits(doc, [edit(U, 'b1', 'replace', 'Cut platform release time across the teams.')], actx())
    expect(r.applied[0].note).toMatch(/sources were cleared: edited by review/)
    const b = writeBack(a, doc).sections.find((x) => x.id === U)!.bullets![0]
    expect(b).toMatchObject({ editedByReview: true, sources: [] })
  })

  it('rejects a bullet edit whose figure is only in evidence the bullet does not cite', () => {
    const r = applyEdits(freshDoc(), [edit(U, 'b2', 'replace', 'Ran planning that shipped 12 titles.')], actx())
    expect(r.applied).toEqual([])
    expect(r.discarded[0].why).toMatch(/12 is not in the evidence this bullet cited/)
  })

  it('lets a summary edit use a figure from any selected evidence of the employer, cited or not', () => {
    const asm = assembled({ unity: UNITY_BULLETS.slice(0, 2) }) // ua3 (12 titles) is selected but cited by no bullet
    const doc = reviewDoc(asm, selection, evidence)
    const r = applyEdits(doc, [edit(U, 'summary', 'replace', 'Ran platform planning and shipped 12 titles.')], actx())
    expect(r.discarded).toEqual([])
    expect(r.applied).toHaveLength(1)
  })
})

describe('writeBack', () => {
  it('is the identity when nothing changed', () => {
    const a = assembled()
    const out = writeBack(a, reviewDoc(a, selection, evidence))
    expect(out.markdown).toBe(a.markdown)
    expect(out.sections.map((s) => s.markdown)).toEqual(a.sections.map((s) => s.markdown))
  })

  it('writes edited bullets, a removed bullet and the profile back, in the Markdown and in the provenance, and the result validates', () => {
    const a = assembled()
    const doc = reviewDoc(a, selection, evidence)
    applyEdits(doc, [edit(U, 'b2', 'replace', 'Led quarterly planning for the platform org.'), edit(U, 'b3', 'remove'), edit('profile', undefined, 'replace', 'Delivery leader for platform organisations.')], actx())
    const out = writeBack(a, doc)
    expect(out.markdown).toContain('- Led quarterly planning for the platform org.')
    expect(out.markdown).not.toContain('Shipped 12 titles on schedule.')
    expect(out.markdown).toContain('## Professional Profile\n\nDelivery leader for platform organisations.')
    const unity = out.sections.find((s) => s.id === U)!
    expect(unity.bullets!.map((b) => b.text)).toEqual([UNITY_BULLETS[0].text, 'Led quarterly planning for the platform org.'])
    expect(unity.bullets![1].sources[0].id).toBe('ua2')
    expect(recheckMarkdown(out.markdown, snapshot).errors).toEqual([])
    expect(a.markdown).toContain('Shipped 12 titles on schedule.') // the input is not modified
  })
})

describe('ReviewOutputSchema and toConcernRecords', () => {
  const concern = (n: number) => ({ kind: 'weak_proof', title: `Concern ${n}`, why: 'w'.repeat(500), question: 'q'.repeat(500), refs: ['S1'] })

  it('cuts at 8 edits and 5 concerns and cuts long text instead of failing', () => {
    const out = ReviewOutputSchema.parse({
      edits: Array.from({ length: 12 }, () => ({ target: { sectionId: U, bulletId: 'b1' }, action: 'remove', reason: 'r'.repeat(900) })),
      concerns: Array.from({ length: 7 }, (_, n) => ({ ...concern(n), title: 't'.repeat(200) })),
    })
    expect(out.edits).toHaveLength(8)
    expect(out.edits[0].reason.length).toBeLessThanOrEqual(REVIEW_LIMITS.reasonChars)
    expect(out.concerns).toHaveLength(5)
    expect(out.concerns[0].title.length).toBeLessThanOrEqual(REVIEW_LIMITS.titleChars)
    expect(out.concerns[0].why.length).toBeLessThanOrEqual(REVIEW_LIMITS.whyChars)
    expect(out.concerns[0].question.length).toBeLessThanOrEqual(REVIEW_LIMITS.questionChars)
  })

  it('reads a null or missing bulletId as none (the profile edit): the answer is not thrown away', () => {
    const out = ReviewOutputSchema.parse({
      edits: [
        { target: { sectionId: 'profile', bulletId: null }, action: 'replace', newText: 'Delivery leader.', reason: 'r' },
        { target: { sectionId: 'profile' }, action: 'replace', newText: null, reason: 'r' },
      ],
      concerns: [],
    })
    expect(out.edits).toHaveLength(2)
    expect(out.edits[0].target.bulletId).toBeUndefined()
    expect(out.edits[1].newText).toBeUndefined()
    expect(out.unreadable).toEqual({ edits: 0, concerns: 0 })
  })

  it('drops ONE malformed edit or concern among valid ones, counting them, instead of failing the answer', () => {
    const out = ReviewOutputSchema.parse({
      edits: [
        { target: { sectionId: U, bulletId: 'b1' }, action: 'remove', reason: 'r' },
        { target: { sectionId: U, bulletId: 'b2' }, action: 'rewrite', reason: 'bad action' },
        { target: 'nope', action: 'remove', reason: 'r' },
        'junk',
        { target: { sectionId: U, bulletId: 'b3' }, action: 'remove', reason: 'r' },
      ],
      concerns: [concern(1), { ...concern(2), kind: 'vibes' }, concern(3)],
    })
    expect(out.edits.map((e) => e.target.bulletId)).toEqual(['b1', 'b3'])
    expect(out.concerns.map((c) => c.title)).toEqual(['Concern 1', 'Concern 3'])
    expect(out.unreadable).toEqual({ edits: 3, concerns: 1 })
  })

  it('reads a missing or non-list edits/concerns as empty, and still refuses an answer that is not an object', () => {
    expect(ReviewOutputSchema.parse({})).toMatchObject({ edits: [], concerns: [] })
    expect(ReviewOutputSchema.parse({ edits: 'none', concerns: null })).toMatchObject({ edits: [], concerns: [] })
    expect(ReviewOutputSchema.safeParse('text').success).toBe(false)
  })

  it('shows the model the strict contract (items are described, null bulletId allowed)', () => {
    const json = JSON.stringify(z.toJSONSchema(ReviewOutputContract, { io: 'input' }))
    expect(json).toContain('sectionId')
    expect(json).toContain('evidence_gap')
  })

  it('resolves refs to evidence snippets, drops unknown labels and repeated or empty concerns, and never stores more than 5', () => {
    const { labels } = reviewPrompt(input(), freshDoc())
    const parsed = ReviewOutputSchema.parse({
      edits: [],
      concerns: [
        { kind: 'metric_conflict', title: 'Two figures', why: 'w', question: 'Which is right?', refs: ['[S1]', 's2', 'S99'] },
        { kind: 'other', title: 'two figures', why: 'dup', question: 'dup?', refs: [] },
        { kind: 'other', title: '', why: 'no title', question: 'q', refs: [] },
        ...Array.from({ length: 2 }, (_, n) => ({ kind: 'weak_proof', title: `T${n}`, why: 'w', question: 'q?', refs: [] })),
      ],
    })
    const out = toConcernRecords(parsed.concerns, labels)
    expect(out).toHaveLength(3)
    const eight = Array.from({ length: 8 }, (_, n) => ({ kind: 'weak_proof' as const, title: `X${n}`, why: 'w', question: 'q?', refs: [] }))
    expect(toConcernRecords(eight, labels)).toHaveLength(5)
    expect(out[0].refs.map((r) => r.label)).toEqual(['S1', 'S2'])
    expect(out[0].refs[0].snippet).toContain('Cut platform release time')
    expect(out.map((c) => c.title)).not.toContain('')
  })
})

describe('runReview', () => {
  const answer = (over: Record<string, unknown> = {}) => ({
    edits: [{ target: { sectionId: U, bulletId: 'b2' }, action: 'replace', newText: 'Led quarterly planning for the platform org.', reason: 'tighter' }],
    concerns: [{ kind: 'evidence_gap', title: 'No migration evidence', why: 'The brief leads with it.', question: 'Have you led a platform migration?', refs: [] }],
    ...over,
  })
  const run = (replies: Array<object | 'junk'>, over: Partial<Parameters<typeof runReview>[1]> = {}, inp: Parameters<typeof runReview>[0] = { ...input(), validate: (m) => recheckMarkdown(m, snapshot).errors }) => {
    const s = scripted((t, sch) => extractJSON(t, sch as never), replies)
    mockJSON.mockImplementation(s.impl as never)
    return { s, result: runReview(inp, { profileId: 'p1', jobApplicationId: 'job-1', runId: 'run-1', deadline: Date.now() + 200_000, ...over }) }
  }
  const validating = (over: Partial<ReviewPromptInput> = {}) => ({ ...input(over), validate: (m: string) => recheckMarkdown(m, snapshot).errors })

  it('makes ONE call (role analysis, feature cv-gen-review, run attribution) and applies the checked edit and stores the concern', async () => {
    const { s, result } = run([answer()])
    const r = await result
    expect(s.calls).toHaveLength(1)
    expect(s.calls[0].opts).toMatchObject({
      role: 'analysis', feature: 'cv-gen-review', attribution: { jobApplicationId: 'job-1', runId: 'run-1' },
      temperature: expect.any(Number), maxOutputTokens: expect.any(Number), retryMaxOutputTokens: expect.any(Number),
    })
    expect(s.calls[0].opts).not.toHaveProperty('model')
    expect(String(s.calls[0].opts.system)).toContain('REVIEW INSTRUCTIONS')
    expect(String(s.calls[0].opts.system)).toContain('WRITING RULES')
    expect(r.review).toMatchObject({ skipped: false, skipReason: null, model: 'claude-sonnet-5-5', tokens: { input: 1000, output: 200 } })
    expect(r.review.applied).toHaveLength(1)
    expect(r.review.concerns).toMatchObject([{ kind: 'evidence_gap', title: 'No migration evidence' }])
    expect(r.assembled.markdown).toContain('- Led quarterly planning for the platform org.')
    expect(r.usage.calls).toBe(1)
  })

  it('one malformed edit among valid ones costs nothing: ONE call, the valid edit applied, a note says one was dropped', async () => {
    const { s, result } = run([answer({
      edits: [
        { target: { sectionId: U, bulletId: 'b2' }, action: 'rewrite', reason: 'bad action' },
        { target: { sectionId: U, bulletId: 'b2' }, action: 'replace', newText: 'Led quarterly planning for the platform org.', reason: 'tighter' },
      ],
    })])
    const r = await result
    expect(s.calls).toHaveLength(1)
    expect(r.review.applied).toHaveLength(1)
    expect(r.review.concerns).toHaveLength(1)
    expect(r.notes).toContain('1 edit in the answer could not be read and was dropped.')
  })

  it('a null bulletId (the profile edit) is accepted in the same single call', async () => {
    const { s, result } = run([answer({ edits: [{ target: { sectionId: 'profile', bulletId: null }, action: 'replace', newText: 'Delivery leader for platform organisations.', reason: 'voice' }] })])
    const r = await result
    expect(s.calls).toHaveLength(1)
    expect(r.review.applied).toMatchObject([{ sectionId: 'profile', bulletId: null }])
  })

  it('puts the writing-desk document in the attribution when the target is already known', async () => {
    const { s, result } = run([answer({ edits: [] })], { writingDeskDocumentId: 'doc-1' })
    await result
    expect(s.calls[0].opts.attribution).toEqual({ jobApplicationId: 'job-1', runId: 'run-1', writingDeskDocumentId: 'doc-1' })
  })

  it('discards an edit that fails the re-check, keeps the CV as it was, and still stores the concerns', async () => {
    const { result } = run([answer({ edits: [{ target: { sectionId: U, bulletId: 'b2' }, action: 'replace', newText: 'Ran planning that saved £2m.', reason: 'x' }] })])
    const r = await result
    expect(r.review.applied).toEqual([])
    expect(r.review.discarded).toHaveLength(1)
    expect(r.review.concerns).toHaveLength(1)
    expect(r.assembled.markdown).toBe(assembled().markdown)
  })

  it('stores at most 5 concerns', async () => {
    const concerns = Array.from({ length: 9 }, (_, n) => ({ kind: 'weak_proof', title: `T${n}`, why: 'w', question: 'q?', refs: [] }))
    const { result } = run([answer({ edits: [], concerns })])
    expect((await result).review.concerns).toHaveLength(5)
  })

  it('retries ONCE for an unusable answer (two calls at most), then succeeds', async () => {
    const { s, result } = run(['junk', answer({ edits: [] })])
    const r = await result
    expect(s.calls).toHaveLength(2)
    expect(r.review.skipped).toBe(false)
  })

  it('skips (never throws) when the answer is unusable twice: two calls, the CV unchanged, the reason and the spent tokens recorded', async () => {
    const { s, result } = run(['junk', 'junk'])
    const r = await result
    expect(s.calls).toHaveLength(2)
    expect(r.review).toMatchObject({ skipped: true, applied: [], concerns: [], tokens: { input: 2000, output: 400 } })
    expect(r.review.skipReason).toMatch(/could not be used.*landed unreviewed/)
    expect(r.assembled.markdown).toBe(assembled().markdown)
    expect(r.notes[0]).toMatch(/landed unreviewed/)
  })

  it('skips when the call times out, without failing', async () => {
    mockJSON.mockRejectedValue(new LLMError('The request timed out', 'timeout'))
    const r = await runReview(validating(), { profileId: 'p1', jobApplicationId: 'job-1', runId: 'run-1', deadline: Date.now() + 200_000 })
    expect(r.review.skipped).toBe(true)
    expect(r.review.skipReason).toMatch(/timed out.*landed unreviewed/)
    expect(r.assembled.markdown).toBe(assembled().markdown)
  })

  it('skips on any other error too', async () => {
    mockJSON.mockRejectedValue(new Error('db password is hunter2'))
    const r = await runReview(validating(), { profileId: 'p1', jobApplicationId: 'job-1', runId: 'run-1', deadline: Date.now() + 200_000 })
    expect(r.review.skipped).toBe(true)
    expect(JSON.stringify(r)).not.toContain('hunter2')
  })

  it('skips without calling the model when there is no time left', async () => {
    const { s, result } = run([answer()], { deadline: Date.now() + 1_000 })
    const r = await result
    expect(s.calls).toHaveLength(0)
    expect(r.review).toMatchObject({ skipped: true, skipReason: expect.stringMatching(/not enough time/) })
  })

  it('drops every edit when the edited CV does not validate, keeping the unreviewed one and the concerns', async () => {
    const { result } = run([answer()], {}, { ...input(), validate: () => ['broken block'] })
    const r = await result
    expect(r.review.applied).toEqual([])
    expect(r.review.discarded[0].why).toMatch(/did not validate \(broken block\)/)
    expect(r.review.concerns).toHaveLength(1)
    expect(r.assembled.markdown).toBe(assembled().markdown)
    expect(r.notes.join(' ')).toMatch(/none of the edits were applied/)
  })

  it('sends no contact details, name or whole profile to the model', async () => {
    const { s, result } = run([answer({ edits: [] })])
    await result
    const sent = `${s.calls[0].prompt}\n${String(s.calls[0].opts.system)}`
    expect(sent).not.toContain('Robin Placeholder')
    expect(sent).not.toContain('{{contact}}')
    expect(sent).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/)
  })
})


describe('independent project review regressions', () => {
  it('refuses to move an independent outcome into an employer even when its description differs', () => {
    const projects = independentProjectsFixture()
    const ev = evidenceFromVault(projects.vault, projects.selection)
    const claim = 'Eliminated manual reconciliation across regional offices'
    ev.independentProjects[0].atoms[0].impact = claim
    const doc = freshDoc()
    const changed = applyEdits(doc, [edit(U, 'b2', 'replace', claim + '.')], actx({ evidence: ev }))
    expect(changed.applied).toEqual([])
    expect(changed.discarded[0].why).toContain('attributes independent project evidence to this employer')
  })

  it('looks up actual project evidence by source ID and cites duplicate evidence text only once', () => {
    const { vault, selection } = independentProjectsFixture()
    const ev = evidenceFromVault(vault, selection)
    const p = ev.independentProjects[0]
    const rendered = renderIndependentProject(p)
    // The provenance's displayed text is deliberately different: it must never become its own evidence.
    const display = { ...rendered, bullets: rendered.bullets.map((b, i) => i === 0 ? { ...b, text: 'DISPLAY ONLY CLAIM' } : b) }
    const sections = [wsec(`projects:${p.id}`, 'projects', rendered.markdown, display)]
    const cv = { ...assembled(), sections }
    const { prompt, labels } = reviewPrompt(input({ assembled: cv, selection, evidence: ev }), reviewDoc(cv, selection, ev))
    const label = labels.find(l => l.id === 'workshop-atom')!
    expect(label.snippet).toContain(INDEPENDENT_RESULT)
    expect(label.snippet).not.toContain('DISPLAY ONLY CLAIM')
    expect(labels.some(l => l.id === 'workshop-duplicate')).toBe(false)
    expect(prompt).toContain('DISPLAY ONLY CLAIM')
  })
})
