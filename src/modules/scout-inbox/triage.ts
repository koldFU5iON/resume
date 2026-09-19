import * as z from 'zod'
import { prisma } from '@/lib/db'
import { completeStructured } from '@/modules/llm/client'
import { LLMError } from '@/modules/llm/errors'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { loadWritingRules, composeSystem } from '@/modules/llm/prompt-context'
import { JobFitSchema } from '@/modules/jobs/schema'
import { normalizeSearchProfile } from '@/modules/search-profile/schema'

const ScoutAssessmentSchema = z.object({
  fit: JobFitSchema,
  hardConstraintsMet: z.boolean().describe('False if the role has an explicit must-have requirement the candidate lacks.'),
  logisticalViable: z.boolean().describe('False if location, work authorization, seniority, or compensation clearly rules the role out.'),
  evidenceStrength: z.enum(['weak', 'moderate', 'strong']),
  careerDirection: z.enum(['misaligned', 'adjacent', 'aligned']),
  confidence: z.enum(['low', 'medium', 'high']),
})

function contributorFeedback(verdict: 'PRIORITY' | 'REVIEW' | 'PASS'): string {
  if (verdict === 'PRIORITY') return 'Strong match. It has been sent for review.'
  if (verdict === 'REVIEW') return 'Potential match. It has been sent for review.'
  return 'Thanks for sharing. This one is not being added for review.'
}

function selectVerdict(assessment: z.infer<typeof ScoutAssessmentSchema>): 'PRIORITY' | 'REVIEW' | 'PASS' {
  if (!assessment.hardConstraintsMet || !assessment.logisticalViable) return 'PASS'
  if (assessment.evidenceStrength === 'weak' || assessment.careerDirection === 'misaligned') return 'PASS'
  if (
    assessment.fit.rating >= 8 &&
    assessment.evidenceStrength === 'strong' &&
    assessment.careerDirection === 'aligned' &&
    assessment.confidence === 'high'
  ) return 'PRIORITY'
  return 'REVIEW'
}

export const selectScoutVerdictForTest = selectVerdict

export async function triageScoutSubmission(submissionId: string): Promise<void> {
  const claimed = await prisma.discoveredJob.updateMany({
    where: { id: submissionId, source: 'SCOUT', triageStatus: 'PENDING' },
    data: { triageStatus: 'PROCESSING' },
  })
  if (claimed.count === 0) return

  const job = await prisma.discoveredJob.findFirst({
    where: { id: submissionId, source: 'SCOUT' },
    select: { id: true, profileId: true, title: true, company: true, description: true },
  })
  if (!job?.description?.trim()) {
    await prisma.discoveredJob.update({
      where: { id: submissionId },
      data: { triageStatus: 'COMPLETE', scoutVerdict: 'REVIEW', scoutFeedback: contributorFeedback('REVIEW'), triagedAt: new Date() },
    })
    return
  }

  try {
    const [snapshot, settings, rules] = await Promise.all([
      buildProfileSnapshot(job.profileId),
      prisma.userSettings.findUnique({ where: { profileId: job.profileId }, select: { searchProfile: true, writingBrief: true } }),
      loadWritingRules(job.profileId),
    ])
    const search = normalizeSearchProfile(settings?.searchProfile)
    const searchContext = [
      search.roles.length ? `Target roles: ${search.roles.join(', ')}` : '',
      search.countries.length ? `Preferred countries: ${search.countries.join(', ')}` : '',
      search.remotePreference ? `Remote preference: ${search.remotePreference}` : '',
      search.careerGoals ? `Career goals: ${search.careerGoals}` : '',
      search.pivotContext ? `Career context: ${search.pivotContext}` : '',
    ].filter(Boolean).join('\n')
    const system = composeSystem(rules, settings?.writingBrief ?? null, `Assess this role conservatively. Apply hard role requirements and logistical viability before fit score. Never infer qualifications not present in the candidate profile.`)
    const result = await completeStructured(job.profileId, `# Candidate\n${serializeProfileForLLM(snapshot)}\n\n# Role\n${job.title} at ${job.company}\n\n${job.description}\n\n# Search context\n${searchContext || 'None provided'}\n\nReturn the assessment object.`, ScoutAssessmentSchema, {
      system,
      feature: 'scout-triage',
      maxOutputTokens: 750,
      temperature: 0.1,
    })
    const verdict = selectVerdict(result.object)
    await prisma.discoveredJob.update({
      where: { id: submissionId },
      data: {
        fitScore: result.object.fit.rating,
        fitLabel: result.object.fit.label,
        fitJustification: result.object.fit.justification,
        status: 'scored',
        triageStatus: 'COMPLETE',
        scoutVerdict: verdict,
        scoutFeedback: contributorFeedback(verdict),
        triagedAt: new Date(),
      },
    })
  } catch (error) {
    const message = error instanceof LLMError ? error.message : 'Triage failed'
    console.error('[scout-triage] failed', submissionId, message)
    await prisma.discoveredJob.update({
      where: { id: submissionId },
      data: { triageStatus: 'FAILED' },
    })
  }
}
