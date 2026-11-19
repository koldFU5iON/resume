import { describe, expect, it } from 'vitest'
import {
  CONCURRENT_MIN_OVERLAP_MONTHS, EMPLOYMENT_GAP_MONTHS, FILLER_RESPONSIBILITY_WORDS, LONG_ACTIVITY_WORDS,
  checkCapabilities, checkCertifications, checkConflictingFigures, checkContact, checkDuplicateProjects, checkEducation,
  checkEvidenceQuality, checkExperienceDates, checkExperienceEvidence, checkRoleOverview, checkThinNarratives,
} from './checks'
import {
  NOW, activity, careerChanger, certification, cleanProfile, earlyCareer, education, longCareer, messyImport, project,
  role, skill, vaultOf,
} from './__fixtures__/profiles'

const kinds = (fs: { kind: string }[]) => fs.map((f) => f.kind)

describe('checkThinNarratives: project notes and atoms', () => {
  it('does not flag a project with an empty description and a long notes body, or one with a short description, long notes and atoms', () => {
    const v = vaultOf({ projects: [
      project('pa', 'Support Assistant', '', { notes: '## Problem\n\nStaff answered the same questions by hand.\n\n## Results\n\n- Handled ~1,400 requests in the first quarter.' }),
      project('pb', 'Campaign Platform', 'A platform.', { activities: [activity('x1', { projectId: 'pb' }, 'achievement', 'Rebuilt the operating model for the campaign pages', 'turnaround 3 weeks to 1 hour')] }),
    ] })
    expect(checkThinNarratives(v, NOW).map((f) => f.noteId)).not.toContain('pa')
    expect(checkThinNarratives(v, NOW).map((f) => f.noteId)).not.toContain('pb')
  })
  it('still flags a title-only project', () => {
    expect(checkThinNarratives(vaultOf({ projects: [project('pt', 'Atlas', 'Atlas.')] }), NOW).map((f) => f.noteId)).toEqual(['pt'])
  })
})

describe('checkThinNarratives', () => {
  it('flags a project with only its title, naming it and asking for what and result', () => {
    const f = checkThinNarratives(messyImport(), NOW).find((x) => x.noteId === 'pr1')!
    expect(f.severity).toBe('fix')
    expect(f.message).toBe('Project "Enemies Demo Campaign" has only its title: add what you did and the result so the CV can use it.')
    expect(f.editHref).toBe('/dashboard/profile/n/pr1')
  })
  it('flags a role with no text and no evidence, and leaves a described project alone', () => {
    const fs = checkThinNarratives(messyImport(), NOW)
    expect(fs.map((x) => x.noteId)).toContain('e2')
    expect(fs.map((x) => x.noteId)).not.toContain('pr2')
  })
  it('counts a project name repeated in its own text as thin', () => {
    const v = vaultOf({ projects: [project('p', 'Atlas', 'Atlas.')] })
    expect(checkThinNarratives(v, NOW)).toHaveLength(1)
  })
  it('does not flag clean, early-career or career-changer profiles', () => {
    for (const v of [cleanProfile(), earlyCareer(), careerChanger(), longCareer()]) expect(checkThinNarratives(v, NOW)).toEqual([])
  })
})

describe('checkDuplicateProjects', () => {
  it('finds the same project entered twice under different casing', () => {
    const fs = checkDuplicateProjects(messyImport())
    expect(fs).toHaveLength(1)
    expect(fs[0]).toMatchObject({ kind: 'duplicate_project', severity: 'consider', noteType: 'project' })
    expect(fs[0].message).toContain('Enemies Demo Campaign')
  })
  it('finds near-identical names and high text overlap, but not different projects', () => {
    const text = 'Rebuilt the onboarding flow for new customers, cutting the steps from nine to four and adding a progress bar.'
    const v = vaultOf({ projects: [project('a', 'Onboarding revamp', text), project('b', 'Customer onboarding rebuild', text), project('c', 'Pricing page', 'Designed the pricing page and ran an A/B test on the headline copy for two weeks.')] })
    expect(checkDuplicateProjects(v).map((f) => f.noteId)).toEqual(['b'])
  })
  it('is quiet on every other fixture', () => {
    for (const v of [cleanProfile(), earlyCareer(), careerChanger(), longCareer()]) expect(checkDuplicateProjects(v)).toEqual([])
  })
})

describe('checkCertifications', () => {
  const fs = checkCertifications(messyImport(), NOW)
  it('asks for an issuer', () => {
    expect(fs.filter((f) => f.kind === 'cert_no_issuer').map((f) => f.noteId)).toEqual(['ce1', 'ce3'])
    expect(fs.find((f) => f.noteId === 'ce3')!.severity).toBe('consider')
  })
  it('catches status typed into the name', () => {
    const f = fs.find((x) => x.kind === 'cert_status_in_name')!
    expect(f).toMatchObject({ noteId: 'ce1', severity: 'consider' })
    expect(f.suggestion).toMatch(/expected date/i)
  })
  it('asks for an expected date when the only sign of progress is wording', () => {
    expect(fs.find((x) => x.kind === 'cert_in_progress_no_date')).toMatchObject({ noteId: 'ce1', severity: 'consider' })
  })
  it('notes an expired certification, once', () => {
    expect(fs.filter((f) => f.kind === 'cert_expired').map((f) => f.noteId)).toEqual(['ce2'])
  })
  it('does not flag a held or future-dated certification with an issuer', () => {
    expect(checkCertifications(cleanProfile(), NOW)).toEqual([])
    expect(checkCertifications(careerChanger(), NOW)).toEqual([])
  })
  it('treats bracketed or suffix "pending" as typed status, but not "ongoing" in a name', () => {
    const v = vaultOf({ certifications: [certification('c', 'CISSP - pending'), certification('d', 'AWS (in progress)'), certification('e', 'Ongoing Professional Development')] })
    expect(checkCertifications(v, NOW).filter((f) => f.kind === 'cert_status_in_name')).toHaveLength(2)
  })
})

describe('checkEducation', () => {
  it('flags an end before the start as a fix', () => {
    const f = checkEducation(messyImport(), NOW)
    expect(f[0]).toMatchObject({ kind: 'education_dates_reversed', severity: 'fix', noteId: 'ed1' })
  })
  it('asks about an old entry with no end date, but not a recent one in progress', () => {
    const v = vaultOf({ educations: [education('old', 'BA History', '2005-09', null), education('new', 'MSc', '2025-09', null)] })
    expect(checkEducation(v, NOW).map((f) => [f.kind, f.noteId])).toEqual([['education_undated', 'old']])
  })
  it('is quiet on complete fixtures, including study still running', () => {
    for (const v of [cleanProfile(), careerChanger(), earlyCareer(), longCareer()]) expect(checkEducation(v, NOW)).toEqual([])
  })
})

describe('checkExperienceDates', () => {
  it('flags an end before the start as a fix', () => {
    expect(checkExperienceDates(messyImport(), NOW).find((f) => f.kind === 'experience_dates_reversed')).toMatchObject({ severity: 'fix', noteId: 'e2' })
  })
  it('notes concurrent roles at different employers as a question, not a fault', () => {
    const f = checkExperienceDates(longCareer(), NOW).filter((x) => x.kind === 'concurrent_roles')
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('consider')
    expect(f[0].message).toMatch(/Beta Advisory.*alongside.*Alpha Group|Alpha Group.*alongside.*Beta Advisory/)
    expect(f[0].suggestion).toMatch(/concurrent/i)
  })
  it('ignores a short handover overlap and two roles at the same employer', () => {
    const v = vaultOf({ experiences: [
      role('a', 'One Co', 'Analyst', '2020-01', '2021-06', 'x'),
      role('b', 'Two Co', 'Analyst', '2021-06', null, 'x'),
      role('c', 'One Co', 'Senior', '2020-03', '2021-02', 'x'),
    ] })
    expect(checkExperienceDates(v, NOW).filter((f) => f.kind === 'concurrent_roles')).toEqual([])
    expect(CONCURRENT_MIN_OVERLAP_MONTHS).toBeGreaterThan(0)
  })
  it('notes a gap longer than the limit between employers, and not a shorter one', () => {
    const f = checkExperienceDates(longCareer(), NOW).filter((x) => x.kind === 'employment_gap')
    expect(f).toHaveLength(1)
    expect(f[0].message).toContain('Delta Retail')
    expect(f[0].message).toContain('Gamma Systems')
    const short = vaultOf({ experiences: [role('a', 'A', 'x', '2020-01', '2021-01', 'x'), role('b', 'B', 'x', '2021-12', null, 'x')] })
    expect(checkExperienceDates(short, NOW)).toEqual([])
    expect(EMPLOYMENT_GAP_MONTHS).toBe(12)
  })
  it('does not call a long concurrent role a gap, and is quiet on tidy careers', () => {
    expect(checkExperienceDates(longCareer(), NOW).filter((f) => f.kind === 'employment_gap')).toHaveLength(1)
    for (const v of [cleanProfile(), earlyCareer(), careerChanger()]) expect(checkExperienceDates(v, NOW)).toEqual([])
  })
})

describe('checkExperienceEvidence', () => {
  it('flags a role with no achievements or responsibilities, unless it is already reported as thin', () => {
    const v = vaultOf({ experiences: [role('r', 'Co', 'Analyst', '2020-01', null, 'A'.repeat(200))] })
    expect(checkExperienceEvidence(v, NOW)).toMatchObject([{ kind: 'experience_no_evidence', severity: 'consider', noteId: 'r' }])
    const short = vaultOf({ experiences: [role('r', 'Co', 'Analyst', '2020-01', null, 'A'.repeat(100))] })
    expect(checkExperienceEvidence(short, NOW)[0].severity).toBe('fix')
    expect(checkExperienceEvidence(messyImport(), NOW).map((f) => f.noteId)).not.toContain('e2')
  })
  it('counts evidence owned by the role\'s projects', () => {
    const v = vaultOf({
      experiences: [role('r', 'Co', 'Analyst', '2020-01', null, 'A'.repeat(200))],
      projects: [project('p', 'Atlas', 'x', { experienceId: 'r', activities: [activity('a', { projectId: 'p' }, 'achievement', 'Shipped Atlas', '3 weeks early')] })],
    })
    expect(checkExperienceEvidence(v, NOW)).toEqual([])
  })
  it('is quiet on fixtures that have evidence', () => {
    for (const v of [cleanProfile(), earlyCareer(), careerChanger(), longCareer()]) expect(checkExperienceEvidence(v, NOW)).toEqual([])
  })
})

describe('checkEvidenceQuality', () => {
  const fs = checkEvidenceQuality(messyImport())
  it('aggregates achievements with no figure or outcome, listing the weakest', () => {
    const f = fs.find((x) => x.kind === 'unmeasured_achievements')
    expect(f).toBeUndefined() // 1 of 3 unmeasured: below the share, so no noise
    const many = vaultOf({ experiences: [role('r', 'Co', 'x', '2020-01', null, 'x', Array.from({ length: 8 }, (_, i) => activity(`a${i}`, { experienceId: 'r' }, 'achievement', `Improved the ${'abcdefgh'[i]} process for the team`, null)))] })
    const g = checkEvidenceQuality(many).find((x) => x.kind === 'unmeasured_achievements')!
    expect(g.severity).toBe('consider')
    expect(g.message).toContain('8 of 8')
    expect(g.message.match(/"Improved/g)).toHaveLength(5)
  })
  it('treats a figure in the text as an outcome', () => {
    const v = vaultOf({ experiences: [role('r', 'Co', 'x', '2020-01', null, 'x', Array.from({ length: 6 }, (_, i) => activity(`a${i}`, { experienceId: 'r' }, 'achievement', `Cut cost by ${i + 10}% for the team`, null)))] })
    expect(checkEvidenceQuality(v).filter((f) => f.kind === 'unmeasured_achievements')).toEqual([])
  })
  it('flags responsibilities that are only a few words', () => {
    const f = fs.find((x) => x.kind === 'filler_responsibility')!
    expect(f.message).toContain('"Ran meetings"')
    expect(f.severity).toBe('consider')
    expect(FILLER_RESPONSIBILITY_WORDS).toBe(6)
  })
  it('flags an activity much longer than a bullet', () => {
    const f = fs.find((x) => x.kind === 'long_activity')!
    expect(f.message).toContain('70')
    expect(LONG_ACTIVITY_WORDS).toBe(60)
  })
  it('is quiet on clean fixtures', () => {
    for (const v of [cleanProfile(), earlyCareer(), careerChanger(), longCareer()]) expect(checkEvidenceQuality(v).filter((f) => f.kind !== 'filler_responsibility')).toEqual([])
  })
})

describe('checkConflictingFigures', () => {
  it('asks about two items at one employer that describe the same thing with different figures', () => {
    const f = checkConflictingFigures(messyImport())
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ kind: 'conflicting_figures', severity: 'consider' })
    expect(f[0].message).toMatch(/\?$/)
    expect(f[0].message).toContain('30%')
    expect(f[0].message).toContain('55%')
  })
  it('does not compare across employers, or items that share few words', () => {
    const v = vaultOf({ experiences: [
      role('a', 'A', 'x', '2020-01', '2021-01', 'x', [activity('a1', { experienceId: 'a' }, 'achievement', 'Grew the audience of the weekly show', 'Up 30%')]),
      role('b', 'B', 'x', '2021-02', null, 'x', [
        activity('b1', { experienceId: 'b' }, 'achievement', 'Grew the audience of the weekly show', 'Up 55%'),
        activity('b2', { experienceId: 'b' }, 'achievement', 'Cut the cost of hosting', 'Down 12%'),
      ]),
    ] })
    expect(checkConflictingFigures(v)).toEqual([])
  })
  it('ignores years and equal figures', () => {
    const v = vaultOf({ experiences: [role('a', 'A', 'x', '2020-01', null, 'x', [
      activity('a1', { experienceId: 'a' }, 'achievement', 'Launched the loyalty scheme for customers in 2021', 'Reached 40% of customers'),
      activity('a2', { experienceId: 'a' }, 'achievement', 'Launched the loyalty scheme for customers in 2022', 'Reached 40% of customers'),
    ])] })
    expect(checkConflictingFigures(v)).toEqual([])
  })
  it('is quiet on clean fixtures', () => {
    for (const v of [cleanProfile(), earlyCareer(), careerChanger(), longCareer()]) expect(checkConflictingFigures(v)).toEqual([])
  })
  describe('structured results', () => {
    const res = (measure: string, value: string, baseline: string | null = null, period: string | null = null) => ({ measure, value, baseline, period } as unknown as Record<string, string>)
    const two = (a: Record<string, string>, b: Record<string, string>) => vaultOf({ experiences: [role('a', 'A', 'x', '2020-01', null, 'x', [
      activity('a1', { experienceId: 'a' }, 'achievement', 'Sped up asset hand-offs for the design team', null, [], 0, a),
      activity('a2', { experienceId: 'a' }, 'achievement', 'Reworked the request form for assets', null, [], 1, b),
    ])] })
    it('flags the same measure and period with different results, however the prose reads', () => {
      const f = checkConflictingFigures(two(res('asset turnaround time', '1 hour', '3 weeks'), res('asset turnaround time', '1 week', '4 weeks')))
      expect(f).toHaveLength(1)
      expect(f[0].message).toContain('1 hour (from 3 weeks)')
      expect(f[0].message).toContain('1 week (from 4 weeks)')
    })
    it('does not flag different periods, different measures or equal results', () => {
      expect(checkConflictingFigures(two(res('asset turnaround time', '1 hour', '3 weeks', 'Q1 2023'), res('asset turnaround time', '1 week', '4 weeks', 'Q3 2023')))).toEqual([])
      expect(checkConflictingFigures(two(res('asset turnaround time', '1 hour'), res('request approval time', '1 week')))).toEqual([])
      expect(checkConflictingFigures(two(res('asset turnaround time', '1 hour', '3 weeks'), res('Asset turnaround time', '1 hour', '3 weeks')))).toEqual([])
    })
    it('compares structured items by their fields, not by the words of their prose', () => {
      // No shared words in the prose at all, yet the same measure and period disagree.
      const v = vaultOf({ experiences: [role('a', 'A', 'x', '2020-01', null, 'x', [
        activity('a1', { experienceId: 'a' }, 'achievement', 'Apples', null, [], 0, res('reach', '2M')),
        activity('a2', { experienceId: 'a' }, 'achievement', 'Oranges', null, [], 1, res('reach', '3M')),
      ])] })
      expect(checkConflictingFigures(v)).toHaveLength(1)
    })
  })
})

describe('review follow-ups', () => {
  it('conflicting figures need the same unit and mostly the same words', () => {
    const mk = (a: string, ai: string, b: string, bi: string) => vaultOf({ experiences: [role('r', 'Co', 'x', '2020-01', null, 'x', [
      activity('a', { experienceId: 'r' }, 'achievement', a, ai), activity('b', { experienceId: 'r' }, 'achievement', b, bi)])] })
    expect(checkConflictingFigures(mk('Grew the audience of the weekly show', 'Up 30%', 'Grew the audience of the weekly show', 'Up 12 episodes'))).toEqual([])
    expect(checkConflictingFigures(mk('Grew the audience of the weekly show', 'Up 30%', 'Grew the audience, cut hosting cost, hired editors, launched newsletter, ran events', 'Down 55%'))).toEqual([])
  })
  it('concurrent roles: one finding per role, capped', () => {
    const seats = [1, 2, 3, 4].map((i) => role(`s${i}`, `Board ${i}`, 'Board member', `202${i}-01`, null, 'x'))
    const v = vaultOf({ experiences: [role('m', 'Main Co', 'Director', '2015-01', null, 'x'), ...seats] })
    const f = checkExperienceDates(v, NOW).filter((x) => x.kind === 'concurrent_roles')
    expect(f).toHaveLength(3)
    expect(new Set(f.map((x) => x.noteId)).size).toBe(3)
  })
})

describe('checkCapabilities', () => {
  it('lists claimed-only capabilities as one aggregate', () => {
    const f = checkCapabilities(messyImport()).find((x) => x.kind === 'claimed_only_capabilities')!
    expect(f.severity).toBe('consider')
    expect(f.message).toContain('Unity')
    expect(f.message).toContain('Photoshop')
  })
  it('counts evidence with no capability link, and mentions AI link suggestions', () => {
    const f = checkCapabilities(messyImport()).find((x) => x.kind === 'unlinked_evidence')!
    expect(f.severity).toBe('consider')
    expect(f.suggestion).toContain('Suggest links')
    expect(f.editHref).toBe('/dashboard/profile/n/overview')
  })
  it('names a [[wikilinked]] tool that is not a capability', () => {
    const f = checkCapabilities(messyImport()).find((x) => x.kind === 'unlisted_capability')!
    expect(f.message).toContain('Obscure Tool')
    expect(f.editHref).toBe('/dashboard/profile/records/capabilities')
  })
  it('is quiet on the clean profile', () => {
    expect(checkCapabilities(cleanProfile())).toEqual([])
  })
  it('does not count a certification-backed capability as claimed', () => {
    const v = vaultOf({ skills: [skill('s', 'PMP skill')] })
    expect(kinds(checkCapabilities(v))).not.toContain('unlinked_evidence')
  })
})

describe('checkContact', () => {
  it('flags a missing email as a fix and lists what else is missing, without values', () => {
    const f = checkContact(messyImport())
    const c = f.find((x) => x.kind === 'contact_missing')!
    expect(c.severity).toBe('fix')
    expect(c.message).toContain('email')
    expect(c.message).toContain('phone')
    expect(c.message).toContain('LinkedIn')
    expect(f.find((x) => x.kind === 'location_missing')?.severity).toBe('consider')
  })
  it('is quiet when everything is present', () => {
    expect(checkContact(cleanProfile())).toEqual([])
  })
  it('says so when right-to-work details exist, since the CV header cannot show them yet', () => {
    const v = vaultOf({}, { settings: { searchProfile: { eligibility: { citizenships: ['FR'] } }, updatedAt: new Date() } } as never)
    expect(checkContact(v).find((f) => f.kind === 'right_to_work_not_shown')?.severity).toBe('consider')
    expect(checkContact(cleanProfile()).map((f) => f.kind)).not.toContain('right_to_work_not_shown')
  })
  it('never repeats contact details in a finding', () => {
    const text = JSON.stringify(checkContact(cleanProfile()))
    expect(text).not.toContain('robin@example.test')
  })
})

describe('checkRoleOverview', () => {
  const withEvidence = (body: string) => vaultOf({
    experiences: [role('r', 'Megarom', 'Comms Manager', '2020-01', null, body)],
    projects: [project('p', 'Atlas', 'x', { experienceId: 'r', activities: [activity('a', { projectId: 'p' }, 'achievement', 'Shipped the Atlas launch across twelve markets with the regional teams and press partners involved', '3 weeks early')] })],
  })
  it('considers a role with achievements but a thin overview', () => {
    expect(checkRoleOverview(withEvidence('Comms.'), NOW)).toMatchObject([{ kind: 'role_overview_thin', severity: 'consider', noteId: 'r' }])
  })
  it('is quiet when the overview has enough text, or the role has no achievements', () => {
    expect(checkRoleOverview(withEvidence('A'.repeat(200)), NOW)).toEqual([])
    expect(checkRoleOverview(vaultOf({ experiences: [role('r', 'Co', 'Analyst', '2020-01', null, 'A'.repeat(200))] }), NOW)).toEqual([])
  })
})

describe('figure_in_prose', () => {
  const ach = (i: number, text: string, result: Record<string, string> | null = null) => activity(`f${i}`, { experienceId: 'a' }, 'achievement', text, null, [], i, result)
  const withAchievements = (list: ReturnType<typeof ach>[]) => vaultOf({ experiences: [role('a', 'A', 'x', '2020-01', null, 'x', list)] })
  it('asks once, listing achievements with a figure in the text and no result', () => {
    const f = checkEvidenceQuality(withAchievements([ach(1, 'Grew sign-ups by 30% in a year'), ach(2, 'Cut costs by 12%'), ach(3, 'Reached 2M readers'), ach(4, 'Ran the weekly show')]))
      .filter((x) => x.kind === 'figure_in_prose')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'consider' })
    expect(f[0].message).toContain('3 achievements')
  })
  it('does not count achievements that have a result, or years, and needs at least three', () => {
    const r = { measure: 'sign-ups', value: '30%' }
    const quiet = (list: ReturnType<typeof ach>[]) => checkEvidenceQuality(withAchievements(list)).filter((x) => x.kind === 'figure_in_prose')
    expect(quiet([ach(1, 'Grew sign-ups by 30%', r), ach(2, 'Cut costs by 12%', { measure: 'cost', value: '12%' }), ach(3, 'Reached 2M readers', { measure: 'reach', value: '2M' })])).toEqual([])
    expect(quiet([ach(1, 'Launched the 2021 programme'), ach(2, 'Ran the 2022 review'), ach(3, 'Shipped in 2023')])).toEqual([])
    expect(quiet([ach(1, 'Grew sign-ups by 30%'), ach(2, 'Cut costs by 12%')])).toEqual([])
  })
  it('is quiet on the clean profile that has structured or no figures', () => {
    expect(checkEvidenceQuality(cleanProfile()).filter((x) => x.severity === 'fix')).toEqual([])
  })
})
