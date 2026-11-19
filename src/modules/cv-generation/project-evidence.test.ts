import { describe, expect, it } from 'vitest'
import type { ProjectNote } from '@/modules/profile-map/types'
import { writeVault } from './__fixtures__/write'
import { ATOMS_B, LONG_NOTES, SHAPE_A, SHAPE_B, SHAPE_TITLE, atomRow } from './__fixtures__/projects'
import { digestNotes, nearDuplicate, projectEvidenceText } from './project-evidence'
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

const projectWith = (description: string, notes = '', atoms: object[] = []) => {
  const v = writeVault([{ ...SHAPE_A, id: 'px', name: 'Neutral Project', description, notes, activities: atoms }])
  return projectEvidenceText(v.notes.get('px') as ProjectNote, v)
}
const filler = (n: number, tag = 'Filler') => Array.from({ length: n }, (_, i) => `${tag} sentence ${'abcdefghij'[i % 10].repeat(3)}${'klmnopqrst'[Math.floor(i / 10) % 10].repeat(2)} describes routine team activity at length.`)

describe('description handling', () => {
  it('keeps a figure near the end of a long description when there are no notes or atoms', () => {
    const desc = `${filler(24).join(' ')} Over the year revenue grew 47% to $9.1M.`
    expect(desc.length).toBeGreaterThan(1300)
    const r = projectWith(desc)
    expect(r.text).toContain('47%')
    expect(r.text).toContain('$9.1M')
    expect(r.text.length).toBeLessThanOrEqual(PROJECT_EVIDENCE_MAX_CHARS)
  })
  it('keeps figure sentences when a description must be cut', () => {
    const desc = `Lead sentence about the work. ${filler(60).join(' ')} Revenue grew 47% to $9.1M.`
    expect(desc.length).toBeGreaterThan(PROJECT_EVIDENCE_MAX_CHARS)
    const r = projectWith(desc)
    expect(r.text).toContain('47%')
    expect(r.text.length).toBeLessThanOrEqual(PROJECT_EVIDENCE_MAX_CHARS)
  })
  it('builds the shown text once: one line, joined with em dashes, within the cap', () => {
    const r = projectEvidenceText(note('pbk'), vault)
    expect(r.text).not.toContain('\n')
    expect(r.text).toContain(' — ')
    expect(r.text.length).toBeLessThanOrEqual(PROJECT_EVIDENCE_MAX_CHARS)
  })
})

describe('notes without blank lines', () => {
  const tail = 'Revenue grew 40% to GBP 3.2M. Churn fell from 9% to 4%.'
  const body = (sep: string) => [...filler(50, 'Intro'), ...filler(25, 'Mid'), tail, ...filler(30, 'End')].join(sep)
  for (const [name, sep] of [['single newlines', '\n'], ['one line', ' ']] as const) {
    it(`keeps the figures after the lead (${name})`, () => {
      const b = body(sep)
      expect(b.length).toBeGreaterThan(6000)
      const r = projectWith('A short description of the project and its purpose for the team.', b)
      expect(r.text).toContain('40% to GBP 3.2M')
      expect(r.text).toContain('from 9% to 4%')
      expect(r.text.length).toBeLessThanOrEqual(PROJECT_EVIDENCE_MAX_CHARS)
    })
  }
  it('keeps the figures of one huge paragraph with no sentence ends', () => {
    const b = `${Array.from({ length: 400 }, (_, i) => `step ${'abcdefghij'[i % 10]}${'klmnopqrst'[Math.floor(i / 10) % 10]}`).join(' ')} then revenue grew 40% to 3.2M and churn fell from 9% to 4% overall`
    const r = projectWith('Short description of the project.', b)
    expect(r.text).toContain('40%')
    expect(r.text).toContain('9% to 4%')
  })
})

describe('digest rules', () => {
  it('drops a numbered list marker, so 60 steps are not all figures', () => {
    const steps = Array.from({ length: 60 }, (_, i) => `${i + 1}. Open the ${'abcdefghij'[i % 10]}${'klmnopqrst'[Math.floor(i / 10)]} form and check it carefully`).join('\n')
    const d = digestNotes(`Lead paragraph about onboarding.\n\n${steps}\n\nRevenue grew 40% to 3.2M.`, { max: 600 })
    expect(d).toContain('40%')
    expect(d).not.toMatch(/^\d+\. /m)
  })
  it('splits an over-budget Results line instead of skipping the section', () => {
    const items = Array.from({ length: 25 }, (_, i) => `metric ${'abcdefghij'[i % 10]}${'klmnopqrst'[Math.floor(i / 10)]} up ${i + 10}%`).join('; ')
    const d = digestNotes(`Lead paragraph.\n\n${filler(30).join(' ')}\n\n## Results\n\n${items}`, { max: 700 })
    expect(d).toMatch(/up \d+%/)
    expect(d.length).toBeLessThanOrEqual(700)
  })
  it('does not treat a bare year as a figure', () => {
    const d = digestNotes(`Lead paragraph.\n\n${filler(30).join(' ')}\n\nStarted in 2019. Reviewed in 2021.\n\nRevenue grew 40%.`, { max: 600 })
    expect(d).not.toContain('2019')
    expect(d).toContain('40%')
  })
  it('reads French, German and Spanish result headings', () => {
    for (const h of ['Résultats', 'Ergebnisse', 'Resultados']) {
      const d = digestNotes(`Lead paragraph.\n\n${filler(30).join(' ')}\n\n## ${h}\n\nThe tool is now trusted by the whole team.`, { max: 500 })
      expect(d, h).toContain('trusted by the whole team')
    }
  })
})

describe('near duplicates', () => {
  it('states each SHAPE_B figure once', () => {
    const t = projectEvidenceText(note('pbk'), vault).text
    for (const f of ['2.4M', '3.8%', '75%']) expect(t.match(new RegExp(f.replace('.', '\\.'), 'g')), f).toHaveLength(1)
    expect(t.match(/3 weeks to 1 hour/g)).toHaveLength(1)
  })
  it('keeps a notes sentence whose figures the short atom lacks', () => {
    const r = projectWith('A platform for pages.', 'We shipped the platform to 2.4M users and cut cost 30%.', [atomRow('s1', 'Shipped the platform')])
    expect(r.text).toContain('2.4M users')
  })
  it('nearDuplicate needs the same figures and stem overlap', () => {
    expect(nearDuplicate('Reached 2.4M people nationwide', 'Reach grew to 2.4M people across the country')).toBe(true)
    expect(nearDuplicate('Reached 2.4M people nationwide', 'Reached 3M people nationwide')).toBe(false)
    expect(nearDuplicate('Cut cost 30%', 'Hosted the annual awards show 30%')).toBe(false)
  })
})
