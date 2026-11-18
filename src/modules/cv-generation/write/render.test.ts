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

  it('leaves a certification with a PAST expiry date off the CV, with a log note', () => {
    const r = renderCertifications([cert({ name: 'ITIL 3', issueDate: new Date('2018-05-01T00:00:00Z'), expiryDate: new Date('2021-05-01T00:00:00Z') }), cert({})], now)
    expect(r.markdown).toBe('- **PMP** — PMI (2018)')
    expect(r.markdown).not.toMatch(/expires 2021|ITIL/)
    expect(r.notes).toEqual(['"ITIL 3" expired in 2021 and was left out.'])
  })

  it('renders nothing when every selected certification has expired', () => {
    const r = renderCertifications([cert({ expiryDate: new Date('2020-01-01T00:00:00Z') })], now)
    expect(r.markdown).toBe('')
    expect(r.notes[0]).toMatch(/expired in 2020 and was left out/)
  })

  it('a FUTURE expiry date is a held certification (not in progress)', () => {
    const r = renderCertifications([cert({ expiryDate: new Date('2030-05-01T00:00:00Z') })], now)
    expect(r.markdown).toBe('- **PMP** — PMI (2018, expires 2030)')
    expect(r.notes).toEqual([])
  })

  describe('weak certifications (no issuer, no date)', () => {
    const weak = (name: string, rank: number) => cert({ name, issueDate: null, expiryDate: null, issuer: null, rank })

    it('skips one that Select did not rank first, with a log note', () => {
      const r = renderCertifications([cert({ rank: 0 }), weak('React Front-End Course', 1)], now)
      expect(r.markdown).toBe('- **PMP** — PMI (2018)')
      expect(r.notes).toEqual(['"React Front-End Course" has no issuer and no date, and Select did not rank it first, so it was left out.'])
    })

    it('keeps one that Select ranked first', () => {
      expect(renderCertifications([weak('Product Marketing Course', 0), cert({ rank: 1 })], now).markdown).toBe('- **Product Marketing Course**\n- **PMP** — PMI (2018)')
    })

    it('never skips an in-progress one, whatever its rank (it has no date by nature)', () => {
      const r = renderCertifications([cert({ rank: 0 }), weak('PMP (in progress)', 2)], now)
      expect(r.markdown).toBe('- **PMP** — PMI (2018)\n- **PMP (in progress)**')
      expect(r.notes).toEqual(['"PMP (in progress)" is shown as in progress.'])
    })

    it('never skips one that has an issuer or a date', () => {
      const r = renderCertifications([cert({ rank: 0 }), cert({ name: 'Dated', issuer: null, rank: 2 }), cert({ name: 'Issued', issueDate: null, rank: 3 })], now)
      expect(r.markdown).toContain('**Dated** (2018)')
      expect(r.markdown).toContain('**Issued** — PMI')
      expect(r.notes).toEqual([])
    })
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

  it('writes a recent entry with no end date as (in progress) and says why, never completed', () => {
    const r = renderEducation([edu({ endDate: null, field: null, qualification: 'MBA', institution: 'Open College', startDate: new Date('2025-09-01T00:00:00Z'), grade: 'First' })], now)
    expect(r.markdown).toBe('- **MBA** — Open College (from 2025, in progress)')
    expect(r.notes[0]).toMatch(/in progress because it has no end date and started recently/)
    expect(r.checkNotes).toEqual([])
  })

  it('an old entry with no end date has NO span and NO status, and asks the owner for the end date', () => {
    const r = renderEducation([edu({ endDate: null, qualification: 'BA', field: 'History', institution: 'Old Uni', startDate: new Date('2005-09-01T00:00:00Z'), grade: 'First' })], now)
    expect(r.markdown).toBe('- **BA in History** — Old Uni')
    expect(r.markdown).not.toMatch(/in progress|2005|First|\(/)
    expect(r.checkNotes).toEqual([expect.stringMatching(/Education: "BA in History" has no end date in your profile.*Add the end date/)])
  })

  it('makes ONE check note for several entries without an end date', () => {
    const old = { endDate: null, startDate: new Date('2005-09-01T00:00:00Z') }
    const r = renderEducation([edu({ ...old, qualification: 'BA' }), edu({ ...old, qualification: 'MA' })], now)
    expect(r.checkNotes).toHaveLength(1)
    expect(r.checkNotes[0]).toMatch(/"BA in Supply chain", "MA in Supply chain" have no end date/)
  })

  it('the 6-year window is measured from now', () => {
    const start = (iso: string) => renderEducation([edu({ endDate: null, startDate: new Date(iso) })], now).markdown
    expect(start('2021-01-01T00:00:00Z')).toContain('in progress')
    expect(start('2020-06-01T00:00:00Z')).not.toContain('in progress')
  })

  it('wording in the qualification means in progress even for an old start', () => {
    expect(renderEducation([edu({ endDate: null, startDate: new Date('2005-09-01T00:00:00Z'), qualification: 'MBA (in progress)' })], now).markdown).toContain('from 2005')
  })

  it('writes a future end date as in progress too', () => {
    expect(renderEducation([edu({ endDate: new Date('2027-06-01T00:00:00Z') })], now).markdown).toContain('(from 2012, in progress)')
  })
})

describe('lists', () => {
  it('model text is cleaned wherever it is rendered: summary, bullets and group labels', () => {
    const md = renderEmployerEntry(employer({ progression: null }), '# Ran ::: [it](http://x.test)', ['- ![i](http://x.test/i.png)Cut cost.', '', '<b>Shipped</b> 12.'])
    expect(md).toContain('\n\nRan it\n\n:::compact-list\n- Cut cost.\n- Shipped 12.\n:::')
    expect(renderNameGroups([{ label: '**Delivery** ::: [x](http://y.test)', names: ['A'] }], 'skills')).toBe('**Delivery x**\n\n:::skills\n- A\n:::')
  })

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
