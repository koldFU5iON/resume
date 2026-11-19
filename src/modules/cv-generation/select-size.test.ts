import { describe, expect, it } from 'vitest'
import { OUTPUT_FORMAT, SelectOutputSchema } from './select'
import { MAX_OUTPUT_TOKENS } from './schema'

/** Rough token estimate: characters / 4. */
const tokens = (v: unknown) => Math.ceil(JSON.stringify(v).length / 4)
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-0f3a9c2e-7b1d-4c58-9e6a-${String(i).padStart(12, '0')}`)

describe('Select answer size', () => {
  // Worst case: 4 employers, 20 bullets, 12 skills, 10 tools, 8 competencies, 6 certs, 2 projects, 2 education.
  const answer = {
    employers: ids('emp', 4).map((id, i) => ({ id, relevance: 5 - i })),
    activities: ids('act', 20),
    skills: ids('skill', 12),
    tools: ids('tool', 10),
    competencies: ids('comp', 8),
    certifications: ids('cert', 6),
    education: ids('edu', 2),
    projects: ids('proj', 2),
    emphasise: [{ item: 'Unity Awards', evidence: ids('act', 3) }, { item: 'Automation', evidence: ids('act', 2) }, { item: 'Launches', evidence: ids('act', 2) }],
  }

  it('keeps the worst-case answer well under the first-attempt cap', () => {
    expect(tokens(answer)).toBeLessThan(MAX_OUTPUT_TOKENS.select / 2)
    expect(tokens(answer)).toBeLessThan(4_000)
  })

  it('asks for ids only: no reason fields and no list of left-out items', () => {
    expect(OUTPUT_FORMAT).not.toContain('"reason"')
    expect(OUTPUT_FORMAT).not.toContain('"dropped"')
  })

  it('reads the asked-for shape into picks with an empty reason', () => {
    const out = SelectOutputSchema.parse(answer)
    expect(out.skills[0]).toEqual({ id: answer.skills[0], reason: '' })
    expect(out.employers[0]).toMatchObject({ id: answer.employers[0].id, relevance: 5 })
  })
})
