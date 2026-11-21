import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/modules/llm/complete-json', () => ({ completeJSON: vi.fn() }))
vi.mock('@/modules/llm/prompt-context', () => ({ composeSystem: (...parts: string[]) => parts.join('\n') }))

import { completeJSON } from '@/modules/llm/complete-json'
import { extractJSON } from '@/modules/llm/extract-json'
import { buildBriefFor } from '../__fixtures__/gathered'
import { scripted } from '../__fixtures__/write'
import { SelectedEmployerSchema, type CvAssembled } from '../schema'
import type { Evidence, EmployerEvidence } from './evidence'
import { experiencePrompt, fallbackExperience, writeExperience, type ExperienceOutput } from './experience'
import { conflictingProjectEdition, namesProject, projectDisplayName } from './project-names'
import { evidenceRefs, toProvenance } from './provenance'
import { renderEmployerEntry } from './render'
import { applyEdits, reviewDoc, reviewPrompt, type ApplyContext } from './review'

const project = { id: 'wetland', name: '3. Fen Water Survey 2025 (FWS)' }
const later = 'Fen Water Survey 2026'
const claim = 'Surveyed tidal channels from the eastern boundary to the reserve entrance'
const ongoing = 'Trained conservation volunteers to supervise ecology interns'
const sectionId = 'experience:bramble-estuary'

const employer = SelectedEmployerSchema.parse({
  key: 'bramble-estuary', company: 'Bramble Estuary Trust', latestTitle: 'Restoration Ecologist',
  start: '2021-01-01', end: '2025-09-30',
})
const activity = (id: string, text: string, options: Pick<EmployerEvidence['activities'][number], 'fromProject'> = {}) =>
  ({ id, text, experienceId: 'restoration', kind: 'achievement' as const, impact: null, highlighted: false, ...options })
const intake: EmployerEvidence = {
  employer, missing: 0,
  activities: [activity('survey', claim, { fromProject: project }), activity('training', ongoing)],
  projects: [],
}
const ctx = (emp: EmployerEvidence): ApplyContext => {
  const evidence: Evidence = {
    employers: [emp], independentProjects: [], skills: [], tools: [], competencies: [], certifications: [], education: [], languages: [],
    profileTitles: [employer.latestTitle], profileCompanies: [employer.company], claimedNames: [],
    unroutedProjects: [], unresolved: [], credentials: [],
  }
  return { brief: buildBriefFor(), strategy: { mustHave: [], niceToHave: [] }, evidence }
}
const write = (emp: EmployerEvidence, bullets: ExperienceOutput['bullets']) => {
  const response = { summary: '', bullets }
  const script = scripted((s, schema) => extractJSON(s, schema as never), [response, response])
  vi.mocked(completeJSON).mockImplementation(script.impl as never)
  const input = { ...ctx(emp), profileId: 'test', jobApplicationId: 'job', runId: 'run', deadline: Date.now() + 10_000, requirementText: '' }
  return { script, result: writeExperience(input, emp, { rules: '', brief: null, prompt: '' }) }
}

const review = (emp: EmployerEvidence, input: Array<{ text: string; source: string }>) => {
  const refs = evidenceRefs(emp)
  const bullets = input.map(({ text, source }) => toProvenance(text, refs.filter((r) => r.label === source)))
  const markdown = renderEmployerEntry(emp.employer, '', bullets.map((b) => b.text))
  const assembled: CvAssembled = {
    markdown, warnings: [], checkNotes: [],
    sections: [{ id: sectionId, kind: 'experience', employerKey: employer.key, markdown, bullets }],
  }
  const selection = { employers: [employer], uncovered: [] }
  const context = ctx(emp)
  const doc = reviewDoc(assembled, selection, context.evidence)
  const prompt = reviewPrompt({ ...context, assembled, selection }, doc).prompt
  const replace = (bulletId: string, newText: string) =>
    applyEdits(doc, [{ target: { sectionId, bulletId }, newText, reason: 'clarity', action: 'replace' }], context)
  const remove = (bulletId: string) =>
    applyEdits(doc, [{ target: { sectionId, bulletId }, reason: 'repeats another bullet', action: 'remove', newText: undefined }], context)
  return { doc, prompt, replace, remove }
}

afterEach(() => vi.clearAllMocks())

describe('experience project names', () => {
  it('removes only list numbering and recognizes the full expansion or unambiguous shortened name', () => {
    expect(projectDisplayName(project.name)).toBe('Fen Water Survey 2025 (FWS)')
    expect(projectDisplayName('2) 3D Imaging Phase 2')).toBe('3D Imaging Phase 2')
    expect(projectDisplayName('2025. Fen Water Survey')).toBe('2025. Fen Water Survey')
    for (const mention of ['Fen Water Survey 2025: 40 sites audited', 'Contributed to Fen Water Survey.', 'FWS: completed the fieldwork']) {
      expect(namesProject(mention, project.name, [])).toBe(true)
    }
    for (const mention of ['Worked on the project', 'Worked on the Survey', 'Finished fieldwork for FWS2']) {
      expect(namesProject(mention, project.name, [])).toBe(false)
    }
    expect(namesProject('Revised the water sampling protocol.', 'Water', [])).toBe(false)
    expect(namesProject('Revised the water sampling protocol.', 'water', [])).toBe(false)
    expect(namesProject('Water sampling became safer.', 'Water', [])).toBe(false)
    expect(namesProject('Water: revised the sampling protocol.', 'Water', [])).toBe(true)
    expect(namesProject('Helped deliver the Reed Calibration Campaign.', 'Reed Calibration Launch Campaign', ['Reed Calibration Campaign'])).toBe(false)
    expect(namesProject('Helped deliver the Reed Calibration.', 'Reed Calibration Launch Campaign', [])).toBe(true)
  })

  it.each([
    ['Fen Water Survey 2025', 'Fen Water Survey (2026)'],
    ['Borehole Mapping Phase 2', 'Borehole Mapping Phase 3'],
    ['River Atlas II', 'River Atlas III'],
    ['Sediment Imaging v2.1', 'Sediment Imaging v2.2'],
    ['3D Imaging', '3D Imaging 2'],
  ])('distinguishes %s and %s', (saved, different) => {
    expect(namesProject(`Completed ${different} on schedule.`, saved, [])).toBe(false)
    expect(conflictingProjectEdition(`Completed ${different} on schedule.`, saved, [])).toBe(true)
  })

  it('does not infer an edition when a peer uses the same shorter name', () => {
    expect(namesProject('Worked on Fen Water Survey.', project.name, [later])).toBe(false)
    expect(namesProject('Worked on Fen Water Survey 2025.', project.name, [later])).toBe(true)
    expect(namesProject('Worked on Fen Water Survey 2025.', later, [project.name])).toBe(false)
  })

  it('uses the same cleaned name and alias in the writer, fallback and Review', async () => {
    const alias = 'Surveyed tidal channels for Fen Water Survey in the reserve.'
    const provided = [{ text: alias, sources: ['E1'] }, { text: ongoing, sources: ['E2'] }]
    const { result, script } = write(intake, provided)
    expect((await result).bullets).toEqual([alias, ongoing])
    expect(script.calls).toHaveLength(1)
    expect(experiencePrompt(ctx(intake), intake)).toContain('E1: Fen Water Survey 2025 (FWS)')
    const fallback = fallbackExperience(intake)
    expect(fallback.bullets[0]).toBe(`${claim} (Fen Water Survey 2025 (FWS))`)
    const { replace, prompt } = review(intake, [{ text: fallback.bullets[0], source: 'E1' }, { text: ongoing, source: 'E2' }])
    expect(prompt).toContain('Recorded project “Fen Water Survey 2025 (FWS)”')
    expect(replace('b1', 'Surveyed tidal channels for Fen Water Survey 2025.').applied).toHaveLength(1)
    expect(replace('b1', alias).applied).toHaveLength(1)
  })

  it('protects a standalone selected project when an unselected sibling makes its year meaningful', async () => {
    const selected: EmployerEvidence = {
      ...intake, activities: [activity('training', ongoing)],
      projects: [{ ...project, text: claim, thin: false }], peerProjectNames: [later],
    }
    const original = 'Surveyed tidal channels for Fen Water Survey 2025.'
    const ambiguous = 'Surveyed tidal channels for Fen Water Survey.'
    const wrong = 'Surveyed tidal channels for Fen Water Survey 2026.'
    const { replace } = review(selected, [{ text: original, source: 'P1' }, { text: ongoing, source: 'E1' }])
    expect(replace('b1', wrong).discarded).toHaveLength(1)
    expect(replace('b1', ambiguous).discarded).toHaveLength(1)
    const { result } = write({ ...intake, peerProjectNames: [later] }, [
      { text: ambiguous, sources: ['E1'] }, { text: ongoing, sources: ['E2'] },
    ])
    expect((await result).bullets[0]).toContain('(Fen Water Survey 2025 (FWS))')
  })
})

describe('repeated claims within one employer', () => {
  it('collapses a project and activity duplicate, keeps the named project and both source IDs, and uses no extra call', async () => {
    const text = 'Restored Fen Water Survey sampling stations along the eastern boundary of the protected wetland before the annual field season'
    const emp: EmployerEvidence = {
      ...intake,
      activities: [activity('stations', text, { fromProject: project }), activity('training', ongoing)],
      projects: [{ ...project, text, thin: false }],
    }
    const { result, script } = write(emp, [{ text, sources: ['P1'] }, { text: text + '.', sources: ['E1'] }, { text: ongoing, sources: ['E2'] }])
    const written = await result
    expect(script.calls).toHaveLength(1)
    expect(written.bullets).toEqual([text, ongoing])
    expect(written.provenance[0].sources.map((s) => s.id)).toEqual(['wetland', 'stations'])
    expect(written.notes.join('\n')).toContain('Removed a repeated bullet')
  })

  it('accounts for exact copies before enforcing the allowance, without retrying', async () => {
    const named = `Fen Water Survey: ${claim}`
    const { result, script } = write(intake, [{ text: named, sources: ['E1'] }, { text: named + '.', sources: ['E1'] }, { text: ongoing, sources: ['E2'] }])
    expect((await result).bullets).toEqual([named, ongoing])
    expect(script.calls).toHaveLength(1)
  })

  it('uses the same safe duplicate rule in the model-free fallback and protects distinct source claims', () => {
    const duplicate = activity('another-survey', claim + '.', { fromProject: project })
    const separate = activity('new-period', claim + ' during winter migration', { fromProject: project })
    const result = fallbackExperience({ ...intake, activities: [...intake.activities, duplicate, separate] })
    expect(result.bullets).toHaveLength(3)
    expect(result.provenance[0].sources.map((s) => s.id)).toEqual(['survey', 'another-survey'])
    expect(result.bullets[2]).toContain('during winter migration')
    expect(result.notes.join('\n')).toContain('Removed a repeated bullet')
  })

  it('retains separate mechanisms, measures, periods, negations and who supervised whom', async () => {
    const facts = [
      ongoing,
      'Trained ecology interns to supervise conservation volunteers',
      'Reduced nitrate concentration by 30% with riparian planting in spring',
      'Reduced nitrate concentration by 30% with riparian planting in winter',
      'Reduced nitrate concentration by 30% through diversion controls in spring',
      'Reduced sampling delays by 30 days through diversion controls in spring',
      'Reduced nitrate concentration by 30% without riparian planting in spring',
    ]
    const emp: EmployerEvidence = {
      ...intake, projects: [{ ...project, text: facts.join('. '), thin: false }],
      activities: facts.slice(1).map((text, i) => activity(`fact-${i}`, text)),
    }
    const bullets = facts.map((text, i) => ({ text: `${text} for Fen Water Survey.`, sources: ['P1', ...(i ? [`E${i}`] : [])] }))
    const { result } = write(emp, bullets)
    const written = await result
    expect(written.bullets).toEqual(bullets.map((b) => b.text))
    expect(written.notes.join('\n')).not.toContain('Removed a repeated bullet')
    expect(written.notes.join('\n')).toContain('may repeat a claim')
  })

  it('keeps identical displayed wording when disjoint resolved evidence has distinct scope', async () => {
    const briefText = 'Surveyed tidal channels'
    const emp = { ...intake, activities: [activity('east', `${briefText} in the eastern reserve`), activity('west', `${briefText} in the western reserve`)] }
    const { result } = write(emp, [{ text: briefText, sources: ['E1'] }, { text: briefText, sources: ['E2'] }])
    expect((await result).provenance.map((b) => b.sources[0].id)).toEqual(['east', 'west'])
  })

  it('keeps the sources of a pre-existing exact duplicate removed by Review', () => {
    const emp = { ...intake, activities: [activity('training', ongoing), activity('training-copy', ongoing + '.')] }
    const { doc, remove } = review(emp, [{ text: ongoing, source: 'E1' }, { text: ongoing + '.', source: 'E2' }])
    expect(remove('b2').applied[0].note).toContain('citations')
    expect(doc.experience.get(sectionId)?.bullets[0].sources.map((s) => s.id)).toEqual(['training', 'training-copy'])
  })

  it('allows Review to clarify a distinct measure that already shares a figure', () => {
    const field = 'Reduced survey processing time by 30% through automated checks.'
    const lab = 'Reduced nitrate concentration by 30% through diversion controls.'
    const { replace } = review({ ...intake, activities: [activity('field', field), activity('lab', lab)] }, [
      { text: field, source: 'E1' }, { text: lab, source: 'E2' },
    ])
    expect(replace('b2', 'Cut nitrate concentration by 30% through diversion controls.').applied).toHaveLength(1)
  })

  it('flags possible repeats for Review and rejects an edit that would bring back an exact repeat', () => {
    const emp = { ...intake, activities: [activity('training', ongoing + '. Trained volunteers to supervise ecology interns at the reserve.')] }
    const { replace, prompt } = review(emp, [
      { text: ongoing, source: 'E1' },
      { text: 'Trained volunteers to supervise ecology interns at the reserve.', source: 'E1' },
    ])
    expect(prompt).toContain('possible repeats: b1/b2')
    expect(replace('b2', ongoing + '.').discarded[0].why).toContain('repeats a claim')
  })
})
