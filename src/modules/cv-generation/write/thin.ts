/**
 * Thin project evidence: a selected project that has only a title (limits.ts
 * isThinProject). The Brief may still name it in `leadWith` with a framing
 * line, but that line is direction, not evidence: writing a bullet from it
 * invents an outcome. So a thin project gets no own bullet, the writer never
 * sees the framing line, the log says it was left out, and the coach gets one
 * deterministic "thin proof" concern (the owner must add detail to the project
 * in the profile). Pure: no DB, no network, no model.
 */

import type { CvBrief, CvReview, ConcernRecord } from '../schema'
import { thinLeadWithProjects } from './bullets'
import type { Evidence, ProjectEvidence } from './evidence'
import { isThinProject } from './limits'

/** The log note for a thin project. */
export function thinProjectNote(name: string): string {
  return `${name} has too little text to write from: left out; add detail to the project in your profile.`
}

/** Whether a project of an employer's evidence is thin. */
export const isThin = (p: Pick<ProjectEvidence, 'name' | 'text' | 'thin'>): boolean => p.thin ?? isThinProject(p)

/** The coach concerns for the thin projects the Brief leads with (kind weak_proof), in employer order. */
export function thinProjectConcerns(evidence: Pick<Evidence, 'employers'>, brief: Pick<CvBrief, 'leadWith'>): ConcernRecord[] {
  return evidence.employers.flatMap((e) => thinLeadWithProjects(e.projects, brief.leadWith)).map((l): ConcernRecord => ({
    kind: 'weak_proof',
    title: `${l.name} has too little detail to write from`,
    why: `The brief wants the CV to lead with it ("${l.line}"), but your profile gives only the project's title, so nothing about it was written.`,
    question: `What did you do on ${l.name}, and what was the result? Adding that to the project in your profile lets the CV lead with it.`,
    refs: [],
  }))
}

/** `review` with the thin-project concerns added (once each, and not when the reviewer already raised the project by name). Pure. */
export function withThinProjectConcerns(review: CvReview, evidence: Pick<Evidence, 'employers'>, brief: Pick<CvBrief, 'leadWith'>): CvReview {
  const have = review.concerns.map((c) => `${c.title} ${c.why} ${c.question}`.toLowerCase())
  const added = thinProjectConcerns(evidence, brief).filter((c) => {
    const name = c.title.replace(/ has too little detail to write from$/, '').toLowerCase()
    return !review.concerns.some((r, i) => r.kind === 'weak_proof' && have[i].includes(name))
  })
  return added.length > 0 ? { ...review, concerns: [...review.concerns, ...added] } : review
}
