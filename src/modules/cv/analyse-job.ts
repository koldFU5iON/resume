// Plain module — not a server action. Called from generate.ts (plain module).
// Adding 'use server' would break the generate.ts call path.
import { prisma } from '@/lib/db'
import { completeStructured, type LlmAttribution } from '@/modules/llm/client'
import { loadCVJobAnalysisPrompt, composeSystem } from '@/modules/llm/prompt-context'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { JobAnalysisSchema, type JobAnalysis } from '@/modules/jobs/schema'

export async function analyseJob(
  profileId: string,
  jobId: string,
  /** Extra attribution (e.g. the CV and run when called from CV generation); the job is always set. */
  attribution: Omit<LlmAttribution, 'jobApplicationId'> = {},
): Promise<JobAnalysis | null> {
  const job = await prisma.jobApplication.findFirst({
    where: { id: jobId, profileId },
    select: { id: true, title: true, company: true, jobDescription: true },
  })

  if (!job || !job.jobDescription?.trim()) return null

  try {
    const [snapshot, systemPrompt] = await Promise.all([
      buildProfileSnapshot(profileId),
      loadCVJobAnalysisPrompt(profileId),
    ])

    const userMessage = [
      `== JOB TARGET ==`,
      `Role: ${job.title} at ${job.company}`,
      '',
      job.jobDescription,
      '',
      '== CANDIDATE PROFILE ==',
      serializeProfileForLLM(snapshot),
    ].join('\n')

    const result = await completeStructured(profileId, userMessage, JobAnalysisSchema, {
      // Analysis-only pass: user writing brief and style rules are intentionally excluded.
      // Tone/voice constraints belong in the CV draft step, not the analysis step.
      system: composeSystem(systemPrompt),
      feature: 'cv-job-analysis',
      attribution: { ...attribution, jobApplicationId: job.id },
      // Structured extraction: runs on the user's fast model. 800 tokens truncated the
      // JSON most days (#359); the list caps in the schema descriptions keep output well under 3000.
      role: 'fast',
      maxOutputTokens: 3000,
      temperature: 0.2,
    })

    // revalidatePath is not called here — plain modules cannot call it in Next.js 16.
    // Callers that render a page handle their own revalidation.
    await prisma.jobApplication.update({
      where: { id: jobId, profileId },
      data: { jobAnalysis: result.object, jobAnalysedAt: new Date() },
    })

    return result.object
  } catch (err) {
    console.error('[analyseJob] failed', err)
    return null
  }
}
