import { describe, expect, it } from 'vitest'
import { FOLD_LEAD_IN, foldIntoOverview, formatReport, isNearDuplicate, planBackfill, type BackfillInput } from './model-backfill'

const exp = (id: string, summary = '', type = 'employment') => ({ id, company: `Co ${id}`, role: `Role ${id}`, type, summary, revision: 1 })
const proj = (id: string, experienceId: string | null, notes = '') => ({ id, name: `Project ${id}`, experienceId, notes, revision: 1 })
let n = 0
const act = (over: Partial<BackfillInput['activities'][number]>) => ({
  id: `a${++n}`, kind: 'achievement', description: `did thing ${n}`, experienceId: null, projectId: null, ...over,
})

describe('foldIntoOverview', () => {
  it('adds a new Overview section at the end when there is none, without touching the rest', () => {
    const { addition, after } = foldIntoOverview('## Achievements\n- shipped x', ['ran weekly reporting'])
    expect(addition).toBe(`## Overview\n\n${FOLD_LEAD_IN}\n- ran weekly reporting`)
    expect(after).toBe(`## Achievements\n- shipped x\n\n${addition}\n`)
  })
  it('appends to the end of an existing Overview section, before the next heading', () => {
    const { after } = foldIntoOverview('## Overview\nLed the team.\n\n## Achievements\n- shipped x', ['ran weekly reporting'])
    expect(after).toBe(`## Overview\nLed the team.\n\n${FOLD_LEAD_IN}\n- ran weekly reporting\n\n## Achievements\n- shipped x`)
  })
  it('handles an Overview that is the last section, and an empty note', () => {
    expect(foldIntoOverview('## Overview\nLed the team.', ['a']).after).toBe(`## Overview\nLed the team.\n\n${FOLD_LEAD_IN}\n- a`)
    expect(foldIntoOverview('', ['a']).after).toBe(`## Overview\n\n${FOLD_LEAD_IN}\n- a\n`)
  })
  it('keeps a multi-line description as one bullet, so a line starting with # is never a heading', () => {
    const { after } = foldIntoOverview('## Overview\nLed it.\n\n## Skills\n- x', ['First line\n# not a heading'])
    expect(after).toBe(`## Overview\nLed it.\n\n${FOLD_LEAD_IN}\n- First line\n  # not a heading\n\n## Skills\n- x`)
  })
  it('reads a CRLF note and writes plain newlines', () => {
    const { after } = foldIntoOverview('## Overview\r\nLed it.\r\n\r\n## Skills\r\n- x', ['Duty'])
    expect(after).toBe(`## Overview\nLed it.\n\n${FOLD_LEAD_IN}\n- Duty\n\n## Skills\n- x`)
  })
  it('keeps wording exactly', () => {
    expect(foldIntoOverview('', ['Managed  the   Q3 plan, "carefully".']).after).toContain('- Managed  the   Q3 plan, "carefully".')
  })
})

describe('planBackfill', () => {
  it('reports projects with no role, including a dangling role id', () => {
    const r = planBackfill({
      experiences: [exp('e1')],
      projects: [proj('p1', null), proj('p2', 'gone'), proj('p3', 'e1')],
      activities: [act({ projectId: 'p1' }), act({ projectId: 'p1' })],
    })
    expect(r.projectsWithoutRole).toEqual([
      { id: 'p1', name: 'Project p1', activityCount: 2, activitiesWithRole: 0 },
      { id: 'p2', name: 'Project p2', activityCount: 0, activitiesWithRole: 0 },
    ])
  })

  it('warns when activities of a role-less project already have a role of their own', () => {
    const r = planBackfill({
      experiences: [exp('e1')], projects: [proj('p1', null)],
      activities: [act({ experienceId: 'e1', projectId: 'p1' }), act({ projectId: 'p1' })],
    })
    expect(r.projectsWithoutRole[0]).toMatchObject({ activityCount: 2, activitiesWithRole: 1 })
    expect(formatReport(r)).toContain('1 already have a role of their own')
  })

  it('assigns a project-only activity to the project role, and leaves role-owned ones alone', () => {
    const owned = act({ experienceId: 'e1' })
    const viaProject = act({ projectId: 'p1' })
    const both = act({ experienceId: 'e1', projectId: 'p1' })
    const r = planBackfill({ experiences: [exp('e1')], projects: [proj('p1', 'e1')], activities: [owned, viaProject, both] })
    expect(r.activitiesToAssign.map((a) => a.id)).toEqual([viaProject.id])
    expect(r.activitiesToAssign[0]).toMatchObject({ experienceId: 'e1', projectName: 'Project p1', company: 'Co e1' })
    expect(r.activitiesUnresolved).toEqual([])
    expect(r.activitiesMismatched).toEqual([])
  })

  it('flags activities with no usable owner', () => {
    const orphan = act({})
    const noRoleProject = act({ projectId: 'p1' })
    const missingProject = act({ projectId: 'nope' })
    const r = planBackfill({ experiences: [exp('e1')], projects: [proj('p1', null)], activities: [orphan, noRoleProject, missingProject] })
    expect(r.activitiesUnresolved.map((a) => [a.id, a.reason])).toEqual([
      [orphan.id, 'no_owner'], [noRoleProject.id, 'project_without_role'], [missingProject.id, 'no_owner'],
    ])
  })

  it('flags a role that disagrees with the project role, without choosing', () => {
    const a = act({ experienceId: 'e1', projectId: 'p1' })
    const r = planBackfill({ experiences: [exp('e1'), exp('e2')], projects: [proj('p1', 'e2')], activities: [a] })
    expect(r.activitiesMismatched).toEqual([
      { id: a.id, description: a.description, experienceId: 'e1', projectId: 'p1', projectName: 'Project p1', projectExperienceId: 'e2' },
    ])
  })

  describe('responsibility fold', () => {
    const resp = (over: Partial<BackfillInput['activities'][number]>) => act({ kind: 'responsibility', ...over })

    it('folds a role\'s own responsibilities into the role, and a project-only one into the project note', () => {
      const r = planBackfill({
        experiences: [exp('e1', '## Achievements\n- shipped x')],
        projects: [proj('p1', 'e1', '## Overview\nThe launch.')],
        activities: [resp({ experienceId: 'e1', description: 'Ran weekly reporting' }), resp({ projectId: 'p1', description: 'Owned the calendar' })],
      })
      expect(r.folds).toHaveLength(1)
      expect(r.folds[0].responsibilities).toEqual(['Ran weekly reporting'])
      expect(r.folds[0].after).toContain(`${FOLD_LEAD_IN}\n- Ran weekly reporting`)
      expect(r.folds[0].after).not.toContain('Owned the calendar')
      expect(r.projectFolds).toHaveLength(1)
      expect(r.projectFolds[0]).toMatchObject({ projectId: 'p1', responsibilities: ['Owned the calendar'], placement: 'existing_overview', before: '## Overview\nThe launch.' })
      expect(r.projectFolds[0].after).toBe(`## Overview\nThe launch.\n\n${FOLD_LEAD_IN}\n- Owned the calendar`)
      expect(formatReport(r)).toContain('project "Project p1": added to the end of its existing ## Overview')
    })
    it('a responsibility with both a role and a project belongs to the role, not the project note', () => {
      const r = planBackfill({
        experiences: [exp('e1')], projects: [proj('p1', 'e1')],
        activities: [resp({ experienceId: 'e1', projectId: 'p1', description: 'Owned the calendar' })],
      })
      expect(r.folds[0].responsibilities).toEqual(['Owned the calendar'])
      expect(r.projectFolds).toEqual([])
    })
    it('checks project responsibilities against the project achievements only, and is idempotent', () => {
      const long = 'Developed the concept for a European media tour bringing the game to journalists via two custom chests'
      const r = planBackfill({
        experiences: [exp('e1')], projects: [proj('p1', 'e1'), proj('p2', 'e1')],
        activities: [act({ projectId: 'p1', description: long + ', each holding four consoles' }), resp({ projectId: 'p1', description: long }), resp({ projectId: 'p2', description: long })],
      })
      expect(r.nearDuplicates).toMatchObject([{ projectId: 'p1', owner: 'project "Project p1"', responsibility: long }])
      expect(r.projectFolds.map((f) => f.projectId)).toEqual(['p2'])
      const again = planBackfill({
        experiences: [exp('e1')], projects: [proj('p1', 'e1'), { ...proj('p2', 'e1'), notes: r.projectFolds[0].after }],
        activities: [resp({ projectId: 'p2', description: long })],
      })
      expect(again.projectFolds).toEqual([])
    })
    it('skips wording already in the Overview, repeats, blanks and achievements', () => {
      const r = planBackfill({
        experiences: [exp('e1', '## Overview\n- Ran weekly reporting.\n\n## Achievements\n- Cut cost 30%')],
        projects: [],
        activities: [
          resp({ experienceId: 'e1', description: 'ran  weekly reporting' }),
          resp({ experienceId: 'e1', description: 'Budget owner' }),
          resp({ experienceId: 'e1', description: 'budget owner' }),
          resp({ experienceId: 'e1', description: '   ' }),
          act({ experienceId: 'e1', description: 'Cut cost 30%' }),
        ],
      })
      expect(r.folds[0].responsibilities).toEqual(['Budget owner'])
      expect(r.folds[0].alreadyInNote).toEqual(['ran  weekly reporting'])
      expect(r.folds[0].placement).toBe('existing_overview')
    })
    it('still folds text that sits only under a Responsibilities heading', () => {
      const note = '## Responsibilities\n- Ran weekly reporting'
      const r = planBackfill({ experiences: [exp('e1', note)], projects: [], activities: [resp({ experienceId: 'e1', description: 'Ran weekly reporting' })] })
      expect(r.folds[0].responsibilities).toEqual(['Ran weekly reporting'])
      expect(r.folds[0].placement).toBe('new_section')
      expect(r.folds[0].before).toBe(note)
    })
    it('matches whole lines, not substrings', () => {
      const r = planBackfill({
        experiences: [exp('e1', '## Overview\n- Cut the budget by 30%')], projects: [],
        activities: [resp({ experienceId: 'e1', description: 'Budget' })],
      })
      expect(r.folds[0].responsibilities).toEqual(['Budget'])
    })
    it('adds nothing when everything is already in the Overview, or the note was already folded', () => {
      const covered = planBackfill({
        experiences: [exp('e1', '## Overview\n- Budget owner')], projects: [], activities: [resp({ experienceId: 'e1', description: 'Budget owner' })],
      })
      expect(covered.folds).toEqual([])
      const first = planBackfill({ experiences: [exp('e1', '')], projects: [], activities: [resp({ experienceId: 'e1', description: 'Budget owner' })] })
      const second = planBackfill({
        experiences: [exp('e1', first.folds[0].after)], projects: [], activities: [resp({ experienceId: 'e1', description: 'Budget owner' })],
      })
      expect(second.folds).toEqual([])
      expect(second.foldsSkipped).toEqual([])
    })
    it('says so when a note was already folded but has newer responsibilities', () => {
      const first = planBackfill({ experiences: [exp('e1', '')], projects: [], activities: [resp({ experienceId: 'e1', description: 'Budget owner' })] })
      const r = planBackfill({
        experiences: [exp('e1', first.folds[0].after)], projects: [],
        activities: [resp({ experienceId: 'e1', description: 'Budget owner' }), resp({ experienceId: 'e1', description: 'New duty' })],
      })
      expect(r.folds).toEqual([])
      expect(r.foldsSkipped).toMatchObject([{ experienceId: 'e1', reason: 'already_folded', responsibilities: ['New duty'] }])
      expect(formatReport(r)).toContain('NOT folded')
    })
    it('puts the fold in an Overview that is not the first section', () => {
      const r = planBackfill({
        experiences: [exp('e1', '## Achievements\n- a\n\n## Overview\nLed it.\n\n## Skills\n- x')], projects: [],
        activities: [resp({ experienceId: 'e1', description: 'Duty' })],
      })
      expect(r.folds[0].after).toBe(`## Achievements\n- a\n\n## Overview\nLed it.\n\n${FOLD_LEAD_IN}\n- Duty\n\n## Skills\n- x`)
    })
    it('does not fold responsibilities that have no role', () => {
      const r = planBackfill({ experiences: [exp('e1')], projects: [], activities: [resp({ description: 'Floating' })] })
      expect(r.folds).toEqual([])
      expect(r.activitiesUnresolved).toHaveLength(1)
    })
  })

  it('counts', () => {
    const r = planBackfill({
      experiences: [exp('e1'), exp('e2', '', 'independent')],
      projects: [proj('p1', 'e1')],
      activities: [act({ experienceId: 'e1' }), act({ kind: 'responsibility', experienceId: 'e1' })],
    })
    expect(r.counts).toEqual({ experiences: 2, independentExperiences: 1, projects: 1, activities: 2, responsibilities: 1, achievements: 1 })
  })

  it('does not mutate its input', () => {
    const input: BackfillInput = {
      experiences: [exp('e1', 'note')], projects: [proj('p1', null)],
      activities: [act({ kind: 'responsibility', experienceId: 'e1', description: 'x' })],
    }
    const copy = structuredClone(input)
    planBackfill(input)
    expect(input).toEqual(copy)
  })
})

describe('formatReport', () => {
  it('says it is a dry run and lists each group', () => {
    const text = formatReport(planBackfill({
      experiences: [exp('e1', '')],
      projects: [proj('p1', null), proj('p2', 'e1')],
      activities: [
        act({ projectId: 'p2', description: 'Launched the thing' }),
        act({ kind: 'responsibility', experienceId: 'e1', description: 'Owned the calendar' }),
        act({ description: 'Floating' }),
      ],
    }))
    expect(text).toContain('DRY RUN (nothing has been changed)')
    expect(text).toContain('1. Projects with no role: 1')
    expect(text).toContain('[Project p2] Launched the thing  →  Role e1 at Co e1')
    expect(text).toContain('Floating  (no role and no project)')
    expect(text).toContain('| - Owned the calendar')
  })
})

describe('near-duplicate responsibilities', () => {
  const resp = 'Developed the concept for a European media tour bringing Diablo III on Nintendo Switch to journalists via two custom chests'
  const ach = 'Developed the concept for a European media tour bringing Diablo III on Nintendo Switch to journalists via two custom Diablo-themed chests, each holding four Switch consoles'

  it('matches a near-verbatim restatement, whichever is longer', () => {
    expect(isNearDuplicate(resp, ach)).toBe(true)
    expect(isNearDuplicate(ach, resp)).toBe(true)
  })
  it('does not match a paraphrase, a short text, or unrelated text', () => {
    expect(isNearDuplicate('Partnered directly with the sales team to support studio relationships', 'Embedded alongside sales on strategic studio accounts using the programme')).toBe(false)
    expect(isNearDuplicate('Budget owner', 'Owned the budget and the forecast for the programme')).toBe(false)
    expect(isNearDuplicate('Led crisis communications during a global policy controversy', 'Cut asset turnaround from three weeks to one hour for regional teams')).toBe(false)
  })

  it('leaves a responsibility out of the fold when a same-role achievement restates it, and says so', () => {
    const a = act({ experienceId: 'e1', projectId: 'p1', description: ach })
    const r = planBackfill({
      experiences: [exp('e1', '')], projects: [proj('p1', 'e1')],
      activities: [a, act({ kind: 'responsibility', experienceId: 'e1', description: resp }), act({ kind: 'responsibility', experienceId: 'e1', description: 'Owned the regional budget and forecasts' })],
    })
    expect(r.folds[0].responsibilities).toEqual(['Owned the regional budget and forecasts'])
    expect(r.nearDuplicates).toMatchObject([{ experienceId: 'e1', responsibility: resp, achievementId: a.id, achievement: ach }])
    expect(formatReport(r)).toContain('6. Responsibilities left out because an achievement already says almost the same: 1')
  })
  it('only compares within the same role, and counts achievements reached through a project', () => {
    const viaProject = act({ projectId: 'p1', description: ach })
    const other = planBackfill({
      experiences: [exp('e1'), exp('e2')], projects: [proj('p1', 'e2')],
      activities: [viaProject, act({ kind: 'responsibility', experienceId: 'e1', description: resp })],
    })
    expect(other.nearDuplicates).toEqual([])
    expect(other.folds[0].responsibilities).toEqual([resp])
    const same = planBackfill({
      experiences: [exp('e1')], projects: [proj('p1', 'e1')],
      activities: [viaProject, act({ kind: 'responsibility', experienceId: 'e1', description: resp })],
    })
    expect(same.nearDuplicates).toHaveLength(1)
    expect(same.folds).toEqual([])
  })
})
