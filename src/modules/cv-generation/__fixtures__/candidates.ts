import type { Candidates, CandidateEmployer, CandidateItem } from '../candidates'
import { deriveItemName } from '../schema'

/** Lead-with items from plain sentences, the way an OLD stored brief reads (name derived from the text). */
export const leads = (items: readonly string[]) => items.map((framing) => ({ name: deriveItemName(framing), framing }))
/** An emphasise item from the old `{ item, why }` pair. */
export const em = (item: string, why = '') => ({ name: deriveItemName(item), framing: item, why })

const item = (id: string, label: string, over: Partial<CandidateItem> = {}): CandidateItem => ({ id, label, detail: null, proven: true, ...over })

/**
 * `employers` employers (newest first), each with one role of `acts` activities
 * (ids e0a0...), and a spread of flat items. The employer key is `co-<n>`; the
 * role's experience id is `e<n>`.
 */
export function bigCandidates(employers = 6, acts = 8, flat = 15): Candidates {
  return {
    employers: Array.from({ length: employers }, (_, r): CandidateEmployer => {
      const start = `${2024 - r * 2}-01-01`
      const end = r === 0 ? null : `${2025 - r * 2}-12-31`
      const role = { experienceId: `e${r}`, title: `Role ${r}`, start, end }
      return {
        key: `co-${r}`,
        company: `Co ${r}`,
        latestTitle: `Role ${r}`,
        label: `Role ${r} — Co ${r}`,
        period: null,
        start,
        end,
        stints: [{ start, end }],
        roles: [role],
        progression: null,
        activities: Array.from({ length: acts }, (_, a) => ({
          id: `e${r}a${a}`,
          experienceId: `e${r}`,
          kind: a % 2 === 0 ? 'achievement' as const : 'responsibility' as const,
          text: `Activity ${a} of role ${r}`,
          impact: null,
          highlighted: false,
        })),
      }
    }),
    skills: Array.from({ length: flat }, (_, i) => item(`s${i}`, `Skill ${i}`)),
    tools: Array.from({ length: flat }, (_, i) => item(`t${i}`, `Tool ${i}`)),
    competencies: Array.from({ length: flat }, (_, i) => item(`c${i}`, `Competency ${i}`)),
    certifications: Array.from({ length: flat }, (_, i) => item(`ce${i}`, `Cert ${i}`)),
    education: Array.from({ length: 5 }, (_, i) => item(`ed${i}`, `Degree ${i}`)),
    projects: Array.from({ length: 4 }, (_, i) => item(`p${i}`, `Project ${i}`)),
  }
}

export const brief = {
  hiddenQuestion: 'Can they ship a platform migration?',
  leadWith: [{ name: 'Platform migration', framing: 'Platform migration delivery' }],
  emphasise: [{ name: 'Release management', framing: 'Release management', why: 'core of the role' }],
  playDown: ['Early career support work'],
  positioning: 'A delivery lead who has done this before.',
  tone: 'plain and specific',
  budgets: { experiences: 4, skills: 12, tools: 10, competencies: 8, certifications: 6, education: 3, projects: 2 },
}
