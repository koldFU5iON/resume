export type PromptGroup = 'rules' | 'cv' | 'cover-letter'

export type PromptDef = {
  key: string
  label: string
  description: string
  filename: string
  group: PromptGroup
  /**
   * Section markers that features inject into the user message. If an edited
   * prompt deletes a marker it references, that feature silently stops
   * engaging. Listed here so the UI can warn before the user saves.
   */
  requiredMarkers?: string[]
}

export const PROMPT_REGISTRY: PromptDef[] = [
  {
    key: 'writing-rules',
    label: 'Writing rules (shared)',
    description: 'Voice, tone, and accuracy rules applied to every AI-generated piece of writing.',
    filename: 'writing-rules.md',
    group: 'rules',
  },
  {
    key: 'cv-generate',
    label: 'CV generation',
    description: 'Main CV drafting prompt: evidence scoring, page budget, ATS keyword uplift, output contract.',
    filename: 'cv-generate.md',
    group: 'cv',
    requiredMarkers: [
      '== JOB INTELLIGENCE ==',
      '== CAREER VERTICAL CONTEXT ==',
      '== MASTER CV (CANONICAL NARRATIVE) ==',
      '== MODE: MASTER CV ==',
      '== CAREER VERTICAL ==',
      '== ATS KEYWORD UPLIFT ==',
    ],
  },
  {
    key: 'cv-job-analysis',
    label: 'CV job analysis',
    description: 'Analyses a job description against the profile and produces the intelligence report that directs CV writing.',
    filename: 'cv-job-analysis.md',
    group: 'cv',
  },
  {
    key: 'cv-evidence-score',
    label: 'CV evidence scoring',
    description: 'Scores each profile activity 1–10 and assigns a tier (must-include / useful-context / cut).',
    filename: 'cv-evidence-score.md',
    group: 'cv',
    requiredMarkers: ['== JOB INTELLIGENCE =='],
  },
  {
    key: 'cv-recruiter-scan',
    label: 'CV recruiter scan',
    description: 'Simulates a 15-second recruiter skim to check whether the CV surfaces its strongest evidence.',
    filename: 'cv-recruiter-scan.md',
    group: 'cv',
  },
  {
    key: 'cv-ats-context',
    label: 'CV ATS keyword context',
    description: 'Extracts ATS-parseable terms from the job description and classifies them as supported / adjacent / absent.',
    filename: 'cv-ats-context.md',
    group: 'cv',
  },
  {
    key: 'career-vertical',
    label: 'Career vertical analysis',
    description: 'Finds the recurring hiring pattern across target roles and expresses it as a career thesis.',
    filename: 'career-vertical.md',
    group: 'cv',
  },
  {
    key: 'cover-letter-generate',
    label: 'Cover letter generation',
    description: 'Writes a complete cover letter from the profile, tailored CV, and job description.',
    filename: 'cover-letter-generate.md',
    group: 'cover-letter',
  },
  {
    key: 'cover-letter-review',
    label: 'Cover letter review',
    description: 'Reviews an existing letter against the profile and job requirements.',
    filename: 'cover-letter-review.md',
    group: 'cover-letter',
  },
  {
    key: 'cl-stage1-analyse',
    label: 'Cover letter: role & candidate brief',
    description: 'Stage 1 of the guided pipeline — analyses the role and produces the strategic brief that gates the later stages.',
    filename: 'cl-stage1-analyse.md',
    group: 'cover-letter',
  },
  {
    key: 'cl-stage2-architecture',
    label: 'Cover letter: message architecture',
    description: 'Stage 2 — designs the message structure (hook, connection, proof) before any prose is written.',
    filename: 'cl-stage2-architecture.md',
    group: 'cover-letter',
  },
  {
    key: 'cl-stage3-draft',
    label: 'Cover letter: draft from architecture',
    description: 'Stage 3 — writes the prose, executing the architecture exactly.',
    filename: 'cl-stage3-draft.md',
    group: 'cover-letter',
  },
  {
    key: 'cl-stage4-review',
    label: 'Cover letter: structured review pass',
    description: 'Stage 4 — fresh review of the draft against the Stage 1 checklist.',
    filename: 'cl-stage4-review.md',
    group: 'cover-letter',
  },
  {
    key: 'cl-stage5-final',
    label: 'Cover letter: apply must-fix edits',
    description: 'Stage 5 — applies must-fix edits only and returns the final letter.',
    filename: 'cl-stage5-final.md',
    group: 'cover-letter',
  },
]

export const PROMPT_GROUP_LABELS: Record<PromptGroup, string> = {
  rules: 'Writing rules',
  cv: 'CV generation',
  'cover-letter': 'Cover letters',
}

export function getPromptDef(key: string): PromptDef | undefined {
  return PROMPT_REGISTRY.find(p => p.key === key)
}

export function isPromptKey(key: string): key is string {
  return PROMPT_REGISTRY.some(p => p.key === key)
}
