import type { Candidates, CandidateEmployer, CandidateItem } from '../candidates'

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
  leadWith: ['Platform migration delivery'],
  emphasise: [{ item: 'Release management', why: 'core of the role' }],
  playDown: ['Early career support work'],
  positioning: 'A delivery lead who has done this before.',
  tone: 'plain and specific',
  budgets: { experiences: 4, skills: 12, tools: 10, competencies: 6, certifications: 4, education: 3, projects: 2 },
}
