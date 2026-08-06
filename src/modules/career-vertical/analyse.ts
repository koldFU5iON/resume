// Plain module — not a server action. Called from actions.ts.
// Persists the upserted CareerVertical row; the caller handles revalidation.
import { prisma } from '@/lib/db'
import { completeStructured } from '@/modules/llm/client'
import { composeSystem, loadCareerVerticalPrompt, loadWritingContext } from '@/modules/llm/prompt-context'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { JobAnalysisSchema } from '@/modules/jobs/schema'
import { CareerVerticalAnalysisSchema, type CareerVerticalAnalysis } from './schema'

// Hard cap on roles per analysis — bounds the prompt size and token spend.
// Beyond this the common-thread signal plateaus; the cheapest wins.
const MAX_TARGET_ROLES = 30

export async function runCareerVerticalAnalysis(
  profileId: string,
  jobIds: string[],
): Promise<CareerVerticalAnalysis> {
  const ids = [...new Set(jobIds)].slice(0, MAX_TARGET_ROLES)

  const jobs = await prisma.jobApplication.findMany({
    where: { id: { in: ids }, profileId },
    select: { id: true, title: true, company: true, jobDescription: true, jobAnalysis: true },
    orderBy: { lastUpdated: 'desc' },
  })

  const targetJobs = jobs.filter(job => job.jobDescription?.trim())
  if (targetJobs.length === 0) {
    throw new Error('None of the selected jobs have a description to analyse')
  }

  const [snapshot, { rules, brief, searchProfileSummary }, systemPrompt] = await Promise.all([
    buildProfileSnapshot(profileId),
    loadWritingContext(profileId),
    loadCareerVerticalPrompt(profileId),
  ])

  const targetRoles = targetJobs
    .map((job, i) => {
      const parsed = job.jobAnalysis ? JobAnalysisSchema.safeParse(job.jobAnalysis) : null
      const analysis = parsed?.success ? parsed.data : null
      const lines = [
        `### Target role ${i + 1}: ${job.title}${job.company ? ` at ${job.company}` : ''}`,
        job.jobDescription!.trim(),
      ]
      if (analysis) {
        lines.push(
          '',
          'Existing per-role intelligence:',
          `- Must-have: ${analysis.mustHave.join(', ')}`,
          `- Nice-to-have: ${analysis.niceToHave.join(', ')}`,
          `- Positioning: ${analysis.positioningStrategy}`,
        )
      }
      return lines.join('\n')
    })
    .join('\n\n')

  const userMessage = [
    '== TARGET ROLES ==',
    targetRoles,
    '',
    '== CANDIDATE PROFILE ==',
    serializeProfileForLLM(snapshot),
    '',
    '== SEARCH CONTEXT ==',
    searchProfileSummary ?? brief ?? 'Not provided',
    '',
    'Return a single JSON object matching the schema.',
  ].join('\n')

  const result = await completeStructured(profileId, userMessage, CareerVerticalAnalysisSchema, {
    system: composeSystem(rules, brief, systemPrompt),
    feature: 'career-vertical-analyse',
    maxOutputTokens: 1200,
    temperature: 0.2,
  })

  const analysis = result.object

  const data = {
    thesis: analysis.thesis,
    businessProblems: analysis.businessProblems,
    responsibilities: analysis.responsibilities,
    outcomes: analysis.outcomes,
    competencies: analysis.competencies,
    sourceJobIds: targetJobs.map(job => job.id),
    status: 'ready',
    analysedAt: new Date(),
  }

  await prisma.careerVertical.upsert({
    where: { profileId },
    update: data,
    create: { profileId, ...data },
  })

  return analysis
}
