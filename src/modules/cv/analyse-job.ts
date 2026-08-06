// Plain module — not a server action. Called from generate.ts (plain module) and
// job-fit.ts ('use server'). Adding 'use server' would break the generate.ts call path.
import { prisma } from '@/lib/db'
import { completeStructured } from '@/modules/llm/client'
import { loadCVJobAnalysisPrompt, composeSystem } from '@/modules/llm/prompt-context'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { JobAnalysisSchema, type JobAnalysis } from '@/modules/jobs/schema'

export async function analyseJob(
  profileId: string,
  jobId: string,
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
      maxOutputTokens: 800,
      temperature: 0.2,
    })

    // revalidatePath is not called here — plain modules cannot call it in Next.js 16.
    // The server action caller (job-fit.ts) handles revalidation for its own path.
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
