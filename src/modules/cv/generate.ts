import { prisma } from '@/lib/db'
import { complete } from '@/modules/llm/client'
import { loadWritingContext, loadCVPrompt, composeSystem } from '@/modules/llm/prompt-context'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { CVDocumentContentSchema, parseCVContent, type CVDocumentContent } from './schema'
import { analyseJob } from './analyse-job'
import { scoreEvidence, applyRoleBudgets } from './score-evidence'
import { scanCV } from './scan-cv'
import { JobAnalysisSchema, type JobAnalysis } from '@/modules/jobs/schema'
import { buildATSContext, formatATSContext } from './ats-context'
import type { ATSContextResult } from './ats-context-schema'

const SCHEMA_HINT = `
Section types and their data shapes:
- header:        { name, headline, subHeadline?, location?, contact: { email?, phone?, linkedin?, website? } }
- profile:       { content }  -- prose, Markdown allowed
- competencies:  { items: string[] }
- capabilities:  { items: string[] }
- experience:    { company, titles: string[], location, duration, description, outcomes: string[] }
- education:     { institution, qualification, field?, duration, grade? }
- certification: { name, issuer?, date?, url? }
- skills:        { items: string[] }
- tools:         { items: string[] }
- languages:     { items: [{ name, proficiency }] }
`

function formatAnalysisContext(analysis: JobAnalysis): string {
  const risks = analysis.risks
    .map(r => `  - [${r.severity.toUpperCase()}] ${r.risk} → ${r.recommendation}`)
    .join('\n')

  return [
    '== JOB INTELLIGENCE ==',
    `Must-have: ${analysis.mustHave.join(', ')}`,
    `Nice-to-have: ${analysis.niceToHave.join(', ')}`,
    `Hiring risks:\n${risks}`,
    `Positioning: ${analysis.positioningStrategy}`,
  ].join('\n')
}

export async function generateCVContent(
  profileId: string,
  jobApplicationId?: string,
): Promise<CVDocumentContent> {
  const [snapshot, { rules, brief }, cvPrompt, jobApp] = await Promise.all([
    buildProfileSnapshot(profileId),
    loadWritingContext(profileId),
    loadCVPrompt(),
    jobApplicationId
      ? prisma.jobApplication.findFirst({
          where: { id: jobApplicationId, profileId },
          select: { jobDescription: true, title: true, company: true, jobAnalysis: true },
        })
      : Promise.resolve(null),
  ])

  let jobContext: string
  let analysis: JobAnalysis | null = null

  if (jobApp?.jobDescription) {
    const parsed = jobApp.jobAnalysis
      ? JobAnalysisSchema.safeParse(jobApp.jobAnalysis)
      : null
    analysis = parsed?.success ? parsed.data : await analyseJob(profileId, jobApplicationId!)

    jobContext = [
      `== JOB TARGET ==`,
      `Role: ${jobApp.title} at ${jobApp.company}`,
      '',
      jobApp.jobDescription,
    ].join('\n')
  } else {
    jobContext = `== MODE: GENERIC CV ==\nNo specific job target. Include all significant experience.`
  }

  // Pre-filter the snapshot before it reaches the generation prompt.
  // Job-targeted: LLM scores and ranks activities by relevance, then applies role budgets.
  // Generic: role budgets applied deterministically (no LLM call).
  const filteredSnapshot = analysis
    ? await scoreEvidence(profileId, snapshot, analysis)
    : applyRoleBudgets(snapshot)

  // Serialize both snapshots:
  // fullProfileText — used for ATS keyword matching (all skills/tools considered)
  // profileText — used in the generation prompt (evidence-scored, filtered for this role)
  const fullProfileText = serializeProfileForLLM(snapshot)
  const profileText = serializeProfileForLLM(filteredSnapshot)

  // ATS keyword context: extract JD terms and match against full profile.
  // Non-fatal — if the call throws, generation continues without keyword uplift.
  let atsContext: ATSContextResult | null = null
  if (jobApp?.jobDescription) {
    try {
      atsContext = await buildATSContext(profileId, jobApp.jobDescription, fullProfileText)
    } catch {
      // continue without ATS context
    }
  }

  const userMessage = [
    jobContext,
    analysis ? formatAnalysisContext(analysis) : null,
    atsContext ? formatATSContext(atsContext) : null,
    '',
    '== CANDIDATE PROFILE ==',
    profileText,
    '',
    '== OUTPUT SCHEMA ==',
    SCHEMA_HINT,
  ].filter((p): p is string => p !== null).join('\n')

  const result = await complete(profileId, userMessage, {
    system: composeSystem(rules, brief, cvPrompt),
    feature: 'cv-generate',
    maxOutputTokens: 4000,
    temperature: 0.3,
  })

  const jsonMatch = result.text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = jsonMatch ? jsonMatch[1].trim() : result.text.trim()

  const parsed = CVDocumentContentSchema.safeParse(JSON.parse(raw))
  const cvContent = parsed.success ? parsed.data : parseCVContent(raw)

  // Fire-and-forget: log recruiter scan results for generation quality monitoring.
  // Errors are swallowed — the scan never blocks the CV being returned.
  scanCV(profileId, cvContent, analysis?.positioningStrategy, analysis?.mustHave).then(scan => {
    if (scan) {
      console.info('[generateCVContent] recruiter scan', {
        positioningMatch: scan.positioningMatch,
        takeaways: scan.takeaways,
        gaps: scan.gaps,
      })
    }
  }).catch(err => console.error('[generateCVContent] scan failed', err))

  return cvContent
}
