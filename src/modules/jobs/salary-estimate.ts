'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { completeStructured } from '@/modules/llm/client'
import { LLMError, type LLMErrorKind } from '@/modules/llm/errors'
import { normalizeSearchProfile } from '@/modules/search-profile/schema'
import { SalaryEstimateSchema, type SalaryEstimate } from './schema'

type EstimateSalaryResult =
  | { ok: true; estimate: SalaryEstimate }
  | { ok: false; error: 'no_description' | 'not_found' | LLMErrorKind; message: string }

export async function estimateSalary(jobId: string): Promise<EstimateSalaryResult> {
  const { profile } = await requireProfile()

  const [job, settings] = await Promise.all([
    prisma.jobApplication.findFirst({
      where: { id: jobId, profileId: profile.id },
      select: { id: true, countries: true, jobDescription: true },
    }),
    prisma.userSettings.findUnique({
      where: { profileId: profile.id },
      select: { searchProfile: true },
    }),
  ])

  if (!job) return { ok: false, error: 'not_found', message: 'Job not found' }
  if (!job.jobDescription?.trim()) {
    return {
      ok: false,
      error: 'no_description',
      message: 'Add a job description first — salary estimation needs it.',
    }
  }
  const searchProfile = normalizeSearchProfile(settings?.searchProfile)
  const userCurrency = searchProfile.salaryBand?.currency ?? 'GBP'

  const locationContext = job.countries?.join(', ') ?? ''

  const prompt = `You are a compensation analyst. Analyse this job description to determine the salary range.

**Step 1 — Scan for explicit salary information:**
Look for any stated salary, compensation, pay, or total cash (e.g. "$120,000–$150,000", "up to £80,000", "€90k base", "salary from 100k", etc.).

If found → return:
- source: "extracted"
- min and max from the stated range (use null if only one bound is given)
- currency from the stated symbol or code
- Omit confidence and reasoning

**Step 2 — If no salary is stated (or only vague language: "competitive", "market rate", "DOE", "TBC", "negotiable"):**
Estimate based on job title, seniority, company, location, and required skills. Return:
- source: "estimated"
- min and max as annual base salary in whole numbers
- currency inferred from the job's country/region (UK→GBP, US→USD, Canada→CAD, Germany/France/EU→EUR, Australia→AUD). The user's preferred currency (${userCurrency}) is a secondary hint only — if the job is clearly in a different market, use that market's currency.
- confidence: "high" (clear signals: well-known company, common role, explicit seniority), "medium" (reasonable inference), "low" (limited context)
- reasoning: 1–2 sentences explaining your estimate (≤80 words)
${locationContext ? `\n**Location context:** ${locationContext}` : ''}

**Job description:**
${job.jobDescription.slice(0, 4000)}`

  let estimate: SalaryEstimate
  try {
    const result = await completeStructured(profile.id, prompt, SalaryEstimateSchema, {
      maxOutputTokens: 300,
      temperature: 0.1,
      feature: 'salary-estimate',
    })
    estimate = result.object
  } catch (err) {
    if (err instanceof LLMError) {
      return { ok: false, error: err.kind, message: err.message }
    }
    throw err
  }

  await prisma.jobApplication.update({
    where: { id: jobId },
    data: { salaryEstimate: estimate, salaryEstimatedAt: new Date() },
  })

  revalidatePath('/dashboard/job-applications')
  revalidatePath(`/dashboard/job-applications/view/${jobId}`)

  return { ok: true, estimate }
}
