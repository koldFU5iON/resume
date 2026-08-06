'use server'

// First product feature on top of the LLM layer. Pattern is intentionally
// boring — every future AI feature (cover letter, CV refinement, interview
// prep) lands as a copy of this shape with a different schema + prompt.
//
// 1. gather inputs   ← prisma + buildProfileSnapshot
// 2. build prompt    ← markdown for the candidate + role
// 3. call LLM        ← completeStructured with a zod schema
// 4. persist         ← write the validated object to the row
// 5. return          ← discriminated union; UI handles ok vs error kinds
//
// Errors are normalized to the LLM layer's kinds. The action never re-throws
// LLMError — it returns a tagged result so the UI doesn't need try/catch.

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { completeStructured } from '@/modules/llm/client'
import { LLMError, type LLMErrorKind } from '@/modules/llm/errors'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { normalizeSearchProfile } from '@/modules/search-profile/schema'
import { emitSuggestion } from '@/modules/search-profile/actions'
import { loadWritingRules, composeSystem, type WritingContext } from '@/modules/llm/prompt-context'
import { JobFitSchema, type JobFit } from './schema'
import { analyseJob } from '@/modules/cv/analyse-job'

// Type is consumed internally only. Callers that need it import from
// '@/modules/jobs/schema' — re-exporting here breaks the 'use server'
// runtime even when using `export type`, because the SWC compiler still
// emits a value-level binding for the re-export.

type AssessJobFitResult =
  | { ok: true; fit: JobFit }
  | { ok: false; error: 'no_description'; message: string }
  | { ok: false; error: 'not_found'; message: string }
  | { ok: false; error: LLMErrorKind; message: string }

export async function assessJobFit(jobId: string): Promise<AssessJobFitResult> {
  const { profile } = await requireProfile()

  const job = await prisma.jobApplication.findFirst({
    where: { id: jobId, profileId: profile.id },
    select: { id: true, title: true, company: true, jobDescription: true, notes: true, notesIncludeInFit: true },
  })
  if (!job) {
    return { ok: false, error: 'not_found', message: 'Job not found' }
  }
  if (!job.jobDescription?.trim()) {
    return {
      ok: false,
      error: 'no_description',
      message: 'Add a job description first — assessment needs it to score against.',
    }
  }

  const [snapshot, settings, rules] = await Promise.all([
    buildProfileSnapshot(profile.id),
    prisma.userSettings.findUnique({
      where: { profileId: profile.id },
      select: { searchProfile: true, writingBrief: true },
    }),
    loadWritingRules(profile.id),
  ])

  const writingCtx: WritingContext = { rules, brief: settings?.writingBrief ?? null, searchProfileSummary: null }
  const context = normalizeSearchProfile(settings?.searchProfile)
  const hasGoals = !!(
    context.roles.length > 0 ||
    context.careerGoals ||
    context.pivotContext ||
    context.extraContext ||
    context.remotePreference ||
    context.countries.length > 0 ||
    context.salaryBand
  )
  const hasNotes = job.notesIncludeInFit && !!job.notes?.trim()

  const featureInstructions = `You are an experienced career coach assessing whether a candidate is a strong fit for a role.

Be honest and concrete. Overclaiming the candidate's fit makes them waste an interview slot; understating loses them an opportunity they could land. Calibrate the rating against real-world hiring bars:

- 0–2 (reach): missing core requirements; would be rejected at first screen.
- 3–4 (possible): partial overlap; would need an exceptional cover letter to advance.
- 5–6 (stretch): meets most requirements but has a meaningful gap; viable with strong story.
- 7–8 (solid): strong baseline match; can credibly compete in interviews.
- 9–10 (standout): unusually well-aligned across role, level, and stack.

Ground your justification in specific evidence from both sides — name technologies, scope, level — rather than generic praise.${hasGoals ? '\n\nWhen a # Search context section is provided, populate trajectoryNote with 1–2 sentences covering: (1) how the role aligns or diverges from the candidate\'s stated direction, (2) any location or remote-working mismatch, and (3) whether salary appears within band if visible in the JD. Omit the field entirely when no search context is provided.' : ''}`

  const system = composeSystem(writingCtx.rules, writingCtx.brief, featureInstructions)

  let userPrompt = `# Candidate

${serializeProfileForLLM(snapshot)}

# Role

**${job.title}** at ${job.company}

${job.jobDescription}`

  if (hasGoals) {
    userPrompt += '\n\n# Search context\n'
    if (context.roles.length > 0)     userPrompt += `\n**Target roles:** ${context.roles.join(', ')}`
    if (context.remotePreference)      userPrompt += `\n**Remote preference:** ${context.remotePreference}`
    if (context.countries.length > 0)  userPrompt += `\n**Countries:** ${context.countries.join(', ')}`
    if (context.salaryBand) {
      const { min, max, currency } = context.salaryBand
      const range = [min && `${currency} ${min.toLocaleString()}`, max && `${currency} ${max.toLocaleString()}`]
        .filter(Boolean).join('–')
      if (range) userPrompt += `\n**Salary band:** ${range}`
    }
    if (context.careerGoals)           userPrompt += `\n**Career goals:** ${context.careerGoals}`
    if (context.pivotContext)          userPrompt += `\n**Career change context:** ${context.pivotContext}`
    if (context.extraContext)          userPrompt += `\n**Additional context:** ${context.extraContext}`
  }

  if (hasNotes) {
    // User-controlled content — unsanitized intentionally. Injection here only affects
    // the user's own assessment on their own API key; there is no cross-user risk.
    userPrompt += `\n\n# Personal Notes\n\n${job.notes}`
  }

  userPrompt += `\n\nReturn a single JSON object matching the schema. In the justification, write markdown: a **Strengths:** section and a **Weaknesses:** section (exactly 2 bullets each, one concise sentence per bullet — no paragraph prose), then one sentence of overall summary.${hasGoals ? ' One sentence in trajectoryNote.' : ''}`

  let fit: JobFit
  try {
    const result = await completeStructured(profile.id, userPrompt, JobFitSchema, {
      system,
      maxOutputTokens: 700,
      temperature: 0.2,
      feature: 'job-fit',
    })
    fit = result.object
    // notesUsed is ground truth, not the model's self-report: the LLM would
    // set it true even when no notes were in the prompt, surfacing the badge
    // on jobs that have none. hasNotes is the per-job source of truth.
    fit.notesUsed = hasNotes
  } catch (err) {
    if (err instanceof LLMError) {
      return { ok: false, error: err.kind, message: err.message }
    }
    throw err
  }

  // Emit suggestion if job notes reveal a salary floor not yet in searchProfile
  if (hasNotes && !context.salaryBand && job.notes) {
    const salaryMatch = job.notes.match(/(?:not worth|minimum|below|less than)[^\d]*(\d[\d,]+)/i)
    if (salaryMatch) {
      const floor = Number(salaryMatch[1].replace(/,/g, ''))
      if (!isNaN(floor) && floor > 0) {
        emitSuggestion(profile.id, {
          field: 'salaryBand',
          suggestedValue: { min: floor, max: null, currency: 'GBP' },
          reason: `You noted a salary floor around ${floor.toLocaleString()} while reviewing ${job.company ?? 'this role'}.`,
          source: 'job-fit',
        }).catch(() => { /* non-critical */ })
      }
    }
  }

  // Emit suggestion if job title is a new role type
  if (job.title && context.roles.length > 0) {
    const titleLower = job.title.toLowerCase()
    const alreadyTracked = context.roles.some((r) => titleLower.includes(r.toLowerCase()) || r.toLowerCase().includes(titleLower))
    if (!alreadyTracked) {
      emitSuggestion(profile.id, {
        field: 'roles',
        suggestedValue: [...context.roles, job.title],
        reason: `You applied to "${job.title}" which isn't in your target roles list.`,
        source: 'job-fit',
      }).catch(() => { /* non-critical */ })
    }
  }

  await prisma.jobApplication.update({
    where: { id: jobId },
    data: { jobFit: fit, jobFitAssessedAt: new Date() },
  })

  revalidatePath('/dashboard/job-applications')
  revalidatePath(`/dashboard/job-applications/view/${jobId}`)

  if (['stretch', 'solid', 'standout'].includes(fit.label)) {
    analyseJob(profile.id, jobId).catch(err =>
      console.error('[assessJobFit] background analysis failed', err),
    )
  }

  return { ok: true, fit }
}
