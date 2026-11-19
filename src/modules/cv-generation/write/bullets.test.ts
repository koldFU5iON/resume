import { describe, expect, it } from 'vitest'
import { buildBriefFor } from '../__fixtures__/gathered'
import {
  LEAD_WITH_PROJECT_EXTRA_BULLETS, bulletAllowance, dedupeSummary, splitSentences, leadWithProjects, leadWithStanding, opensInPresentTense, playDownBullets, reflectsItem, repeatsSummary, shortened,
  thinLeadWithProjects, trimBullets, wrongTenseLines,
} from './bullets'
import { leads, em } from '../__fixtures__/candidates'

const brief = (over: Parameters<typeof buildBriefFor>[0] = {}) => buildBriefFor(over)
const SOLID = 'Ran the launch campaign for the new title, set the release window and measured the first-day result against plan.'
const emp = (activities: number, projects: Array<{ name: string; text?: string }>) => ({
  activities: Array.from({ length: activities }, (_, i) => ({ id: `a${i}` })) as never,
  projects: projects.map((p, i) => ({ id: `p${i}`, name: p.name, text: p.text ?? SOLID })),
})

describe('leadWithProjects', () => {
  it('matches a selected project named in a lead-with line, years and versions ignored, and keeps the line', () => {
    const lines = ['Platform migration delivery', 'The Enemies Demo Campaign: a go-to-market and launch-timing decision', 'Unity Awards']
    const r = leadWithProjects([{ name: 'Enemies Demo Campaign' }, { name: 'Unity Awards 2025' }, { name: 'Boot Camp' }], leads(lines))
    expect(r.map((l) => l.name)).toEqual(['Enemies Demo Campaign', 'Unity Awards 2025'])
    expect(r[0].line).toContain('go-to-market')
  })
  it('does not match on a shared generic word', () => {
    expect(leadWithProjects([{ name: 'Enemies Demo Campaign' }], leads(['Launch campaign delivery']))).toEqual([])
  })
})

describe('bulletAllowance', () => {
  it('is the allocation, and a project the brief does not lead with adds nothing', () => {
    expect(bulletAllowance(emp(6, [{ name: 'Unity Awards 2025' }]), brief({ leadWith: leads(['Platform migration delivery']) }))).toBe(6)
  })
  it('allows one more bullet for a lead-with project', () => {
    expect(LEAD_WITH_PROJECT_EXTRA_BULLETS).toBe(1)
    expect(bulletAllowance(emp(3, [{ name: 'Enemies Demo Campaign' }]), brief({ leadWith: leads(['Enemies Demo Campaign launch timing']) }))).toBe(4)
  })
  it('a thin lead-with project (title only) adds no bullet: there is no evidence to write it from', () => {
    expect(bulletAllowance(emp(3, [{ name: 'Enemies Demo Campaign', text: 'Enemies Demo Campaign:' }]), brief({ leadWith: leads(['Enemies Demo Campaign launch timing']) }))).toBe(3)
    expect(leadWithProjects(emp(3, [{ name: 'Enemies Demo Campaign', text: '' }]).projects, leads(['Enemies Demo Campaign launch timing']))).toEqual([])
    expect(thinLeadWithProjects(emp(3, [{ name: 'Enemies Demo Campaign', text: '' }]).projects, leads(['Enemies Demo Campaign launch timing']))).toMatchObject([{ name: 'Enemies Demo Campaign' }])
  })
  it('allows one bullet for an employer that has only project evidence, and none for an empty one', () => {
    expect(bulletAllowance(emp(0, [{ name: 'Side Gig' }]), brief())).toBe(1)
    expect(bulletAllowance(emp(0, []), brief())).toBe(0)
  })
})

describe('leadWithStanding', () => {
  const lead = { key: 'enemies demo campaign' }
  it('own: a bullet starts with the project', () => {
    expect(leadWithStanding(['Led the Enemies Demo Campaign, a launch-timing decision that reached 9.4M people.'], lead)).toBe('own')
  })
  it('trailing: the project is only a clause at the end of another bullet', () => {
    expect(leadWithStanding(['Drove 9.4M reach across social and press for the new title launch, including the Enemies Demo Campaign.'], lead)).toBe('trailing')
  })
  it('missing: no bullet names it', () => {
    expect(leadWithStanding(['Cut release time by 40%.'], lead)).toBe('missing')
  })
  it('own wins when one bullet is about it and another only mentions it', () => {
    expect(leadWithStanding(['Cut release time by 40% for the Enemies Demo Campaign.', 'Enemies Demo Campaign: chose the launch window.'], lead)).toBe('own')
  })
})

describe('trimBullets', () => {
  const b = brief({ leadWith: leads(['Platform migration delivery']), emphasise: [em('Release management', '')] })
  const bullets = [
    'Ran the quarterly planning cycle.',
    'Shipped twelve titles on schedule.',
    'Led platform migration delivery across eight teams.',
    'Owned release management for the studio.',
    'Kept the calendar.',
  ]
  it('keeps everything when within the allowance', () => {
    expect(trimBullets(bullets, b, [], 5)).toEqual({ bullets, trimmed: [] })
  })
  it('keeps bullets that reflect a lead-with or emphasise item first, then the writer order; kept bullets stay in the writer order', () => {
    const r = trimBullets(bullets, b, [], 3)
    expect(r.bullets).toEqual(['Ran the quarterly planning cycle.', 'Led platform migration delivery across eight teams.', 'Owned release management for the studio.'])
    expect(r.trimmed).toEqual(['Shipped twelve titles on schedule.', 'Kept the calendar.'])
  })
  it('with no bullet matching the brief it is the writer order', () => {
    const r = trimBullets(['One.', 'Two.', 'Three.', 'Four.'], b, [], 2)
    expect(r.bullets).toEqual(['One.', 'Two.'])
    expect(r.trimmed).toEqual(['Three.', 'Four.'])
  })
  it('keeps the own bullet of a lead-with project ahead of every other bullet', () => {
    const lb = brief({ leadWith: leads(['Enemies Demo Campaign launch timing']), emphasise: [em('Release management', '')] })
    const list = ['Owned release management for the studio.', 'Owned release management across teams.', 'Enemies Demo Campaign: chose the launch window.']
    const r = trimBullets(list, lb, [{ name: 'Enemies Demo Campaign' }], 2)
    expect(r.bullets).toContain('Enemies Demo Campaign: chose the launch window.')
    expect(r.bullets).toHaveLength(2)
  })
})

describe('reflectsItem', () => {
  it('needs two shared content words (one when the item has only one)', () => {
    expect(reflectsItem('Owned release management.', 'Release management')).toBe(true)
    expect(reflectsItem('Shipped releases weekly.', 'Release management')).toBe(false)
    expect(reflectsItem('Managed releases.', 'Release management')).toBe(true) // 5-letter stems: manag, relea
    expect(reflectsItem('Ran Unity Awards.', 'Unity Awards 2025 results', ['unity awards'])).toBe(true)
  })
})

describe('playDownBullets', () => {
  const b = brief({ leadWith: leads(['Platform migration delivery']), emphasise: [], playDown: ['React Router 7 and Prisma/PostgreSQL build detail'] })
  it('flags a bullet that IS the play-down item', () => {
    const r = playDownBullets(['Built the tracker on React Router 7 and Prisma/PostgreSQL with typed server actions.'], b)
    expect(r).toEqual([{ item: 'React Router 7 and Prisma/PostgreSQL build detail', index: 0 }])
  })
  it('lets it appear as a clause inside another bullet', () => {
    expect(playDownBullets(['Shipped the job tracker used by 40 people, built with React Router and Prisma.'], b)).toEqual([])
  })
  it('does not flag an unrelated bullet, or one that shares a single word', () => {
    expect(playDownBullets(['Cut release time by 40% across 8 teams.', 'Ran a React workshop for the team.'], b)).toEqual([])
  })
  it('ignores words the brief also asks to lead with', () => {
    const conflict = brief({ leadWith: leads(['React Router migration']), emphasise: [], playDown: ['React Router and Prisma detail'] })
    expect(playDownBullets(['Migrated to React Router for the studio.'], conflict)).toEqual([])
  })
})

describe('tense', () => {
  it.each(['Drives 14,000+ voters', 'Delivers 9.4M reach', 'Leads a team of 8', 'Manages the budget', 'Deploys weekly', 'Carries'.replace('Carries', 'Streamlines the process')])('"%s" opens in the present tense', (l) => {
    expect(opensInPresentTense(l)).toBe(true)
  })
  it.each(['Drove 14,000+ voters', 'Delivered 9.4M reach', 'Sales grew by 12%', 'Operations ran 24/7', 'Metrics improved', 'Business growth of 3x', 'Process mapping for 8 teams'])('"%s" is not flagged (past tense, or a noun)', (l) => {
    expect(opensInPresentTense(l)).toBe(false)
  })
  it('current role: only a bullet with a measured result is flagged; the summary and ongoing duties may be present tense', () => {
    const parts = { summary: 'Leads the platform org.', bullets: ['Drives 14,000+ voters to the community vote.', 'Manages the quarterly planning cycle.', 'Delivered 9.4M reach.'] }
    expect(wrongTenseLines(parts, true)).toEqual(['Drives 14,000+ voters to the community vote.'])
  })
  it('a finished role is past tense throughout: any present-tense opening is flagged, the summary too', () => {
    const parts = { summary: 'Leads the studio.', bullets: ['Manages the quarterly planning cycle.', 'Shipped 12 titles.'] }
    expect(wrongTenseLines(parts, false)).toEqual(['Leads the studio.', 'Manages the quarterly planning cycle.'])
  })
})

describe('shortened', () => {
  it('cuts a long text with an ellipsis and collapses whitespace', () => {
    expect(shortened('a  b\nc')).toBe('a b c')
    expect(shortened('x'.repeat(200), 20)).toHaveLength(20)
    expect(shortened('x'.repeat(200), 20).endsWith('…')).toBe(true)
  })
})

describe('repeatsSummary', () => {
  const summary = 'Directed international PR strategy across EMEA, Americas and APAC.'
  it('flags a near-verbatim copy of the summary, tense and punctuation aside', () => {
    expect(repeatsSummary('Directed international PR strategy across EMEA, Americas & APAC', summary)).toBe(true)
    expect(repeatsSummary('Direct international PR strategy for Americas and APAC', summary)).toBe(true)
  })
  it('does not flag a bullet with an outcome, a figure or its own content', () => {
    expect(repeatsSummary('Directed international PR strategy across EMEA, lifting coverage by 30%', summary)).toBe(false)
    expect(repeatsSummary('Cut platform release time across eight teams', summary)).toBe(false)
    expect(repeatsSummary('PR strategy', summary)).toBe(false)
  })
})

describe('dedupeSummary', () => {
  it('drops an overlapping whole sentence and keeps the rest', () => {
    expect(dedupeSummary('Directed international PR strategy for EMEA. Part of a small team.', ['Directed international PR strategy for EMEA']).summary).toBe('Part of a small team.')
  })

  it('never splits a number, a list or an abbreviation', () => {
    const num = dedupeSummary('Led partner marketing for 1,200 studios, directing international PR strategy across regions.', ['Directed international PR strategy across regions'])
    expect(num.summary).toBe('Led partner marketing for 1,200 studios.')
    const list = dedupeSummary('Directed international PR strategy across EMEA, Americas and APAC.', ['Directed international PR strategy across EMEA'])
    expect(list.summary).toBe('Directed international PR strategy across EMEA, Americas and APAC.')
    const lead = dedupeSummary('Directed international PR strategy across regions, owning a 12-person team.', ['Directed international PR strategy across regions'])
    expect(lead.summary).toBe('Directed international PR strategy across regions, owning a 12-person team.')
    expect(splitSentences('Worked at Acme Inc. on e.g. launches. Led J. Smith’s team vs. rivals.')).toEqual(['Worked at Acme Inc. on e.g. launches.', 'Led J. Smith’s team vs. rivals.'])
  })

  it('removes a sentence only when the bullet covers most of the SENTENCE', () => {
    const long = 'Directed international PR strategy across regions for 40 studios and three product lines. Part of a small team.'
    const r = dedupeSummary(long, ['Directed international PR strategy across regions'])
    expect(r.summary).toBe(long)
    expect(r.unresolved).toHaveLength(1)
  })

  it('keeps a one-sentence summary whole when nothing safe can go', () => {
    expect(dedupeSummary('Directed international PR strategy for EMEA.', ['Directed international PR strategy for EMEA'])).toMatchObject({ summary: 'Directed international PR strategy for EMEA.', removed: [], unresolved: ['Directed international PR strategy for EMEA'] })
  })
})
