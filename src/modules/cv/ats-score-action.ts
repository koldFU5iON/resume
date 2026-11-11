'use server'

import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { completeStructured, type LlmAttribution } from '@/modules/llm/client'
import { newRunId } from '@/modules/llm/attribution'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { LLMError } from '@/modules/llm/errors'
import { parseCVContent } from './schema'
import { scoreATS } from './ats-score'
import {
  ATSInterpretationSchema,
  ImpliedKeywordsSchema,
  type ATSScoreResult,
  type ATSInterpretation,
} from './ats-score-schema'

type RunATSScoreResult =
  | { ok: true; result: ATSScoreResult }
  | { ok: false; error: 'not_found' | 'no_job_description' | 'no_cv_content' | 'not_configured' | string; message: string }

export async function runATSScore(cvDocumentId: string): Promise<RunATSScoreResult> {
  const { profile } = await requireProfile()

  const cvDoc = await prisma.cVDocument.findFirst({
    where: { id: cvDocumentId, profileId: profile.id },
    select: {
      generatedContent: true,
      jobDescription: true,
      jobApplicationId: true,
    },
  })

  if (!cvDoc) {
    return { ok: false, error: 'not_found', message: 'CV document not found.' }
  }

  // CVDocument.jobDescription is preferred; fall back to the linked JobApplication's JD.
  let jobDescription = cvDoc.jobDescription?.trim() ?? ''
  if (!jobDescription && cvDoc.jobApplicationId) {
    const jobApp = await prisma.jobApplication.findFirst({
      where: { id: cvDoc.jobApplicationId, profileId: profile.id },
      select: { jobDescription: true },
    })
    jobDescription = jobApp?.jobDescription?.trim() ?? ''
  }

  if (!jobDescription) {
    return {
      ok: false,
      error: 'no_job_description',
      message: 'No job description attached to this CV — ATS scoring requires a target job.',
    }
  }

  const cvContent = parseCVContent(cvDoc.generatedContent)
  if (cvContent.sections.length === 0) {
    return { ok: false, error: 'no_cv_content', message: 'CV has no content to score.' }
  }

  // Both model calls of this ATS check share one attribution (the job comes from the CV).
  const attribution: LlmAttribution = { cvDocumentId, runId: newRunId() }

  // Step 1: implied keyword expansion (small LLM call — non-fatal if it fails)
  let impliedKeywords: string[] = []
  try {
    const expansion = await completeStructured(
      profile.id,
      `Job Description:\n\n${jobDescription}`,
      ImpliedKeywordsSchema,
      {
        system: [
          'You are an ATS (Applicant Tracking System) expert.',
          'Given a job description, list 10–20 unstated/implied keywords that an ATS would',
          'typically score candidates against for this type of role.',
          'Include adjacent skills, common tool pairings, and role-typical competencies',
          'not explicitly mentioned in the JD.',
          'Do NOT include keywords already stated in the JD.',
        ].join(' '),
        feature: 'ats-keyword-expand',
        attribution,
        maxOutputTokens: 300,
        temperature: 0.1,
      },
    )
    impliedKeywords = expansion.object.keywords
  } catch {
    // Non-fatal — continue without implied keywords
  }

  // Step 2: deterministic scoring (always succeeds)
  const breakdown = scoreATS(cvContent, jobDescription, impliedKeywords)

  // Step 3: AI interpretation (non-fatal if LLM not configured or fails)
  let interpretation: ATSInterpretation | null = null
  try {
    const snapshot = await buildProfileSnapshot(profile.id)
    const profileText = serializeProfileForLLM(snapshot)

    const { dimensions: d } = breakdown
    const userMessage = [
      '== ATS SCORE BREAKDOWN ==',
      `Final score: ${breakdown.finalScore}/100 (${breakdown.label})`,
      '',
      `Keyword coverage (${Math.round(d.keywordCoverage.score)}/100)`,
      `  Missing required: ${d.keywordCoverage.missingRequired.join(', ') || 'none'}`,
      `  Missing preferred: ${d.keywordCoverage.missingPreferred.join(', ') || 'none'}`,
      `  Missing implied: ${d.keywordCoverage.missingImplied.join(', ') || 'none'}`,
      '',
      `Title alignment (${Math.round(d.titleAlignment.score)}/100)`,
      `  JD title: ${d.titleAlignment.jdTitle ?? 'not found'}`,
      `  CV title: ${d.titleAlignment.cvTitle ?? 'not found'}`,
      '',
      `Section completeness (${Math.round(d.sectionCompleteness.score)}/100)`,
      `  Missing: ${d.sectionCompleteness.missingSections.join(', ') || 'none'}`,
      '',
      `Seniority signal (${Math.round(d.senioritySignal.score)}/100)`,
      `  JD required years: ${d.senioritySignal.jdRequiredYears ?? 'not specified'}`,
      `  CV total years: ${d.senioritySignal.cvTotalYears.toFixed(1)}`,
      '',
      '== CANDIDATE PROFILE ==',
      profileText,
    ].join('\n')

    const result = await completeStructured(profile.id, userMessage, ATSInterpretationSchema, {
      system: [
        'You are an ATS scoring expert helping a candidate improve their CV.',
        'Analyse the provided score breakdown and candidate profile.',
        '1. Write a 2–3 sentence summary explaining the score — be specific, not generic.',
        '2. Write one sentence per dimension explaining its sub-score.',
        '3. Identify profileOpportunities: items in the candidate PROFILE not in the CV',
        '   that would improve the score. ONLY include items verifiably present in the',
        '   == CANDIDATE PROFILE == section. Do not invent skills the candidate lacks.',
      ].join(' '),
      feature: 'ats-interpret',
      attribution,
      maxOutputTokens: 600,
      temperature: 0.2,
    })
    interpretation = result.object
  } catch (err) {
    if (err instanceof LLMError && err.kind === 'not_configured') {
      return { ok: false, error: 'not_configured', message: err.message }
    }
    // Other LLM errors (rate limit, timeout, etc.): return score without interpretation
  }

  return { ok: true, result: { breakdown, interpretation, impliedKeywords } }
}
