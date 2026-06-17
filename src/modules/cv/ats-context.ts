import { completeStructured } from '@/modules/llm/client'
import { loadATSContextPrompt } from '@/modules/llm/prompt-context'
import { ATSContextSchema, type ATSContextResult } from './ats-context-schema'

export async function buildATSContext(
  profileId: string,
  jobDescription: string,
  profileText: string,
): Promise<ATSContextResult> {
  const systemPrompt = await loadATSContextPrompt()

  const userMessage = [
    '== JOB DESCRIPTION ==',
    jobDescription,
    '',
    '== CANDIDATE PROFILE ==',
    profileText,
  ].join('\n')

  const result = await completeStructured(profileId, userMessage, ATSContextSchema, {
    system: systemPrompt,
    feature: 'ats-context',
    maxOutputTokens: 600,
    temperature: 0.1,
  })

  return result.object
}

export function formatATSContext(ctx: ATSContextResult): string {
  const lines: string[] = ['== ATS KEYWORD UPLIFT ==']

  if (ctx.supported.length > 0 || ctx.adjacent.length > 0) {
    lines.push('Weave SUPPORTED terms into the CV where the underlying experience justifies them.')
    lines.push('Use ADJACENT terms only where the profile evidence makes it genuinely credible.')
    lines.push('Never use ABSENT terms — they have no profile basis.\n')
  }

  if (ctx.supported.length > 0) {
    lines.push('SUPPORTED (use these exact terms):')
    for (const kw of ctx.supported) {
      lines.push(`- ${kw.term} [${kw.category}]${kw.profileEvidence ? ` — ${kw.profileEvidence}` : ''}`)
    }
    lines.push('')
  }

  if (ctx.adjacent.length > 0) {
    lines.push('ADJACENT (use with care):')
    for (const kw of ctx.adjacent) {
      lines.push(`- ${kw.term} [${kw.category}]${kw.profileEvidence ? ` — ${kw.profileEvidence}` : ''}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}
