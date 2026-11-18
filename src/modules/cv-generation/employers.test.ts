import { describe, expect, it } from 'vitest'
import { employerPeriod, groupEmployers, normaliseEmployerName, progressionLine, type RoleInput } from './employers'

const d = (ym: string) => new Date(`${ym}-01T00:00:00Z`)
const role = (id: string, company: string, title: string, start: string, end: string | null): RoleInput => ({
  experienceId: id, company, title, start: d(start), end: end ? d(end) : null,
})

describe('normaliseEmployerName', () => {
  it.each([
    ['Unity', 'unity'],
    ['  UNITY  ', 'unity'],
    ['Unity Technologies, Inc.', 'unity-technologies'],
    ['The Walt  Disney Company', 'walt-disney-company'],
    ['Blizzard Entertainment', 'blizzard-entertainment'],
    ['Ubisoft S.A.', 'ubisoft'],
    ['Café & Co', 'cafe-and'],
    ['Acme GmbH', 'acme'],
  ])('%s -> %s', (name, key) => {
    expect(normaliseEmployerName(name)).toBe(key)
  })

  it('keeps a name that is only a legal suffix, and returns empty for no usable characters', () => {
    expect(normaliseEmployerName('Limited')).toBe('limited')
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

  it('is built in code from the titles, oldest first, with neutral wording', () => {
    const line = progressionLine('Unity', roles(['Program Manager', 'Senior PM', 'Snr. Program Manager', 'Group PM']), '2019-01-01', null)
    expect(line).toBe('Four roles at Unity (2019–present): Program Manager → Senior PM → Snr. Program Manager → Group PM')
  })

  it('never says promoted', () => {
    const line = progressionLine('Unity', roles(['A', 'B']), '2019-01-01', '2024-06-01')
    expect(line).toBe('Two roles at Unity (2019–2024): A → B')
    expect(line?.toLowerCase()).not.toContain('promot')
  })

  it('shows an adjacent repeated title once and a one-year span as one year', () => {
    expect(progressionLine('Acme', roles(['Lead', 'Lead', 'Head']), '2020-02-01', '2020-11-01')).toBe('Three roles at Acme (2020): Lead → Head')
  })

  it('uses digits past ten roles, and is null for fewer than two', () => {
    expect(progressionLine('Acme', roles(Array.from({ length: 11 }, (_, i) => `T${i}`)), '2019-01-01', null)).toMatch(/^11 roles at Acme/)
    expect(progressionLine('Acme', roles(['Only']), '2019-01-01', null)).toBeNull()
  })
})

describe('employerPeriod', () => {
  it('formats the overall span and tolerates bad input', () => {
    expect(employerPeriod('2019-03-01', null)).toBe('Mar 2019 – present')
    expect(employerPeriod('2019-03-01', '2021-12-01')).toBe('Mar 2019 – Dec 2021')
    expect(employerPeriod(null, null)).toBeNull()
    expect(employerPeriod('nonsense', null)).toBeNull()
  })
})
