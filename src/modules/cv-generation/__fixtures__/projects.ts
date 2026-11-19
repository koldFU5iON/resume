import { projectRow } from './write'

/** A project-owned achievement row (profile-map fixture shape). */
export const atomRow = (id: string, description: string, impact: string | null = null, over: object = {}) => ({
  id, profileId: 'p1', experienceId: null, kind: 'achievement', description, impact, highlighted: false, order: 0,
  createdAt: new Date(0), updatedAt: new Date(0), skills: [], ...over,
})

/** Shape (a): empty description, markdown notes with Problem / Solution / Results. */
export const NOTES_ONLY = [
  '## Problem', '',
  'Support staff answered the same [[Billing]] questions by hand every week.', '',
  '## Solution', '',
  'I built a **self-service** assistant that answers the common questions.', '',
  '## Results', '',
  '- Handled ~1,400 requests in the first quarter without a person.',
  '- Staff time on routine questions fell sharply.',
].join('\n')

const L = (i: number) => String.fromCharCode(97 + (i % 26)).repeat(3)

/** Shape (b): a 7k notes body with an "Outcomes and Metrics" block deep inside. */
export const LONG_NOTES = [
  'This programme rebuilt how campaign pages are produced for a public information service. It ran across several teams.',
  '',
  '## Background',
  ...Array.from({ length: 40 }, (_, i) => `Background paragraph ${L(i)} describes the team structure, the tooling choices and the way meetings were scheduled across the groups involved.`),
  '',
  '## Outcomes and Metrics',
  'Reach grew to 2.4M people across the campaign.',
  'Click-through rate was 3.8% on the main call to action.',
  'Turnaround fell from 3 weeks to 1 hour.',
  'Lead time was cut by 75%.',
  '',
  '## Retrospective',
  ...Array.from({ length: 30 }, (_, i) => `Retrospective note ${L(i)} records a discussion that did not change any decision about the plan.`),
].join('\n')

export const SHAPE_A = projectRow('pa', 'Support Assistant', '', { experienceId: 'e-u2', notes: NOTES_ONLY })
export const ATOMS_B = [
  atomRow('pb-a1', 'Built the campaign platform used by every team'),
  atomRow('pb-a2', 'Rebuilt the operating model', 'turnaround 3 weeks to 1 hour, a 75% lead-time cut'),
  atomRow('pb-a3', 'Reached 2.4M people, including registered voters'),
  atomRow('pb-a4', 'Lifted click-through rate to 3.8%'),
  atomRow('pb-a5', 'Led cross-functional delivery across five teams'),
]
export const SHAPE_B = projectRow('pbk', 'Campaign Platform', 'A platform for producing public campaign pages quickly and consistently.', { experienceId: 'e-u2', notes: LONG_NOTES, activities: ATOMS_B })
export const SHAPE_TITLE = projectRow('pt', 'Atlas', 'Atlas.', { experienceId: 'e-u2' })
