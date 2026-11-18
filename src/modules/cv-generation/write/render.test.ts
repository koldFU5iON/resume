import { describe, expect, it } from 'vitest'
import type { SelectedEmployer } from '../schema'
import {
  renderCertifications, renderEducation, renderEmployerEntry, renderEmployerHeader, renderHeaderOnlyEmployer, renderLanguages, renderNameGroups,
} from './render'

const employer = (over: Partial<SelectedEmployer> = {}): SelectedEmployer => ({
  key: 'unity', company: 'Unity', latestTitle: 'Snr. Program Manager', start: '2015-01-01', end: null,
  stints: [{ start: '2015-01-01', end: '2017-06-30' }, { start: '2019-01-01', end: null }],
  roles: [], progression: 'Three roles at Unity (2015–2017, 2019–present): Program Manager → Technical Program Manager → Snr. Program Manager',
  relevance: 5, reason: '', headerOnly: false, bullets: [], ...over,
})

describe('employer rendering (titles, companies and dates come from the profile)', () => {
  it('renders the company, the latest title exactly, the stints and the progression line', () => {
    const md = renderEmployerHeader(employer())
    expect(md).toBe([
      '### Unity',
      '**Snr. Program Manager** · Jan 2015 – Jun 2017, Jan 2019 – present',
      '',
      '_Three roles at Unity (2015–2017, 2019–present): Program Manager → Technical Program Manager → Snr. Program Manager_',
    ].join('\n'))
    expect(md).not.toMatch(/promot/i)
  })

  it('omits the progression line for a single role', () => {
    expect(renderEmployerHeader(employer({ progression: null, stints: [{ start: '2019-01-01', end: null }] }))).toBe('### Unity\n**Snr. Program Manager** · Jan 2019 – present')
  })

  it('renders a header-only employer as the heading alone: no summary, no block', () => {
    const md = renderHeaderOnlyEmployer(employer({ headerOnly: true }))
    expect(md).toBe(renderEmployerHeader(employer()))
    expect(md).not.toContain(':::')
  })

  it('wraps the writer text with the code-rendered heading', () => {
    const md = renderEmployerEntry(employer({ progression: null }), 'Ran the platform org.', ['Cut release time by 40%.', 'Shipped 12 titles.'])
    expect(md).toContain('### Unity\n**Snr. Program Manager**')
    expect(md).toContain('\n\nRan the platform org.\n\n:::compact-list\n- Cut release time by 40%.\n- Shipped 12 titles.\n:::')
  })
})

describe('renderCertifications', () => {
  const cert = (over: object) => ({ id: 'c', name: 'PMP', issuer: 'PMI', issueDate: new Date('2018-05-01T00:00:00Z'), expiryDate: null, ...over })
  const now = new Date('2026-11-18T00:00:00Z')

  it('renders held certifications in the given order with the stored year', () => {
    const r = renderCertifications([cert({ name: 'B', issueDate: new Date('2020-01-01T00:00:00Z') }), cert({})], now)
    expect(r.markdown).toBe('- **B** — PMI (2020)\n- **PMP** — PMI (2018)')
    expect(r.notes).toEqual([])
  })

  it('writes a certification issued in the future as (in progress), never as held', () => {
    const r = renderCertifications([cert({ name: 'SAFe', issuer: 'Scaled Agile', issueDate: new Date('2099-01-01T00:00:00Z') })], now)
    expect(r.markdown).toBe('- **SAFe** — Scaled Agile (2099, in progress)')
    expect(r.notes).toEqual(['"SAFe" is shown as in progress.'])
  })

  it('keeps the profile wording and does not double the marker', () => {
    expect(renderCertifications([cert({ name: 'CISSP (in progress)', issueDate: null })], now).markdown).toBe('- **CISSP (in progress)** — PMI')
    expect(renderCertifications([cert({ name: 'CISSP, studying', issueDate: null })], now).markdown).toBe('- **CISSP, studying** — PMI (in progress)')
  })

  it('shows an undated certification without a date', () => {
    expect(renderCertifications([cert({ issueDate: null, issuer: null })], now).markdown).toBe('- **PMP**')
  })
})

describe('renderEducation', () => {
  const edu = (over: object) => ({ id: 'e', institution: 'Example University', qualification: 'MSc', field: 'Supply chain', startDate: new Date('2012-09-01T00:00:00Z'), endDate: new Date('2014-06-01T00:00:00Z'), grade: null, ...over })
  const now = new Date('2026-11-18T00:00:00Z')

  it('renders a completed entry with its stored years', () => {
    expect(renderEducation([edu({ grade: 'Distinction' })], now).markdown).toBe('- **MSc in Supply chain** — Example University (2012 – 2014, Distinction)')
  })

  it('writes an entry with no end date as (in progress) and says why, never completed', () => {
    const r = renderEducation([edu({ endDate: null, field: null, qualification: 'MBA', institution: 'Open College', startDate: new Date('2025-09-01T00:00:00Z'), grade: 'First' })], now)
    expect(r.markdown).toBe('- **MBA** — Open College (from 2025, in progress)')
    expect(r.notes[0]).toMatch(/in progress because the profile has no end date/)
  })

  it('writes a future end date as in progress too', () => {
    expect(renderEducation([edu({ endDate: new Date('2027-06-01T00:00:00Z') })], now).markdown).toContain('(from 2012, in progress)')
  })
})

describe('lists', () => {
  it('renders languages as an inline list', () => {
    expect(renderLanguages([{ name: 'French', proficiency: 'Native' }, { name: 'English', proficiency: null }])).toBe(':::inline-list\n- French (Native)\n- English\n:::')
    expect(renderLanguages([])).toBe('')
  })

  it('renders each group under its label; a single unlabeled group is just the block', () => {
    expect(renderNameGroups([{ label: 'Delivery', names: ['A', 'B'] }, { label: 'Planning', names: ['C'] }], 'skills')).toBe(
      '**Delivery**\n\n:::skills\n- A\n- B\n:::\n\n**Planning**\n\n:::skills\n- C\n:::',
    )
    expect(renderNameGroups([{ label: null, names: ['Jira'] }], 'inline-list')).toBe(':::inline-list\n- Jira\n:::')
  })
})
