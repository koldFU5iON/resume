import { describe, expect, it } from 'vitest'
import type { ProjectNote } from '@/modules/profile-map/types'
import { writeVault } from './__fixtures__/write'
import { ATOMS_B, LONG_NOTES, SHAPE_A, SHAPE_B, SHAPE_TITLE, atomRow } from './__fixtures__/projects'
import { digestNotes, projectEvidenceText } from './project-evidence'
import { PROJECT_EVIDENCE_MAX_CHARS } from './write/limits'

const vault = writeVault([SHAPE_A, SHAPE_B, SHAPE_TITLE])
const note = (id: string) => vault.notes.get(id) as ProjectNote

describe('projectEvidenceText', () => {
  it('uses the notes of a project with an empty description: not thin, wikilinks stripped, figure kept', () => {
    const r = projectEvidenceText(note('pa'), vault)
    expect(r.thin).toBe(false)
    expect(r.text).toContain('~1,400 requests')
    expect(r.text).toContain('Billing')
    expect(r.text).not.toContain('[[')
    expect(r.text).not.toMatch(/\*\*|^#/m)
  })

  it('digests a 7k notes body to the figure lines, under the cap', () => {
    const r = projectEvidenceText(note('pbk'), vault)
    expect(LONG_NOTES.length).toBeGreaterThan(7000)
    expect(r.text.length).toBeLessThanOrEqual(PROJECT_EVIDENCE_MAX_CHARS)
    for (const f of ['2.4M', '3.8%', '3 weeks to 1 hour', '75%']) expect(r.text).toContain(f)
    expect(r.text).not.toContain('Retrospective note 12')
    expect(r.text).toContain('A platform for producing')
    expect(r.atoms.map((a) => a.id).sort()).toEqual(ATOMS_B.map((a) => a.id).sort())
    expect(r.atoms[0].id).not.toBe('pb-a1')
    expect(r.text).toContain('turnaround 3 weeks to 1 hour')
  })

  it('is thin only for the title-only project', () => {
    expect(projectEvidenceText(note('pt'), vault).thin).toBe(true)
    expect(projectEvidenceText(note('pa'), vault).thin).toBe(false)
    expect(projectEvidenceText(note('pbk'), vault).thin).toBe(false)
  })

  it('leaves out excluded atoms from the text but keeps them in `atoms` and the thin verdict', () => {
    const r = projectEvidenceText(note('pbk'), vault, { excludeAtomIds: new Set(['pb-a2']) })
    expect(r.text).not.toContain('Rebuilt the operating model')
    expect(r.atoms.map((a) => a.id)).toContain('pb-a2')
  })

  it('does not repeat a notes line an atom already states', () => {
    const v = writeVault([{ ...SHAPE_B, activities: [atomRow('x1', 'Reach grew to 2.4M people across the campaign.')] }])
    const r = projectEvidenceText(v.notes.get('pbk') as ProjectNote, v)
    expect(r.text.match(/2\.4M/g)).toHaveLength(1)
  })
})

describe('digestNotes (property)', () => {
  const lines = (n: number, seed: number) =>
    Array.from({ length: n }, (_, i) => ((i * 7 + seed) % 3 === 0 ? `Grew revenue from ${i}0k to ${i + 5}.${seed}M, a ${i + seed}% rise.` : `Plain sentence number ${i} about nothing measurable at all, just words.`))
  it('never exceeds the cap and never cuts a figure', () => {
    for (const seed of [1, 2, 3, 4, 5]) for (const max of [200, 500, 1000, 2000]) {
      const body = lines(80 + seed * 20, seed).join('\n\n')
      const d = digestNotes(body, { max, exclude: [] })
      expect(d.length).toBeLessThanOrEqual(max)
      for (const m of d.matchAll(/\d[\d.,]*\s?(?:%|M|k)?/g)) expect(body).toContain(m[0].trim())
      for (const l of d.split('\n')) if (/\d/.test(l) && !l.endsWith('…')) expect(body).toContain(l.trim())
    }
  })
})
