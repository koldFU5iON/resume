import { describe, expect, it } from 'vitest'
import { employerPeriod, groupEmployers, mergeStints, normaliseEmployerName, progressionLine, relatedEmployerNotes, stintYears, type RoleInput } from './employers'

const d = (ym: string) => new Date(`${ym}-01T00:00:00Z`)
const role = (id: string, company: string, title: string, start: string, end: string | null): RoleInput => ({
  experienceId: id, company, title, start: d(start), end: end ? d(end) : null,
})

describe('normaliseEmployerName', () => {
  it.each([
    ['Unity', 'unity'],
    ['  UNITY  ', 'unity'],
    ['Unity Technologies, Inc.', 'unity-technologies'],
    ['The Walt  Disney Company', 'walt-disney'],
    ['Acme Company', 'acme'],
    ['Acme Co.', 'acme'],
    ['Blizzard Entertainment', 'blizzard-entertainment'],
    ['Ubisoft S.A.', 'ubisoft'],
    ['Café & Co', 'cafe-and'],
    ['Acme GmbH', 'acme'],
  ])('%s -> %s', (name, key) => {
    expect(normaliseEmployerName(name)).toBe(key)
  })

  it('keeps a name that is only a legal suffix, and returns empty for no usable characters', () => {
    expect(normaliseEmployerName('Limited')).toBe('limited')
    expect(normaliseEmployerName('Company')).toBe('company')
    expect(normaliseEmployerName('---')).toBe('')
  })

  it('does not merge a different company that merely starts the same', () => {
    expect(normaliseEmployerName('Unity')).not.toBe(normaliseEmployerName('Unity Technologies'))
  })
})

describe('groupEmployers', () => {
  it('groups roles at one employer, even when the spelling differs', () => {
    const g = groupEmployers([
      role('e3', 'Unity', 'Snr. Program Manager', '2023-01', null),
      role('e2', 'unity technologies' /* different company */, 'X', '2020-01', '2022-12'),
      role('e1', ' UNITY ', 'Program Manager', '2019-03', '2022-12'),
    ])
    expect(g.map((e) => e.key)).toEqual(['unity', 'unity-technologies'])
    expect(g[0].roles.map((r) => r.experienceId)).toEqual(['e1', 'e3'])
  })

  it('groups non-adjacent stints at one employer, each keeping its own dates', () => {
    const g = groupEmployers([
      role('e3', 'Acme Ltd', 'Lead', '2022-01', null),
      role('e2', 'Beta', 'Engineer', '2018-01', '2021-12'),
      role('e1', 'Acme', 'Developer', '2015-01', '2017-12'),
    ])
    expect(g.map((e) => e.key)).toEqual(['acme', 'beta'])
    const acme = g[0]
    expect(acme.roles).toEqual([
      { experienceId: 'e1', title: 'Developer', start: '2015-01-01', end: '2017-12-01' },
      { experienceId: 'e3', title: 'Lead', start: '2022-01-01', end: null },
    ])
    expect(acme.start).toBe('2015-01-01')
    expect(acme.end).toBeNull() // one stint is current
    // The dates to show are the stints: Acme 2015-2017 and 2022-present, not one 2015-present span.
    expect(acme.stints).toEqual([{ start: '2015-01-01', end: '2017-12-01' }, { start: '2022-01-01', end: null }])
  })

  it('a returnee does not read as continuous tenure next to the employer they left for', () => {
    const g = groupEmployers([
      role('u1', 'Unity', 'Program Manager', '2015-01', '2017-01'),
      role('b1', 'Blizzard', 'Producer', '2017-01', '2019-01'),
      role('u2', 'Unity', 'Snr. Program Manager', '2019-02', null),
    ])
    const unity = g.find((e) => e.key === 'unity')!
    expect(unity.stints).toEqual([{ start: '2015-01-01', end: '2017-01-01' }, { start: '2019-02-01', end: null }])
    expect(employerPeriod(unity)).toBe('Jan 2015 – Jan 2017, Feb 2019 – present')
    expect(unity.progression).toBe('Two roles at Unity (2015–2017, 2019–present): Program Manager → Snr. Program Manager')
    expect(unity.progression).not.toContain('2015–present')
    expect(g.find((e) => e.key === 'blizzard')!.stints).toEqual([{ start: '2017-01-01', end: '2019-01-01' }])
  })

  it('merges roles into one stint only where they touch, overlap or sit within about three months', () => {
    const stintsOf = (...rs: RoleInput[]) => groupEmployers(rs)[0].stints
    // Back to back: one stint.
    expect(stintsOf(role('a', 'Co', 'A', '2018-01', '2019-06'), role('b', 'Co', 'B', '2019-07', '2021-01'))).toEqual([{ start: '2018-01-01', end: '2021-01-01' }])
    // Overlapping: one stint, ending at the later end.
    expect(stintsOf(role('a', 'Co', 'A', '2018-01', '2020-06'), role('b', 'Co', 'B', '2019-01', '2019-12'))).toEqual([{ start: '2018-01-01', end: '2020-06-01' }])
    // A three-month gap still counts as continuous; four months does not.
    expect(stintsOf(role('a', 'Co', 'A', '2018-01', '2019-01'), role('b', 'Co', 'B', '2019-04', '2020-01'))).toHaveLength(1)
    expect(stintsOf(role('a', 'Co', 'A', '2018-01', '2019-01'), role('b', 'Co', 'B', '2019-05', '2020-01'))).toHaveLength(2)
    // A current role runs on and absorbs later starts.
    expect(mergeStints([{ start: '2020-01-01', end: null }, { start: '2022-01-01', end: '2023-01-01' }])).toEqual([{ start: '2020-01-01', end: null }])
  })

  it('writes the company as most often spelled, not as a lowercase latest role', () => {
    const g = groupEmployers([
      role('a', 'Unity', 'A', '2015-01', '2016-12'),
      role('b', 'Unity', 'B', '2017-01', '2018-12'),
      role('c', 'unity', 'C', '2019-01', null),
    ])
    expect(g[0].company).toBe('Unity')
    // One of each: the properly cased spelling beats an all-lowercase latest one.
    const tie = groupEmployers([role('a', 'Unity', 'A', '2015-01', '2016-12'), role('c', 'unity', 'C', '2019-01', null)])
    expect(tie[0].company).toBe('Unity')
    expect(groupEmployers([role('a', 'unity', 'A', '2015-01', null)])[0].company).toBe('unity')
  })

  it('uses the title of the most recent role, exactly as written', () => {
    const g = groupEmployers([
      role('e1', 'Unity', 'Program Manager', '2019-03', '2021-02'),
      role('e2', 'Unity', 'Snr. Program Manager', '2021-03', null),
      role('e3', 'Unity', 'Associate PM', '2017-01', '2019-02'),
    ])
    expect(g).toHaveLength(1)
    expect(g[0].latestTitle).toBe('Snr. Program Manager')
    expect(g[0].roles.map((r) => r.title)).toEqual(['Associate PM', 'Program Manager', 'Snr. Program Manager'])
  })

  it('takes the latest title from the end date, then the start date, whatever order roles are given in', () => {
    const finished = groupEmployers([
      role('a', 'Co', 'Old', '2018-01', '2019-12'),
      role('b', 'Co', 'New', '2020-01', '2022-06'),
    ])
    expect(finished[0].latestTitle).toBe('New')
    expect(finished[0].end).toBe('2022-06-01')
    const reversed = groupEmployers([
      role('b', 'Co', 'New', '2020-01', '2022-06'),
      role('a', 'Co', 'Old', '2018-01', '2019-12'),
    ])
    expect(reversed[0].latestTitle).toBe('New')
    // Overlapping, both current: the later start is the latest.
    const overlap = groupEmployers([
      role('a', 'Co', 'Advisor', '2018-01', null),
      role('b', 'Co', 'Director', '2022-01', null),
    ])
    expect(overlap[0].latestTitle).toBe('Director')
  })

  it('returns employers newest first, a current employer ahead of a finished one', () => {
    const g = groupEmployers([
      role('e1', 'Old Co', 'Dev', '2010-01', '2014-12'),
      role('e2', 'Now Co', 'Lead', '2020-01', null),
      role('e3', 'Mid Co', 'Senior', '2015-01', '2019-12'),
    ])
    expect(g.map((e) => e.company)).toEqual(['Now Co', 'Mid Co', 'Old Co'])
  })

  it('never merges two roles whose company is blank', () => {
    const g = groupEmployers([role('a', '---', 'Freelance', '2020-01', '2021-01'), role('b', '', 'Contract', '2021-02', null)])
    expect(g).toHaveLength(2)
    expect(new Set(g.map((e) => e.key)).size).toBe(2)
  })

  it('gives a single-role employer no progression line', () => {
    const g = groupEmployers([role('e1', 'Solo', 'Dev', '2020-01', null)])
    expect(g[0].progression).toBeNull()
    expect(g[0].roles).toHaveLength(1)
  })
})

describe('progressionLine', () => {
  const roles = (titles: string[]) => titles.map((title, i) => ({ experienceId: `e${i}`, title, start: `${2019 + i}-01-01`, end: null }))
  const since2019 = [{ start: '2019-01-01', end: null }]

  it('is built in code from the titles, oldest first, with neutral wording', () => {
    const line = progressionLine('Unity', roles(['Program Manager', 'Senior PM', 'Snr. Program Manager', 'Group PM']), since2019)
    expect(line).toBe('Four roles at Unity (2019–present): Program Manager → Senior PM → Snr. Program Manager → Group PM')
  })

  it('never says promoted', () => {
    const line = progressionLine('Unity', roles(['A', 'B']), [{ start: '2019-01-01', end: '2024-06-01' }])
    expect(line).toBe('Two roles at Unity (2019–2024): A → B')
    expect(line?.toLowerCase()).not.toContain('promot')
  })

  it('renders each stint, so a gap shows', () => {
    const stints = [{ start: '2015-01-01', end: '2017-01-01' }, { start: '2019-02-01', end: null }]
    expect(stintYears(stints)).toBe('2015–2017, 2019–present')
    expect(progressionLine('Unity', roles(['A', 'B']), stints)).toBe('Two roles at Unity (2015–2017, 2019–present): A → B')
  })

  it('counts the titles it shows: a repeated title is shown once and counted once', () => {
    expect(progressionLine('Acme', roles(['Lead', 'Lead', 'Head']), [{ start: '2020-02-01', end: '2020-11-01' }])).toBe('Two roles at Acme (2020): Lead → Head')
    expect(progressionLine('Acme', roles(['Lead', ' lead ', 'Head', 'Head', 'Chief']), since2019)).toBe('Three roles at Acme (2019–present): Lead → Head → Chief')
  })

  it('is null when only one distinct title remains (the same title held twice is not a progression)', () => {
    expect(progressionLine('Acme', roles(['Lead', 'Lead']), since2019)).toBeNull()
    const g = groupEmployers([role('a', 'Acme', 'Lead', '2015-01', '2016-01'), role('b', 'Acme', 'Lead', '2019-01', null)])
    expect(g[0].progression).toBeNull()
    expect(g[0].stints).toHaveLength(2)
  })

  it('uses digits past ten titles, and is null for fewer than two', () => {
    expect(progressionLine('Acme', roles(Array.from({ length: 11 }, (_, i) => `T${i}`)), since2019)).toMatch(/^11 roles at Acme/)
    expect(progressionLine('Acme', roles(['Only']), since2019)).toBeNull()
  })
})

describe('relatedEmployerNotes', () => {
  it('says when one name is among the words of another, and they were kept apart', () => {
    expect(relatedEmployerNotes(['Unity', 'Unity Technologies'])).toEqual([
      "'Unity' and 'Unity Technologies' were kept apart; give them the same company name in your profile to merge them.",
    ])
    expect(relatedEmployerNotes(['Acme Digital Ltd', 'Acme'])).toHaveLength(1)
  })

  it('stays quiet for unrelated names, spelling variants of one company, and blanks', () => {
    expect(relatedEmployerNotes(['Unity', 'Blizzard Entertainment', 'Beta'])).toEqual([])
    expect(relatedEmployerNotes(['Unity', 'unity Ltd', '  ', '---'])).toEqual([])
  })

  it('bounds the notes', () => {
    const notes = relatedEmployerNotes(['A', 'A B', 'A C', 'A D', 'A E'], 2)
    expect(notes).toHaveLength(3)
    expect(notes[2]).toMatch(/more employer names look related/)
  })
})

describe('employerPeriod', () => {
  it('formats the stints and tolerates bad input', () => {
    expect(employerPeriod({ start: '2019-03-01', end: null, stints: [{ start: '2019-03-01', end: null }] })).toBe('Mar 2019 – present')
    expect(employerPeriod({ start: '2015-01-01', end: null, stints: [{ start: '2015-01-01', end: '2017-12-01' }, { start: '2019-03-01', end: null }] })).toBe('Jan 2015 – Dec 2017, Mar 2019 – present')
    expect(employerPeriod({ start: null, end: null })).toBeNull()
    expect(employerPeriod({ start: 'nonsense', end: null })).toBeNull()
  })

  it('reads a row stored before stints as one stint', () => {
    expect(employerPeriod({ start: '2019-03-01', end: '2021-12-01' })).toBe('Mar 2019 – Dec 2021')
  })
})
