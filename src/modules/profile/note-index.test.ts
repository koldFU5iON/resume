import { describe, expect, it } from 'vitest'
import { areaHref, buildNoteIndex, findNote, noteHref, vaultNoteHref } from './note-index'

const profile = {
  experiences: [
    { id: 'old', role: 'Analyst', company: 'Acme', startDate: new Date('2012-03-01'), endDate: new Date('2015-06-01') },
    { id: 'new', role: 'Lead', company: 'Globex', startDate: new Date('2019-01-01'), endDate: null },
  ],
  projects: [
    { id: 'p2', name: 'Zeta', experienceId: null },
    { id: 'p1', name: 'Launch', experienceId: 'new' },
    { id: 'p3', name: 'Alpha', experienceId: null },
  ],
}

describe('buildNoteIndex', () => {
  it('lists roles newest first with their projects nested, and role-less projects by name', () => {
    const index = buildNoteIndex(profile)
    expect(index.experiences.map((e) => e.id)).toEqual(['new', 'old'])
    expect(index.experiences[0]).toEqual({ id: 'new', title: 'Lead, Globex', period: '2019–now', projects: [{ id: 'p1', name: 'Launch' }] })
    expect(index.experiences[1].period).toBe('2012–2015')
    expect(index.experiences[1].projects).toEqual([])
    expect(index.projects).toEqual([{ id: 'p3', name: 'Alpha' }, { id: 'p2', name: 'Zeta' }])
  })

  it('does not reorder the input', () => {
    const before = profile.experiences.map((e) => e.id)
    buildNoteIndex(profile)
    expect(profile.experiences.map((e) => e.id)).toEqual(before)
  })
})

describe('findNote', () => {
  it('knows the overview, roles and both kinds of project', () => {
    expect(findNote(profile, 'overview')).toEqual({ kind: 'overview' })
    expect(findNote(profile, 'new')).toEqual({ kind: 'experience', id: 'new' })
    expect(findNote(profile, 'p1')).toEqual({ kind: 'project', id: 'p1', experienceId: 'new' })
    expect(findNote(profile, 'p2')).toEqual({ kind: 'project', id: 'p2', experienceId: null })
  })

  it('is null for an id that is not this profile\'s', () => {
    expect(findNote(profile, 'someone-elses')).toBeNull()
  })
})

describe('where a vault note or gap area lands', () => {
  it('sends narrative notes to their page and evidence to its parent', () => {
    expect(vaultNoteHref({ type: 'experience', id: 'new' })).toBe(noteHref('new'))
    expect(vaultNoteHref({ type: 'project', id: 'p1' })).toBe(noteHref('p1'))
    expect(vaultNoteHref({ type: 'evidence', id: 'e1', props: { parentId: 'p1' } })).toBe(noteHref('p1'))
  })

  it('sends records to the Records pages and identity to the overview', () => {
    expect(vaultNoteHref({ type: 'capability', id: 'c' })).toBe('/dashboard/profile/records/capabilities')
    expect(vaultNoteHref({ type: 'certification', id: 'c' })).toBe('/dashboard/profile/records/credentials')
    expect(vaultNoteHref({ type: 'identity', id: 'i' })).toBe('/dashboard/profile/n/overview')
    expect(vaultNoteHref({ type: 'preferences', id: 'p' })).toBe('/dashboard/profile/n/overview')
  })

  it('routes a gap with no note by its area', () => {
    expect(areaHref('capability')).toBe('/dashboard/profile/records/capabilities')
    expect(areaHref('education')).toBe('/dashboard/profile/records/credentials')
    expect(areaHref('experience')).toBe('/dashboard/profile/n/overview')
  })
})
