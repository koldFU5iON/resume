import { splitFailedFeature } from '@/modules/job-assessment/usage-stats'

export const FEATURE_LABELS: Record<string, string> = {
  'job-fit': 'Job fit',
  'salary-estimate': 'Salary estimate',
  'job-extract': 'Job extract',
  'cv-import': 'CV import',
  'profile-summary': 'Profile summary',
  'profile-extract': 'Profile extract',
  'profile-evidence-links': 'Profile — evidence links',
  'cv-job-analysis': 'Job analysis',
  'cv-evidence-score': 'Evidence scoring',
  'cv-recruiter-scan': 'Recruiter scan',
  'cv-generate': 'CV generation',
  'cover-letter-analyse':      'Cover letter — analyse role',
  'cover-letter-architect':    'Cover letter — build message',
  'cover-letter-draft':        'Cover letter — write draft',
  'cover-letter-review-pass':  'Cover letter — review draft',
  'cover-letter-finalise':     'Cover letter — finalise',
  'cover-letter-build': 'Cover letter — build with me',
  'cover-letter-review': 'Cover letter — review',
  'interview-prep-doc-analysis':         'Interview prep — analyse document',
  'interview-prep-interviewer-analysis': 'Interview prep — analyse interviewer',
  'interview-prep-bulk-analysis':        'Interview prep — analyse all documents',
  'interview-prep-qa-generation':        'Interview prep — generate Q&A',
  'ats-keyword-expand':                   'ATS — keyword expansion',
  'ats-interpret':                        'ATS — interpretation',
  'ats-context':                          'ATS — keyword context',
  'career-vertical-analyse':              'Career vertical analysis',
  'master-cv-generate':                   'Master CV generation',
  'job-hunt-ats-discovery':              'Job hunt — ATS discovery',
  'job-hunt-fit':                        'Job hunt — fit score',
  'scout-triage':                        'Scout Inbox — triage',
  // Jev rows (verify/judge) are app-billed and excluded from this user page
  // (see getUserUsageSummary); the admin app-billed card reuses these labels.
  'job-assessment-verify':               'Early assessment — verify (Jev)',
  'job-assessment-judge':                'Early assessment — judge (Jev)',
  'job-assessment-enrich':               'Early assessment — fetch details',
  'job-assessment-facts':                'Early assessment — extract facts',
  'chat-turn':      'Chat — career coach',
  'chat-summarize': 'Chat — session summary',
}

/** Label for a usage feature tag; a failed app-billed call (`<feature>:failed`) gets " (failed)". */
export function featureLabel(feature: string): string {
  const { base, failed } = splitFailedFeature(feature)
  const label = FEATURE_LABELS[base] ?? base
  return failed ? `${label} (failed)` : label
}
