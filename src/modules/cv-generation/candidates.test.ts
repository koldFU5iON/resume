import { describe, expect, it } from 'vitest'
import { buildVault } from '@/modules/profile-map/build'
import { vaultSource } from '@/modules/profile-map/__fixtures__/source'
import { buildCandidates, candidatesToPrompt, labelIndex, profileOutline } from './candidates'

const vault = buildVault(vaultSource())

describe('buildCandidates', () => {
  const c = buildCandidates(vault)

  it('gives every item its database id', () => {
    expect(c.experiences.map((e) => e.id)).toEqual(['e1'])
    expect(c.experiences[0].activities.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(c.skills.map((s) => s.id).sort()).toEqual(['s1', 's2', 's3'])
    expect(c.tools.map((s) => s.id)).toEqual(['t2'])
    expect(c.competencies.map((s) => s.id)).toEqual(['c1'])
    expect(c.certifications.map((s) => s.id)).toEqual(['ce1'])
    expect(c.education.map((s) => s.id)).toEqual(['ed1'])
    expect(c.projects.map((s) => s.id)).toEqual(['pr1'])
  })

  it('leaves out archived projects', () => {
    const src = vaultSource()
    src.projects = [{ ...src.projects[0], status: 'archived' }]
    expect(buildCandidates(buildVault(src)).projects).toEqual([])
  })

  it('scrubs contact details from free text', () => {
    const src = vaultSource()
    src.experiences[0].activities[0].description = 'Cut release time, ask robin@example.test'
    const text = buildCandidates(buildVault(src)).experiences[0].activities[0].text
    expect(text).not.toContain('robin@example.test')
  })

  it('labels every candidate id', () => {
    const labels = labelIndex(c)
    expect(labels.get('e1')).toBe('Program Manager — Fictional Freight')
    expect(labels.get('a1')).toContain('Cut release time')
    expect(labels.get('ce1')).toBe('PMP')
  })
})

describe('prompt text', () => {
  const c = buildCandidates(vault)

  it('lists every id in square brackets for the Select prompt', () => {
    const text = candidatesToPrompt(c)
    for (const id of ['e1', 'a1', 'a2', 's1', 't2', 'c1', 'ce1', 'ed1', 'pr1']) expect(text).toContain(`[${id}]`)
  })

  it('outlines roles and names but not each activity', () => {
    const out = profileOutline('Program manager', c)
    expect(out).toContain('Program Manager — Fictional Freight')
    expect(out).toContain('2 activities, 1 achievements')
    expect(out).toContain('Skills:')
    expect(out).not.toContain('Cut release time')
  })
})
