'use server'

import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { complete, completeStructured } from '@/modules/llm/client'
import { LLMError, type LLMErrorKind } from '@/modules/llm/errors'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { loadWritingContext, composeSystem } from '@/modules/llm/prompt-context'
import { loadPromptText } from '@/modules/prompts/loader'
import { PROMPT_REGISTRY } from '@/modules/prompts/registry'
import { emitSuggestion } from '@/modules/search-profile/actions'
import { normalizeSearchProfile } from '@/modules/search-profile/schema'
import { CVDocumentContentSchema } from '@/modules/cv/schema'
import { toMarkdown } from '@/modules/cv/export'
import { ReviewOutputSchema, Stage1BriefSchema, Stage2ArchitectureSchema, Stage4IssuesSchema } from './schema'
import type { BuildWithMeInputs, ReviewOutput, Stage1Brief, Stage2Architecture, Stage4Issues } from './schema'

type GenerateResult =
  | { ok: true; content: string }
  | { ok: false; error: 'not_found'; message: string }
  | { ok: false; error: LLMErrorKind; message: string }

type ReviewResult =
  | { ok: true; review: ReviewOutput }
  | { ok: false; error: 'not_found' | 'no_content'; message: string }
  | { ok: false; error: LLMErrorKind; message: string }

async function loadGeneratePrompt(profileId: string): Promise<string> {
  return loadPromptText(profileId, 'cover-letter-generate')
}

async function loadReviewPrompt(profileId: string): Promise<string> {
  return loadPromptText(profileId, 'cover-letter-review')
}

async function loadPrompt(profileId: string, filename: string): Promise<string> {
  const def = PROMPT_REGISTRY.find(p => p.filename === filename)
  if (!def) throw new Error(`Unknown prompt file "${filename}"`)
  return loadPromptText(profileId, def.key)
}

type Stage1Result =
  | { ok: true; brief: Stage1Brief }
  | { ok: false; error: 'not_found'; message: string }
  | { ok: false; error: LLMErrorKind; message: string }

type Stage2Result =
  | { ok: true; architecture: Stage2Architecture }
  | { ok: false; error: 'not_found'; message: string }
  | { ok: false; error: LLMErrorKind; message: string }

type Stage3Result =
  | { ok: true; draft: string }
  | { ok: false; error: 'not_found'; message: string }
  | { ok: false; error: LLMErrorKind; message: string }

type Stage4Result =
  | { ok: true; issues: Stage4Issues }
  | { ok: false; error: 'not_found'; message: string }
  | { ok: false; error: LLMErrorKind; message: string }

async function gatherInputs(profileId: string, letterId: string) {
  const letter = await prisma.coverLetterDocument.findFirst({
    where: { id: letterId, profileId },
    select: {
      id: true,
      content: true,
      jobApplicationId: true,
      jobTitle: true,
      company: true,
      jobApplication: {
        select: { title: true, company: true, jobDescription: true, jobAnalysis: true },
      },
    },
  })
  if (!letter) return null

  const [snapshot, writingCtx] = await Promise.all([
    buildProfileSnapshot(profileId),
    loadWritingContext(profileId),
  ])

  let cvMarkdown: string | null = null
  if (letter.jobApplicationId) {
    const cv = await prisma.cVDocument.findFirst({
      where: { jobApplicationId: letter.jobApplicationId, profileId },
      orderBy: { updatedAt: 'desc' },
      select: { generatedContent: true },
    })
    if (cv) {
      try {
        const parsed = CVDocumentContentSchema.safeParse(JSON.parse(cv.generatedContent))
        if (parsed.success) cvMarkdown = toMarkdown(parsed.data)
      } catch {
        // malformed JSON — skip CV content
      }
    }
  }

  return { letter, snapshot, writingCtx, cvMarkdown }
}

type GatherInputsResult = NonNullable<Awaited<ReturnType<typeof gatherInputs>>>

function buildGeneratePrompt(inputs: GatherInputsResult): string {
  const { letter, snapshot, cvMarkdown } = inputs
  const job = letter.jobApplication
  const profileMd = serializeProfileForLLM(snapshot)

  let prompt = `# Candidate Profile\n\n${profileMd}`

  if (cvMarkdown) {
    prompt += `\n\n# Tailored CV\n\n${cvMarkdown}`
  }

  const title = letter.jobTitle ?? job?.title
  const company = letter.company ?? job?.company
  if (title || company) {
    prompt += `\n\n# Role\n\n**${title ?? 'Unknown role'}**${company ? ` at ${company}` : ''}`
  }

  if (job?.jobDescription) {
    prompt += `\n\n## Job Description\n\n${job.jobDescription}`
  }

  return prompt
}

export async function analyseRole(letterId: string): Promise<Stage1Result> {
  const { profile } = await requireProfile()
  const inputs = await gatherInputs(profile.id, letterId)
  if (!inputs) return { ok: false, error: 'not_found', message: 'Cover letter not found' }

  const { writingCtx } = inputs
  const userPrompt = buildGeneratePrompt(inputs)

  const stagePrompt = await loadPrompt(profile.id, 'cl-stage1-analyse.md')
  const system = composeSystem(writingCtx.rules, writingCtx.brief, writingCtx.searchProfileSummary, stagePrompt)

  try {
    const result = await completeStructured(profile.id, userPrompt, Stage1BriefSchema, {
      system,
      feature: 'cover-letter-analyse',
      temperature: 0,
      maxOutputTokens: 600,
    })

    // Fire-and-forget: suggest new role if job title not already tracked
    const { letter } = inputs
    const jobTitle = letter.jobTitle ?? letter.jobApplication?.title
    if (jobTitle) {
      const spSettings = await prisma.userSettings.findUnique({
        where: { profileId: profile.id },
        select: { searchProfile: true },
      })
      const sp = normalizeSearchProfile(spSettings?.searchProfile)
      if (sp.roles.length > 0) {
        const titleLower = jobTitle.toLowerCase()
        const alreadyTracked = sp.roles.some(
          (r) => titleLower.includes(r.toLowerCase()) || r.toLowerCase().includes(titleLower),
        )
        if (!alreadyTracked) {
          emitSuggestion(profile.id, {
            field: 'roles',
            suggestedValue: [...sp.roles, jobTitle],
            reason: `You're writing a cover letter for "${jobTitle}" which isn't in your target roles.`,
            source: 'cover-letter',
          }).catch(() => { /* non-critical */ })
        }
      }
    }

    return { ok: true, brief: result.object }
  } catch (err) {
    if (err instanceof LLMError) return { ok: false, error: err.kind, message: err.message }
    throw err
  }
}

export async function buildLetterArchitecture(
  letterId: string,
  brief: Stage1Brief,
): Promise<Stage2Result> {
  const { profile } = await requireProfile()
  const inputs = await gatherInputs(profile.id, letterId)
  if (!inputs) return { ok: false, error: 'not_found', message: 'Cover letter not found' }

  const userPrompt = `# Stage 1 Brief\n\n${JSON.stringify(brief, null, 2)}`
  const stagePrompt = await loadPrompt(profile.id, 'cl-stage2-architecture.md')
  const system = composeSystem(inputs.writingCtx.rules, inputs.writingCtx.brief, inputs.writingCtx.searchProfileSummary, stagePrompt)

  try {
    const result = await completeStructured(profile.id, userPrompt, Stage2ArchitectureSchema, {
      system,
      feature: 'cover-letter-architect',
      temperature: 0.3,
      maxOutputTokens: 600,
    })
    return { ok: true, architecture: result.object }
  } catch (err) {
    if (err instanceof LLMError) return { ok: false, error: err.kind, message: err.message }
    throw err
  }
}

export async function draftFromArchitecture(
  letterId: string,
  architecture: Stage2Architecture,
): Promise<Stage3Result> {
  const { profile } = await requireProfile()
  const inputs = await gatherInputs(profile.id, letterId)
  if (!inputs) return { ok: false, error: 'not_found', message: 'Cover letter not found' }

  const { snapshot, writingCtx } = inputs
  const userPrompt = [
    `# Message Architecture\n\n${JSON.stringify(architecture, null, 2)}`,
    `\n\n# Candidate Details\n\n${serializeProfileForLLM(snapshot)}`,
  ].join('')

  const stagePrompt = await loadPrompt(profile.id, 'cl-stage3-draft.md')
  const system = composeSystem(writingCtx.rules, writingCtx.brief, writingCtx.searchProfileSummary, stagePrompt)

  try {
    const result = await complete(profile.id, userPrompt, {
      system,
      feature: 'cover-letter-draft',
      temperature: 0.5,
      maxOutputTokens: 1200,
    })
    return { ok: true, draft: result.text }
  } catch (err) {
    if (err instanceof LLMError) return { ok: false, error: err.kind, message: err.message }
    throw err
  }
}

export async function reviewDraftPass(
  letterId: string,
  draft: string,
  brief: Stage1Brief,
): Promise<Stage4Result> {
  const { profile } = await requireProfile()
  const inputs = await gatherInputs(profile.id, letterId)
  if (!inputs) return { ok: false, error: 'not_found', message: 'Cover letter not found' }

  const { snapshot, writingCtx } = inputs
  const userPrompt = [
    `# Cover Letter Draft\n\n${draft}`,
    `\n\n# Stage 1 Checklist`,
    `\n\nTop 3 requirements:\n${brief.topRequirements.map(r => `- ${r}`).join('\n')}`,
    brief.screenerCriteria.length > 0
      ? `\n\nScreener criteria: ${brief.screenerCriteria.join(', ')}`
      : '',
    `\n\n# Candidate Profile (screener cross-check)\n\n${serializeProfileForLLM(snapshot)}`,
  ].join('')

  const stagePrompt = await loadPrompt(profile.id, 'cl-stage4-review.md')
  const system = composeSystem(writingCtx.rules, writingCtx.brief, writingCtx.searchProfileSummary, stagePrompt)

  try {
    const result = await completeStructured(profile.id, userPrompt, Stage4IssuesSchema, {
      system,
      feature: 'cover-letter-review-pass',
      temperature: 0,
      maxOutputTokens: 800,
    })
    return { ok: true, issues: result.object }
  } catch (err) {
    if (err instanceof LLMError) return { ok: false, error: err.kind, message: err.message }
    throw err
  }
}

export async function finaliseFromReview(
  letterId: string,
  draft: string,
  issues: Stage4Issues,
): Promise<GenerateResult> {
  const { profile } = await requireProfile()
  const inputs = await gatherInputs(profile.id, letterId)
  if (!inputs) return { ok: false, error: 'not_found', message: 'Cover letter not found' }

  const mustFixLines = issues.mustFix.length > 0
    ? issues.mustFix.map(i => `- ${i.description}\n  → ${i.suggestedFix}`).join('\n\n')
    : 'None.'
  const considerLines = issues.consider.length > 0
    ? issues.consider.map(i => `- ${i.description}`).join('\n')
    : 'None.'

  const userPrompt = [
    `# Cover Letter Draft\n\n${draft}`,
    `\n\n# Must Fix\n\n${mustFixLines}`,
    `\n\n# Consider (apply voice violations only)\n\n${considerLines}`,
  ].join('')

  const stagePrompt = await loadPrompt(profile.id, 'cl-stage5-final.md')
  const system = composeSystem(inputs.writingCtx.rules, inputs.writingCtx.brief, inputs.writingCtx.searchProfileSummary, stagePrompt)

  try {
    const result = await complete(profile.id, userPrompt, {
      system,
      feature: 'cover-letter-finalise',
      temperature: 0.2,
      maxOutputTokens: 1200,
    })
    return { ok: true, content: result.text }
  } catch (err) {
    if (err instanceof LLMError) return { ok: false, error: err.kind, message: err.message }
    throw err
  }
}

export async function buildWithMe(
  letterId: string,
  answers: BuildWithMeInputs,
): Promise<GenerateResult> {
  const { profile } = await requireProfile()

  const inputs = await gatherInputs(profile.id, letterId)
  if (!inputs) return { ok: false, error: 'not_found', message: 'Cover letter not found' }

  let userPrompt = buildGeneratePrompt(inputs)

  const answerLines: string[] = []
  if (answers.whyRole)      answerLines.push(`**Why this role:** ${answers.whyRole}`)
  if (answers.whyCompany)   answerLines.push(`**Why this company:** ${answers.whyCompany}`)
  if (answers.bestEvidence) answerLines.push(`**Best evidence of fit:** ${answers.bestEvidence}`)
  if (answers.whyNow)       answerLines.push(`**Why making this move now:** ${answers.whyNow}`)
  if (answers.anythingElse) answerLines.push(`**Additional context:** ${answers.anythingElse}`)

  if (answerLines.length > 0) {
    userPrompt += `\n\n# Your Context\n\n${answerLines.join('\n\n')}`
  }

  const systemPrompt = await loadGeneratePrompt(profile.id)
  const system = composeSystem(inputs.writingCtx.rules, inputs.writingCtx.brief, inputs.writingCtx.searchProfileSummary, systemPrompt)

  try {
    const result = await complete(profile.id, userPrompt, {
      system,
      feature: 'cover-letter-build',
      temperature: 0.7,
      maxOutputTokens: 1200,
    })
    return { ok: true, content: result.text }
  } catch (err) {
    if (err instanceof LLMError) return { ok: false, error: err.kind, message: err.message }
    throw err
  }
}

export async function reviewLetter(letterId: string): Promise<ReviewResult> {
  const { profile } = await requireProfile()

  const inputs = await gatherInputs(profile.id, letterId)
  if (!inputs) return { ok: false, error: 'not_found', message: 'Cover letter not found' }

  if (!inputs.letter.content.trim()) {
    return { ok: false, error: 'no_content', message: 'Write something first before requesting a review.' }
  }

  let userPrompt = `# Cover Letter to Review\n\n${inputs.letter.content}`
  userPrompt += `\n\n# Candidate Profile\n\n${serializeProfileForLLM(inputs.snapshot)}`

  const job = inputs.letter.jobApplication
  const title = inputs.letter.jobTitle ?? job?.title
  const company = inputs.letter.company ?? job?.company
  if (title || company) {
    userPrompt += `\n\n# Role\n\n**${title ?? 'Unknown role'}**${company ? ` at ${company}` : ''}`
  }
  if (job?.jobDescription) {
    userPrompt += `\n\n## Job Description\n\n${job.jobDescription}`
  }

  const systemPrompt = await loadReviewPrompt(profile.id)
  const system = composeSystem(inputs.writingCtx.rules, inputs.writingCtx.brief, inputs.writingCtx.searchProfileSummary, systemPrompt)

  try {
    const result = await completeStructured(profile.id, userPrompt, ReviewOutputSchema, {
      system,
      feature: 'cover-letter-review',
      temperature: 0,
      maxOutputTokens: 800,
    })
    return { ok: true, review: result.object }
  } catch (err) {
    if (err instanceof LLMError) return { ok: false, error: err.kind, message: err.message }
    throw err
  }
}
