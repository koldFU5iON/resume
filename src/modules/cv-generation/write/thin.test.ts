import { describe, expect, it } from 'vitest'
import { buildBriefFor } from '../__fixtures__/gathered'
import { projectRow, writeSelection, writeVault } from '../__fixtures__/write'
import type { CvReview } from '../schema'
import { evidenceFromVault } from './evidence'
import { thinProjectConcerns, thinProjectNote, withThinProjectConcerns } from './thin'
import { leads } from '../__fixtures__/candidates'

const NAME = 'Enemies Demo Campaign'
const FRAMING = `The ${NAME}: launch and GTM decision`
const evidenceFor = (text: string) => {
  const v = writeVault([projectRow('pa', NAME, text, { experienceId: 'e-u2' })])
  return evidenceFromVault(v, writeSelection(v, { projects: [{ id: 'pa', reason: '' }] }))
}
const review = (over: Partial<CvReview> = {}): CvReview => ({ skipped: false, skipReason: null, model: 'm', tokens: { input: 1, output: 1 }, costUsd: 0, applied: [], discarded: [], concerns: [], ...over })
const lead = buildBriefFor({ leadWith: leads([FRAMING]) })

describe('thin project helpers', () => {
  it('the log note names the project and says what to do', () => {
    expect(thinProjectNote(NAME)).toBe('Enemies Demo Campaign has too little text to write from: left out; add detail to the project in your profile.')
  })

  it('a thin lead-with project gets a weak_proof concern with a question for the owner', () => {
    const c = thinProjectConcerns(evidenceFor(`${NAME}:`), lead)
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ kind: 'weak_proof', title: `${NAME} has too little detail to write from`, refs: [] })
    expect(c[0].question).toContain(NAME)
    expect(c[0].why).toContain(FRAMING)
  })

  it('no concern for a project with real text, or a thin one the brief does not lead with', () => {
    expect(thinProjectConcerns(evidenceFor('Ran the demo campaign for the new title: a go-to-market and launch-timing decision, reaching 14,000+ players.'), lead)).toEqual([])
    expect(thinProjectConcerns(evidenceFor(''), buildBriefFor({ leadWith: leads([]) }))).toEqual([])
  })

  it('withThinProjectConcerns appends the concern when the review has none, even for a skipped review', () => {
    const r = withThinProjectConcerns(review({ skipped: true }), evidenceFor(''), lead)
    expect(r.concerns).toHaveLength(1)
    expect(r.skipped).toBe(true)
  })

  it('it does not duplicate a weak_proof concern the reviewer already raised about the project', () => {
    const raised = { kind: 'weak_proof' as const, title: `Thin proof for ${NAME}`, why: 'No outcome.', question: 'What happened?', refs: [] }
    const r = withThinProjectConcerns(review({ concerns: [raised] }), evidenceFor(''), lead)
    expect(r.concerns).toEqual([raised])
  })

  it('it keeps the reviewer\'s other concerns and returns the same object when nothing is added', () => {
    const other = { kind: 'evidence_gap' as const, title: 'No migration', why: '', question: 'q', refs: [] }
    expect(withThinProjectConcerns(review({ concerns: [other] }), evidenceFor(''), lead).concerns).toHaveLength(2)
    const none = review()
    expect(withThinProjectConcerns(none, evidenceFor(''), buildBriefFor({ leadWith: leads([]) }))).toBe(none)
  })
})
