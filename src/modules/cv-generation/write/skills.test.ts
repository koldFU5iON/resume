import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/llm/complete-json', () => ({ completeJSON: vi.fn() }))
vi.mock('@/modules/llm/prompt-context', () => ({ composeSystem: (...p: Array<string | null>) => p.filter(Boolean).join('\n\n---\n\n') }))

import { completeJSON } from '@/modules/llm/complete-json'
import { extractJSON } from '@/modules/llm/extract-json'
import { scripted, writeSelection, writeVault } from '../__fixtures__/write'
import { buildBriefFor } from '../__fixtures__/gathered'
import { evidenceFromVault, type CapabilityEvidence } from './evidence'
import { codeOrder, skillsPrompt, validateGroups, writeSkills } from './skills'
import { requirementText } from './prompt'
import type { WriteContext } from './types'

const mockJSON = vi.mocked(completeJSON)
const cap = (name: string, claimed = false): CapabilityEvidence => ({ id: name, name, category: null, level: null, claimed })
const vault = writeVault()
const evidence = evidenceFromVault(vault, writeSelection(vault))
const strategy = { mustHave: ['Delivery'], niceToHave: [] as string[] }
const ctx = (over: Partial<WriteContext> = {}): WriteContext => ({
  profileId: 'p1', jobApplicationId: 'job-1', runId: 'run-1', deadline: Date.now() + 200_000,
  brief: buildBriefFor(), strategy, evidence, requirementText: requirementText(strategy), ...over,
})
const instructions = { rules: 'RULES', brief: null, prompt: 'INSTRUCTIONS' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('validateGroups (the output may only be a subset of the selected names)', () => {
  const selected = ['Planning', 'Governance', 'Roadmapping', 'Budgeting', 'Hiring', 'Forecasting'].map((n) => cap(n))

  it('drops unknown names and repeats, and maps case to the selected spelling', () => {
    const groups = validateGroups([{ label: 'Delivery', names: ['planning', 'Invented skill', 'Governance', 'Planning', 'Hiring'] }, { label: 'Money', names: ['BUDGETING', 'forecasting'] }], selected)
    expect(groups).toEqual([
      { label: 'Delivery', names: ['Planning', 'Governance', 'Hiring'] },
      { label: 'Money', names: ['Budgeting', 'Forecasting', 'Roadmapping'] }, // the name the model left out is put back at the end
    ])
    const all = groups!.flatMap((g) => g.names)
    expect(all.every((n) => selected.some((s) => s.name === n))).toBe(true)
    expect(new Set(all).size).toBe(all.length)
  })

  it('returns null when nothing usable remains (junk)', () => {
    expect(validateGroups([{ label: 'x', names: ['Nope', 'Also nope'] }], selected)).toBeNull()
    expect(validateGroups([], selected)).toBeNull()
  })

  it('merges groups beyond three into the last one, and drops a label that is too long', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const groups = validateGroups(
      [{ label: 'G0', names: ['a', 'b'] }, { label: 'a label that is far too long to use', names: ['c', 'd'] }, { label: 'G2', names: ['e', 'f'] }, { label: 'G3', names: ['g', 'h'] }],
      names.map((n) => cap(n)),
    )
    expect(groups).toHaveLength(3)
    expect(groups![2].names).toEqual(['e', 'f', 'g', 'h'])
    expect(groups![1].label).toBeNull()
  })

  it('gives a single group no label', () => {
    expect(validateGroups([{ label: 'Everything', names: ['Planning'] }], selected)).toEqual([{ label: null, names: ['Planning', 'Governance', 'Roadmapping', 'Budgeting', 'Hiring', 'Forecasting'] }])
  })

  it('never groups a list of fewer than 6 names: 4 tools in three groups come back as one ungrouped list', () => {
    const tools = ['Brandfolder', 'Workato', 'Jira', 'Figma'].map((n) => cap(n))
    const groups = validateGroups([{ label: 'Asset management', names: ['Brandfolder'] }, { label: 'Automation', names: ['Workato', 'Jira'] }, { label: 'Design', names: ['Figma'] }], tools)
    expect(groups).toEqual([{ label: null, names: ['Brandfolder', 'Workato', 'Jira', 'Figma'] }])
  })

  it('never emits a group of one name: it is merged into the previous group (the first into the next)', () => {
    const eight = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) => cap(n))
    expect(validateGroups([{ label: 'One', names: ['a', 'b', 'c', 'd', 'e'] }, { label: 'Two', names: ['f'] }, { label: 'Three', names: ['g', 'h'] }], eight)).toEqual([
      { label: 'One', names: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { label: 'Three', names: ['g', 'h'] },
    ])
    expect(validateGroups([{ label: 'Solo', names: ['a'] }, { label: 'Rest', names: ['b', 'c', 'd', 'e', 'f', 'g', 'h'] }], eight)).toEqual([{ label: null, names: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }])
  })

  it('keeps groups of 2-3 when a list has 8-10 names', () => {
    const ten = Array.from({ length: 10 }, (_, i) => cap(`s${i}`))
    const groups = validateGroups([{ label: 'A', names: ['s0', 's1', 's2'] }, { label: 'B', names: ['s3', 's4', 's5'] }, { label: 'C', names: ['s6', 's7', 's8', 's9'] }], ten)
    expect(groups!.map((g) => g.names.length)).toEqual([3, 3, 4])
  })
})

describe('codeOrder', () => {
  it('puts evidence-backed names first, then keeps the selection order', () => {
    expect(codeOrder([cap('Tableau', true), cap('Jira'), cap('SQL')])).toEqual([{ label: null, names: ['Jira', 'SQL', 'Tableau'] }])
    expect(codeOrder([])).toEqual([])
  })
})

describe('writeSkills', () => {
  const six = ['Release management', 'Stakeholder management', 'Roadmapping', 'Risk management', 'Budgeting', 'Dependency mapping']

  it('groups the selected names with ONE call on the fast role, and builds the skills and inline-list blocks in code', async () => {
    const s = scripted((t, sch) => extractJSON(t, sch as never), [{
      skills: [{ label: 'Delivery', names: ['Release management', 'Roadmapping', 'Dependency mapping'] }, { label: 'Governance', names: ['Stakeholder management', 'Risk management', 'Budgeting'] }],
      tools: [{ label: '', names: ['Tableau', 'Jira'] }],
    }])
    mockJSON.mockImplementation(s.impl as never)
    const r = await writeSkills(ctx(), instructions)
    expect(s.calls).toHaveLength(1)
    expect(s.calls[0].opts).toMatchObject({ role: 'fast', feature: 'cv-gen-write-skills', attribution: { jobApplicationId: 'job-1', runId: 'run-1' } })
    expect(r.skillsMarkdown).toBe('**Delivery**\n\n:::skills\n- Release management\n- Roadmapping\n- Dependency mapping\n:::\n\n**Governance**\n\n:::skills\n- Stakeholder management\n- Risk management\n- Budgeting\n:::')
    expect(r.toolsMarkdown).toBe(':::inline-list\n- Tableau\n- Jira\n:::') // the claimed tool is allowed in the Tools list
    expect(r.model).toBe('claude-sonnet-5-5')
  })

  it('never lets an unknown name through: the output is a subset of the selected names', async () => {
    const s = scripted((t, sch) => extractJSON(t, sch as never), [{ skills: [{ label: 'X', names: [...six, 'Quantum computing'] }], tools: [{ label: '', names: ['Jira', 'Tableau', 'Kubernetes'] }] }])
    mockJSON.mockImplementation(s.impl as never)
    const r = await writeSkills(ctx(), instructions)
    expect(r.skillsMarkdown).not.toContain('Quantum')
    expect(r.toolsMarkdown).not.toContain('Kubernetes')
  })

  it('falls back to code ordering, without failing, when the call throws', async () => {
    mockJSON.mockRejectedValue(Object.assign(new Error('x'), { kind: 'timeout' }))
    const r = await writeSkills(ctx(), instructions)
    expect(r.model).toBeNull()
    expect(r.notes[0]).toMatch(/call failed \(timeout\).*ordered by code/)
    expect(r.skillsMarkdown).toContain('- Release management')
    expect(r.toolsMarkdown).toBe(':::inline-list\n- Jira\n- Tableau\n:::') // proven first, claimed last
  })

  it('falls back to code ordering when the answer names none of the selected names', async () => {
    const s = scripted((t, sch) => extractJSON(t, sch as never), [{ skills: [{ label: '', names: ['Nope'] }], tools: [{ label: '', names: ['Nope'] }] }])
    mockJSON.mockImplementation(s.impl as never)
    const r = await writeSkills(ctx(), instructions)
    expect(r.notes.join(' ')).toMatch(/named none of the selected skills/)
    expect(r.skillsMarkdown).toContain('- Release management')
    expect(s.calls).toHaveLength(1)
  })

  it('makes no call when there is too little to group', async () => {
    const few = { ...evidence, skills: evidence.skills.slice(0, 2), tools: evidence.tools.slice(0, 1) }
    const r = await writeSkills(ctx({ evidence: few }), instructions)
    expect(mockJSON).not.toHaveBeenCalled()
    expect(r.model).toBeNull()
    expect(r.skillsMarkdown).toBe(':::skills\n- Release management\n- Stakeholder management\n:::')
    expect(r.notes[0]).toMatch(/No model call/)
  })

  it('makes no call and writes nothing when nothing was selected', async () => {
    const r = await writeSkills(ctx({ evidence: { ...evidence, skills: [], tools: [] } }), instructions)
    expect(mockJSON).not.toHaveBeenCalled()
    expect(r.skillsMarkdown + r.toolsMarkdown).toBe('')
  })

  it('records the tokens of the calls that answered when the grouping fails (a stage row must not show 0)', async () => {
    const s = scripted((t, sch) => extractJSON(t, sch as never), ['junk', 'junk'])
    mockJSON.mockImplementation(s.impl as never)
    const r = await writeSkills(ctx(), instructions)
    expect(s.calls).toHaveLength(2)
    expect(r.model).toBeNull()
    expect(r.usage).toMatchObject({ input: 2000, output: 400, calls: 2 })
    expect(r.usage.costUsd).toBeGreaterThan(0)
    expect(r.notes[0]).toMatch(/invalid_output/)
  })

  it('cleans group labels: markup, links and ":::" never reach the skills blocks', async () => {
    const s = scripted((t, sch) => extractJSON(t, sch as never), [{
      skills: [{ label: '## **Delivery** ::: [x](http://evil.test)', names: ['Release management', 'Roadmapping', 'Dependency mapping'] }, { label: '<b>Governance</b>', names: ['Stakeholder management', 'Risk management', 'Budgeting'] }],
      tools: [],
    }])
    mockJSON.mockImplementation(s.impl as never)
    const r = await writeSkills(ctx(), instructions)
    expect(r.skillsMarkdown).toContain('**Delivery x**\n\n:::skills')
    expect(r.skillsMarkdown).toContain('**Governance**\n\n:::skills')
    expect(r.skillsMarkdown).not.toMatch(/http|<b>|##/)
  })

  it('makes no call when there is not enough time left, and orders by code', async () => {
    const r = await writeSkills(ctx({ deadline: Date.now() + 1_000 }), instructions)
    expect(mockJSON).not.toHaveBeenCalled()
    expect(r.notes[0]).toMatch(/Not enough time/)
    expect(r.skillsMarkdown).toContain('- Release management')
  })

  it('shows claimed names in the prompt like any other (they are allowed in these lists)', () => {
    expect(skillsPrompt(ctx(), evidence.skills, evidence.tools)).toContain('- Tableau')
  })

  it('gives the model no block syntax (code builds the blocks) and asks for plain labels', () => {
    const p = skillsPrompt(ctx(), evidence.skills, evidence.tools)
    expect(p).not.toContain(':::skills')
    expect(p).not.toContain('inline-list')
    expect(p).toMatch(/plain text/)
  })
})
