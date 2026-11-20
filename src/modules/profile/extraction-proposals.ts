import { createHash, randomUUID } from 'node:crypto'
import { completeStructured, getLLMConfigStatus } from '@/modules/llm/client'
import { ExtractedSuggestionsSchema, type DraftItem, type ExtractedActivity, type ExtractedSkill } from './extract-schema'
import { EXTRACTION_SYSTEM, extractionPrompt, type ExtractionSubject } from './extraction-context'
import { mentionedProject } from './project-mention'
import { parseResult } from './result'
import { cleanClaim, localResult, parseNotes } from './tag-parser'
import { mergeExtractionResult } from './extraction-result'

type Project = { id: string; name: string }
export const hashExtractionValue = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

const digits = (text: string) => text.match(/[+-]?\d+(?:[.,]\d+)*%?/g) ?? []
const supported = (excerpt: string, phrase: string) => {
  const text = excerpt.toLowerCase()
  const query = phrase.trim().toLowerCase()
  if (!query) return false
  return new RegExp(`(?<![\\p{L}\\p{N}])${query.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(text)
}

const quantities = (text: string) => text.match(/(?<![\p{L}\p{N}])(?:[$£€]\s*)?[+-]?\d+(?:[.,]\d+)*(?:\s*%|\s*[a-zA-Z]+)?/gu) ?? []
const passage = (text: string) => text.toLowerCase().replace(/^\s*(?:[-*+] |\d+\. )/gm, '').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()

/** Use complete source lines, not model-chosen quote boundaries or classification, as resolution identity. */
export function extractionPassageKey(body: string, original: string): string {
  const at = body.indexOf(original.trim())
  const start = at < 0 ? 0 : body.lastIndexOf('\n', at - 1) + 1
  const end = at < 0 ? body.length : body.indexOf('\n', at)
  return hashExtractionValue(passage(at < 0 ? original : body.slice(start, end < 0 ? body.length : end)))
}

export function groundClaim(claim: Omit<ExtractedActivity, 'source'>, body: string, unparsed: string): ExtractedActivity | null {
  const excerpt = claim.original.trim()
  if (!excerpt || !unparsed.includes(excerpt) || !body.includes(excerpt) || !/^(?:I\b|My\b)/i.test(claim.description)) return null
  const numbers = new Set(digits(excerpt))
  const explicit = localResult(cleanClaim(excerpt.replace(/^[-*+]\s+/, '')), null) ?? localResult('', excerpt)
  const faithful = (text: string) => digits(text).every((number) => numbers.has(number)) &&
    quantities(text).every((quantity) => supported(excerpt, quantity)) &&
    (!explicit?.baseline || [...text.matchAll(/\b(from|to)\s+((?:[$£€]\s*)?[+-]?\d+(?:[.,]\d+)*(?:\s*%|\s*[a-zA-Z]+)?)/gi)]
      .every((match) => supported(match[1].toLowerCase() === 'from' ? explicit.baseline! : explicit.value, match[2])))
  if (!faithful(claim.description)) return null
  const impact = claim.impact && faithful(claim.impact) ? claim.impact : null
  const result = parseResult(claim.result)
  const groundedResult = result && digits(result.value).length && Object.values(result).every(
    (part) => part === null || supported(excerpt, part) && digits(part).every((number) => numbers.has(number)),
  ) && (!explicit?.baseline || supported(explicit.value, result.value) && (!result.baseline || supported(explicit.baseline, result.baseline))) ? result : null
  return { ...claim, original: excerpt, impact, result: groundedResult, source: 'llm' }
}

export async function proposeDraft(profileId: string, subject: ExtractionSubject, projects: Project[], sourceProjectId: string | null) {
  const parsed = parseNotes(subject.body)
  let activities = parsed.fallback
  let skills: ExtractedSkill[] = []
  let notice: string | null = null
  let failed = false

  if (parsed.unparsed) {
    try {
      if ((await getLLMConfigStatus(profileId)).configured) {
        const { object } = await completeStructured(profileId, extractionPrompt(subject, parsed.unparsed, projects), ExtractedSuggestionsSchema, {
          system: EXTRACTION_SYSTEM(subject.noun),
          maxOutputTokens: 1500,
          temperature: 0.2,
          feature: 'profile-extract',
        })
        const grounded = object.activities.map((claim) => groundClaim(claim, subject.body, parsed.unparsed))
          .filter((claim) => claim !== null)
        const used = new Set<ExtractedActivity>()
        const enriched = grounded.map((item) => {
          const matches = parsed.fallback.filter((claim) => extractionPassageKey(subject.body, item.original) === extractionPassageKey(subject.body, claim.original))
          if (matches.length !== 1) return item
          const local = matches[0]
          used.add(local)
          const start = Math.min(subject.body.indexOf(item.original), subject.body.indexOf(local.original))
          const end = Math.max(subject.body.indexOf(item.original) + item.original.length, subject.body.indexOf(local.original) + local.original.length)
          return { ...item, original: subject.body.slice(start, end), kind: local.result ? 'achievement' as const : item.kind,
            result: mergeExtractionResult(local.result, item.result), impact: item.impact ?? local.impact }
        })
        activities = [...enriched, ...parsed.fallback.filter((claim) => !used.has(claim))]
        skills = object.skills.map((skill) => ({ ...skill, original: skill.original.trim(), source: 'llm' as const }))
          .filter((skill) => skill.original && parsed.unparsed.includes(skill.original) && subject.body.includes(skill.original))
      } else {
        notice = 'Local extraction used. Add a model key to also extract from free-form prose.'
      }
    } catch {
      failed = true
      notice = 'The model could not read the prose. Local extraction is available.'
    }
  }

  const items: DraftItem[] = []
  const seen = new Set<string>()
  function remember(kind: DraftItem['kind'], original: string) {
    const key = kind === 'skill' ? hashExtractionValue(['skill', passage(original)]) : extractionPassageKey(subject.body, original)
    if (seen.has(key)) return
    seen.add(key)
    return { key, id: randomUUID() }
  }

  for (const claim of [...parsed.activities, ...activities]) {
    const identity = remember(claim.kind, claim.original)
    if (!identity) continue
    const common = { ...identity, original: claim.original, source: claim.source, description: claim.description }
    if (claim.kind === 'scope') {
      items.push({ ...common, kind: 'scope' })
      continue
    }
    const name = claim.projectName?.trim()
    const explicitName = name && name.length <= 160 && supported(claim.original, name) ? name : null
    const known = explicitName
      ? projects.find((project) => project.name.trim().toLowerCase() === explicitName.toLowerCase())
      : mentionedProject(claim.original, projects)
    const newName = !known ? explicitName : null
    const existingId = known?.id ?? (newName ? null : sourceProjectId)
    const project = existingId ? { kind: 'existing' as const, id: existingId }
      : newName ? { kind: 'new' as const, name: newName } : null
    items.push({ ...common, kind: 'achievement', impact: claim.impact, result: claim.result, project, projectEdited: false })
  }
  for (const skill of [...parsed.skills, ...skills]) {
    const identity = remember('skill', skill.name)
    if (identity) items.push({ ...identity, ...skill, kind: 'skill' })
  }
  return { items, notice, failed }
}
