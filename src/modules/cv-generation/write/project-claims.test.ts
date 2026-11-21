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
import { conflictingProjectEdition, namesProject, projectDisplayName, projectFigureNames, selectedProjectReflected } from './project-names'
import { unsupportedFigures } from './checks'
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

  it('omits a trailing descriptor while preserving names with a version, year, or phase', () => {
    const saved = 'Aurora Atlas v2.1 Press Event'
    const mention = (name: string) => `Coordinated the launch for ${name} at the museum.`
    expect(namesProject(mention('Aurora Atlas v2.1'), saved, ['Aurora Atlas v2.2 Press Event'])).toBe(true)
    expect(namesProject(mention('Aurora Atlas v2.1'), saved, ['Aurora Atlas v2.1 Campaign'])).toBe(false)
    expect(namesProject(mention(saved), saved, ['Aurora Atlas v2.1 Campaign'])).toBe(true)
    for (const different of ['Aurora Atlas', 'Aurora Atlas v2.2', 'Aurora Atlas v2.1.3', 'Aurora Atlas v2 1', 'Atlas Aurora v2.1', `${saved} Phase 3`]) {
      expect(namesProject(mention(different), saved, [])).toBe(false)
    }
    expect(conflictingProjectEdition(mention('Aurora Atlas v2.2'), saved, [])).toBe(true)
    for (const title of ['Aurora Atlas II', 'Aurora Atlas 2025', 'Aurora 17 Atlas', 'Aurora Atlas Phase 2']) {
      expect(namesProject(mention(title), `${title} Press Event`, [])).toBe(true)
      expect(namesProject(mention('Aurora Atlas'), `${title} Press Event`, [])).toBe(false)
    }
  })

  it('shares numeric short names in Write, Review and figure checks without appending a second name', async () => {
    const exhibition = { id: 'exhibition', name: 'Auróra 17 Atlas v2.1 Press Event' }
    const alias = 'Coordinated the museum launch for Aurora-17 Atlas v2.1.'
    const original = `Coordinated the museum launch for ${exhibition.name}.`
    const emp = { ...intake, activities: [activity('launch', original, { fromProject: exhibition })] }
    const { result, script } = write(emp, [{ text: alias, sources: ['E1'] }])
    const written = await result
    expect(written.bullets).toEqual([alias])
    expect(written.checkNotes).toEqual([])
    expect(script.calls).toHaveLength(1)
    const { replace } = review(emp, [{ text: original, source: 'E1' }])
    expect(replace('b1', alias).applied).toHaveLength(1)
    expect(replace('b1', alias.replace(/\.$/, ' across 17 galleries.')).discarded[0]?.why).toContain('figures not in the employer')
    const sibling = { ...emp, peerProjectNames: ['Aurora 17 Atlas v2.1 Campaign'] }
    expect(review(sibling, [{ text: original, source: 'E1' }]).replace('b1', alias).discarded).toHaveLength(1)
    expect(selectedProjectReflected(['Surveyed 17 galleries.'], { ...exhibition, text: alias }, [])).toBe(false)
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

describe('over-target employer claims', () => {
  const survey = 'Reworked the sampling plan with regional conservation teams across the reserve and trained the field crew on the updated equipment'
  const result = 'cutting review time from 9 days to 4 days in winter without changing the inspection protocol.'
  const qualitative = 'which kept the wetland open during winter migration without relocating the conservation volunteers.'
  const long = `${survey}, ${result}`
  const withoutImpact = `${survey}, ${qualitative}`

  it('preserves measured and qualitative results after a clause boundary with no extra call', async () => {
    const emp = { ...intake, activities: [activity('quantified', long), activity('qualitative', withoutImpact)] }
    const { result, script } = write(emp, [{ text: long, sources: ['E1'] }, { text: withoutImpact, sources: ['E2'] }])
    const written = await result
    expect(written.bullets).toEqual([long, withoutImpact])
    expect(written.provenance.map((b) => b.sources[0].id)).toEqual(['quantified', 'qualitative'])
    expect(written.notes.filter((n) => n.includes('over the 25-word target'))).toHaveLength(2)
    expect(script.calls).toHaveLength(1)
  })

  it('keeps the saved impact when the full model-free bullet exceeds the target', () => {
    const body = `For Fen Water Survey 2025, ${survey.charAt(0).toLowerCase()}${survey.slice(1)}`
    const emp = { ...intake, activities: [{ ...activity('fieldwork', body, { fromProject: project }), impact: result }] }
    const fallback = fallbackExperience(emp)
    expect(fallback.bullets).toEqual([`${body} — ${result}`])
    expect(fallback.provenance[0].sources.map((s) => s.id)).toEqual(['fieldwork'])
    expect(fallback.notes).toContainEqual(expect.stringContaining('over the 25-word target'))
  })

  it('retains the original when a Review replacement exceeds the strict word limit', () => {
    const emp = { ...intake, activities: [activity('quantified', long)] }
    const { replace } = review(emp, [{ text: long, source: 'E1' }])
    expect(replace('b1', long.replace('Reworked', 'Revised')).discarded[0]?.why).toContain('the limit is 25')
    const invented = withoutImpact.replace(qualitative, 'securing a promotion for the supervisor during the winter season.')
    expect(replace('b1', invented).discarded[0]?.why).toContain('the limit is 25')
  })

  it('allows a concise correction despite an unrelated negation in the source', () => {
    const source = 'Ran the winter survey without contractors. Trained the field crew on the new sampling equipment.'
    const emp = { ...intake, activities: [activity('survey', source)] }
    const { replace } = review(emp, [{ text: `${survey}, training no field crew on the new sampling equipment during the winter season.`, source: 'E1' }])
    expect(replace('b1', 'Trained the field crew on the new sampling equipment.').applied).toHaveLength(1)
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


describe('reviewed naming and repetition regressions', () => {
  it('does not let a saved acronym conceal an explicitly wrong year', () => {
    const wrong = 'Completed Fen Water Survey 2026 (FWS).'
    expect(namesProject(wrong, project.name, [])).toBe(false)
    expect(conflictingProjectEdition(wrong, project.name, [])).toBe(true)
    const { replace } = review(intake, [{ text: 'Completed Fen Water Survey 2025 (FWS).', source: 'E1' }, { text: ongoing, source: 'E2' }])
    expect(replace('b1', wrong).discarded).toHaveLength(1)
  })

  it('distinguishes a hyphenated edition from a following measurement', () => {
    expect(namesProject('Completed River Atlas-2.', 'River Atlas', [])).toBe(false)
    expect(conflictingProjectEdition('Completed River Atlas-2.', 'River Atlas', [])).toBe(true)
    expect(namesProject('Delivered Canal Survey 2 km upstream.', 'Canal Survey', [])).toBe(true)
    expect(conflictingProjectEdition('Delivered Canal Survey 2 km upstream.', 'Canal Survey', [])).toBe(false)
  })

  it('checks the cleaned Review replacement for duplicate claims', () => {
    const other = 'Trained volunteers to supervise ecology interns at the reserve'
    const emp = { ...intake, activities: [activity('training', ongoing + '. ' + other)] }
    const { replace } = review(emp, [{ text: ongoing, source: 'E1' }, { text: other, source: 'E1' }])
    expect(replace('b2', `**${ongoing}**`).discarded[0]?.why).toContain('repeats a claim')
  })

  it('does not remove identical wording backed by distinct source scopes', () => {
    const text = 'Surveyed tidal channels'
    const emp = { ...intake, activities: [activity('east', text + ' in the eastern reserve'), activity('west', text + ' in the western reserve')] }
    const { remove, doc } = review(emp, [{ text, source: 'E1' }, { text, source: 'E2' }])
    expect(remove('b2').discarded[0]?.why).toContain('distinct evidence')
    expect(doc.experience.get(sectionId)?.bullets.every((b) => !b.removed)).toBe(true)
  })
})


describe('short project alias boundaries', () => {
  it('does not hide quantities or cross clauses when the saved title contains a number', () => {
    const name = 'Aurora Atlas 17 Press Event'
    for (const text of ['Raised participation in Aurora Atlas: 17%.', 'Raised participation in Aurora Atlas 17 percent.']) {
      expect(namesProject(text, name, [])).toBe(false)
      expect(unsupportedFigures(text, [name], projectFigureNames(name, []))).not.toEqual([])
    }
    expect(namesProject('Delivered Aurora Atlas 17.', name, [])).toBe(true)
  })

  it('keeps acronyms with a medial Roman letter and requires actual edition qualifiers', () => {
    expect(namesProject('Coordinated VCOP with schools.', 'Vitamin C Outreach Programme (VCOP)', [])).toBe(true)
    expect(namesProject('Delivered Moonwave v2.', 'Moonwave v2 Press Event', [])).toBe(true)
    expect(namesProject('Delivered Aurora Atlas II.', 'Aurora Atlas III Press Event', [])).toBe(false)
  })

  it('does not turn an explicitly different project descriptor into the saved project', () => {
    expect(namesProject('Managed Aurora Atlas 17 Campaign.', 'Aurora Atlas 17 Press Event', [])).toBe(false)
    expect(namesProject('Managed Aurora Atlas Campaign.', 'Aurora Atlas Press Event', [])).toBe(false)
  })
})
