import { ATSContextResult } from './ats-context-schema'

export function formatATSContext(result: ATSContextResult): string {
  const sections: string[] = []

  sections.push('== ATS KEYWORD UPLIFT ==')
  sections.push('')

  if (result.supported.length > 0) {
    sections.push('SUPPORTED')
    for (const item of result.supported) {
      const evidence = item.profileEvidence ? ` — ${item.profileEvidence}` : ''
      sections.push(`- ${item.term} [${item.category}]${evidence}`)
    }
    sections.push('')
  }

  if (result.adjacent.length > 0) {
    sections.push('ADJACENT')
    for (const item of result.adjacent) {
      const evidence = item.profileEvidence ? ` — ${item.profileEvidence}` : ''
      sections.push(`- ${item.term} [${item.category}]${evidence}`)
    }
    sections.push('')
  }

  return sections.join('\n').trim()
}
