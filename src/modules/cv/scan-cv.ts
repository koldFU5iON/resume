import * as z from 'zod'
import { completeStructured } from '@/modules/llm/client'
import { loadCVScanPrompt, composeSystem } from '@/modules/llm/prompt-context'
import type { CVDocumentContent } from './schema'

const MustHaveCoverageItemSchema = z.object({
  requirement: z.string(),
  present: z.boolean(),
})

const RecruiterScanSchema = z.object({
  takeaways: z.array(z.string()),
  positioningMatch: z.boolean(),
  gaps: z.array(z.string()),
  mustHaveCoverage: z.array(MustHaveCoverageItemSchema).optional(),
})

export type RecruiterScan = z.infer<typeof RecruiterScanSchema>

export function serializeCVForScan(content: CVDocumentContent): string {
  const lines: string[] = []

  for (const section of content.sections.filter(s => s.visible)) {
    switch (section.type) {
      case 'header':
        lines.push(section.data.name)
        lines.push(section.data.headline)
        break
      case 'profile':
        lines.push('PROFILE')
        lines.push(section.data.content)
        break
      case 'competencies':
        lines.push('COMPETENCIES: ' + section.data.items.join(', '))
        break
      case 'capabilities':
        lines.push('CAPABILITIES: ' + section.data.items.join(', '))
        break
      case 'experience': {
        const d = section.data
        lines.push(`${d.titles.join(' / ')} — ${d.company} | ${d.duration}`)
        if (d.subtitle) lines.push(d.subtitle)
        if (d.description) lines.push(d.description)
        for (const outcome of d.outcomes) lines.push(`• ${outcome}`)
        break
      }
      case 'education': {
        const d = section.data
        lines.push(
          `${d.qualification}${d.field ? ` in ${d.field}` : ''} — ${d.institution} (${d.duration})`,
        )
        break
      }
      case 'skills':
        lines.push('SKILLS: ' + section.data.items.join(', '))
        break
      case 'tools':
        lines.push('TOOLS: ' + section.data.items.join(', '))
        break
      case 'certification':
        lines.push(`${section.data.name}${section.data.issuer ? ' — ' + section.data.issuer : ''}`)
        break
      case 'languages':
        lines.push('LANGUAGES: ' + section.data.items.map((l) => `${l.name} (${l.proficiency})`).join(', '))
        break
      default:
        break
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}

// Returns null on failure — the scan is informational only and must never block CV generation.
export async function scanCV(
  profileId: string,
  content: CVDocumentContent,
  positioningStrategy?: string,
  mustHave?: string[],
): Promise<RecruiterScan | null> {
  const cvText = serializeCVForScan(content)

  const userMessage = [
    positioningStrategy ? `== POSITIONING STRATEGY ==\n${positioningStrategy}` : null,
    mustHave && mustHave.length > 0
      ? `== MUST-HAVE REQUIREMENTS ==\n${mustHave.map(r => `- ${r}`).join('\n')}`
      : null,
    '== CV ==',
    cvText,
  ]
    .filter((p): p is string => p !== null)
    .join('\n\n')

  try {
    const systemPrompt = await loadCVScanPrompt()
    const result = await completeStructured(
      profileId,
      userMessage,
      RecruiterScanSchema,
      {
        system: composeSystem(systemPrompt),
        feature: 'cv-recruiter-scan',
        maxOutputTokens: 400,
        temperature: 0.2,
      },
    )
    return result.object
  } catch (err) {
    console.error('[scanCV] failed', err)
    return null
  }
}
