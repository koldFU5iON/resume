import { createHash, randomUUID } from 'node:crypto'
import { completeStructured, getLLMConfigStatus } from '@/modules/llm/client'
import { ExtractedSuggestionsSchema, type DraftItem, type ExtractedActivity, type ExtractedSkill } from './extract-schema'
import { EXTRACTION_SYSTEM, extractionPrompt, type ExtractionSubject } from './extraction-context'
import { LLMError } from '@/modules/llm/errors'
import { mentionedProject } from './project-mention'
import { parseResult } from './result'
import { cleanClaim, localResult, parseNotes, unresolvedIntent, toolUsage } from './tag-parser'

type Project = { id: string; name: string }
export const hashExtractionValue = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

const digits = (text: string) => text.match(/[+-]?\d+(?:[.,]\d+)*%?/g) ?? []
const supported = (excerpt: string, phrase: string, preserveCase = false) => {
  const text = preserveCase ? excerpt : excerpt.toLowerCase()
  const query = preserveCase ? phrase.trim() : phrase.trim().toLowerCase()
  if (!query) return false
  return new RegExp(`(?<![\\p{L}\\p{N}])${query.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(text)
}

const quantities = (text: string) => text.match(/(?<![\p{L}\p{N}])(?:[$£€]\s*)?[+-]?\d+(?:[.,]\d+)*(?:\s*%|\s*[a-zA-Z]+)?/gu) ?? []

/** A quote belongs to its source sentence and attached parser details, not a model-chosen kind. */
export function extractionPassageKey(body: string, original: string): string {
  let at = body.indexOf(original.trim())
  if (at < 0) return hashExtractionValue(original.trim())
  const parsed = parseNotes(body)
  const block = [...parsed.activities, ...parsed.fallback].find((claim) => {
    const start = body.indexOf(claim.original)
    return start <= at && at < start + claim.original.length
  })
  const blockStart = block ? body.indexOf(block.original) : at
  const firstLineEnd = body.indexOf('\n', blockStart)
  if (block && firstLineEnd >= 0 && at > firstLineEnd) at = blockStart
  const lineStart = body.lastIndexOf('\n', at - 1) + 1
  const lineEnd = body.indexOf('\n', at)
  const line = body.slice(lineStart, lineEnd < 0 ? body.length : lineEnd)
  const contentStart = line.match(/^\s*(?:[-*+] |\d+\. )/)?.[0].length ?? 0
  const position = Math.max(contentStart, at - lineStart)
  const boundaries = [...line.matchAll(/[.!?](?=\s|$)/g)].map((match) => match.index).filter((index) => index >= contentStart)
  const start = (boundaries.findLast((index) => index < position) ?? (contentStart - 1)) + 1
  const end = boundaries.find((index) => index >= position) ?? line.length
  const details = block?.original.split(/\r?\n/).slice(1).map((text) => text.trim()).join('\n') ?? ''
  return hashExtractionValue([line.slice(start, end).trim().replace(/\s+/g, ' '), details])
}

export function groundClaim(claim: Omit<ExtractedActivity, 'source'>, body: string, unparsed: string): ExtractedActivity | null {
  const excerpt = claim.original.trim()
  if (!excerpt || !unparsed.includes(excerpt) || !body.includes(excerpt) || body.indexOf(excerpt) !== body.lastIndexOf(excerpt) || !/^(?:I\b|My\b)/i.test(claim.description)) return null
  // Include source qualifiers even when the model quotes only the action phrase.
  const at = body.indexOf(excerpt)
  const before = body.slice(0, at)
  const start = [...before.matchAll(/[.!?](?=\s|$)|\n/g)].at(-1)?.index ?? -1
  const sentence = body.slice(start + 1, at + excerpt.length).trim().replace(/^(?:[-*+] |\d+\. )/, '')
  if (unresolvedIntent(sentence)) return null
  const numbers = new Set(digits(excerpt))
  const explicit = localResult(cleanClaim(excerpt.replace(/^[-*+]\s+/, '')), null) ?? localResult('', excerpt)
  const faithful = (text: string) => digits(text).every((number) => numbers.has(number)) &&
    quantities(text).every((quantity) => supported(excerpt, quantity, true)) &&
    (!explicit?.baseline || [...text.matchAll(/\b(from|to)\s+((?:[$£€]\s*)?[+-]?\d+(?:[.,]\d+)*(?:\s*%|\s*[a-zA-Z]+)?)/gi)]
      .every((match) => supported(match[1].toLowerCase() === 'from' ? explicit.baseline! : explicit.value, match[2], true)))
  if (!faithful(claim.description)) return null
  // A quantitative paraphrase can reverse a comparison without using 'from' or 'to'. Keep its source wording.
  const sourceClaim = cleanClaim(excerpt.replace(/^[-*+]\s+/, ''))
  const description = digits(claim.description).length
    ? /^(?:I\b|My\b)/i.test(sourceClaim) ? sourceClaim : `I worked on ${sourceClaim}`
    : claim.description
  const impact = claim.impact && faithful(claim.impact) && (!digits(claim.impact).length || supported(excerpt, claim.impact, true)) ? claim.impact : null
  const result = parseResult(claim.result)
  const groundedResult = result && digits(result.value).length && Object.entries(result).every(
    ([field, part]) => part === null || supported(excerpt, part, field !== 'period') && digits(part).every((number) => numbers.has(number)),
  ) && (!result.baseline || Boolean(explicit?.baseline)) && (!explicit?.baseline || supported(explicit.value, result.value, true) && (!result.baseline || supported(explicit.baseline, result.baseline, true))) ? result : null
  return { ...claim, kind: toolUsage(sentence) ? 'scope' : claim.kind, description, original: excerpt, impact, result: groundedResult, source: 'llm' }
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
          // Quotes and cleaned claims repeat source text; keep the response bounded in the schema.
          maxOutputTokens: 8000,
          redactInvalidOutput: true,
          maxRetries: 0,
          timeoutMs: 120_000,
          temperature: 0.2,
          feature: 'profile-extract',
        })
        if (object.activities.length === 12 || object.skills.length === 8) {
          notice = 'This is a bounded review pass (up to 12 activities and 8 skills). More material may remain in the note; review the source before accepting.'
        }
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
            result: local.result ?? item.result, impact: item.impact ?? local.impact }
        })
        activities = [...enriched, ...parsed.fallback.filter((claim) => !used.has(claim))]
        skills = object.skills.map((skill) => ({ ...skill, original: skill.original.trim(), source: 'llm' as const }))
          .filter((skill) => skill.original && parsed.unparsed.includes(skill.original) && subject.body.includes(skill.original))
      } else {
        notice = 'Local extraction used. Add a model key to also extract from free-form prose.'
      }
    } catch (error) {
      failed = true
      const reasons: Partial<Record<LLMError['kind'], string>> = {
        auth: 'The model key was refused. Check your model settings.',
        rate_limit: 'The model rate limit was reached. Try again later.',
        invalid_output: 'The model returned incomplete or invalid suggestions. Try a shorter passage or another configured model.',
        timeout: 'The model timed out. Try again later.',
      }
      const reason = error instanceof LLMError ? reasons[error.kind] : undefined
      notice = reason ?? 'The model could not extract suggestions. Check your model settings or try again later.'
    }
  }

  const items: DraftItem[] = []
  const seen = new Set<string>()
  function remember(kind: DraftItem['kind'], original: string) {
    const key = kind === 'skill' ? hashExtractionValue(['skill', original.trim().toLowerCase()]) : extractionPassageKey(subject.body, original)
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
  if (failed) notice += items.length ? ' Local suggestions were recovered, but prose extraction failed.' : ' No suggestions were recovered locally.'
  return { items, notice, failed }
}
