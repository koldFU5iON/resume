import type { ExtractedActivity, ExtractedSkill } from './extract-schema'
import { parseResult } from './result'

const H2_RE = /^#{1,2}\s+(.+)$/
const BULLET_RE = /^\s*(?:[-*+] |\d+\. )(.+)$/
const IMPACT_RE = /^\s*>\s*(.*)$/
const headings = ['overview', 'responsibilities', 'scope', 'achievements', 'skills']

const duty = /^(?:(?:I (?:am|was) )?responsible for|(?:my )?duties (?:include|included)|(?:I )?(?:oversee|maintain|manage|support)\b)/i
const action = /^(?:built|cut|grew|led|ran|made|wrote|won|set|drove|took|brought|met|hit|kept|oversaw|[a-z]+ed)\b/i
const completedClause = (text: string) => text.split(/(?:[,;]\s*(?:so\s+)?|\band\s+|\bto\s+|\bby\s+)/i).slice(1)
  .map((part) => part.replace(/^(?:I|We)\s+/i, '').trim())
  .some((part) => action.test(part) && !/^(?:needed|wanted|planned|hoped|expected|asked|used)\b/i.test(part))
export function unresolvedIntent(text: string) {
  return /^(?:(?:I|We)\s+)?(?:(?:needed|need|wanted|want|planned|plan|hoped|hope|had)\s+to|(?:was|were|am|are)\s+(?:asked|expected)\s+to)\b/i.test(text) && !completedClause(text)
}
export function toolUsage(text: string) {
  return /^(?:(?:I|We)\s+)?(?:use[ds]?|work(?:ed)? with)\b/i.test(text) && !completedClause(text)
}
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

export function cleanClaim(raw: string): string {
  const text = raw.trim().replace(/^\*\*(.+?)\*\*(?=\s|$)/, '$1').replace(/\s+/g, ' ')
  if (/^(?:i\b|my\b)/i.test(text)) return text
  if (/^we\s+/i.test(text)) return `I was part of the team that ${text.slice(3)}`
  if (/^responsible for\b/i.test(text)) return `I was ${lowerFirst(text)}`
  if (action.test(text) || duty.test(text)) return `I ${lowerFirst(text)}`
  return text
}

/** Recognize only explicit measurements. The rest stays in the verbatim impact. */
export function localResult(description: string, impact: string | null) {
  const comparisonVerb = /^(?:I )?(?:reduced|cut|increased|raised|lowered|improved)\s+/i
  const labelled = impact?.match(/^([^:\n]+):\s*(.+?)\s*(?:\(from ([^)]+)\))?(?:,\s+(.+))?$/i)
  const comparison = impact ?? (comparisonVerb.test(description) ? description : null)
  const range = comparison?.replace(comparisonVerb, '').match(/^([^:\n]+?)\s+from\s+(.+?)\s+to\s+(.+?)(?:\s+(?:in|over|during)\s+(.+?))?[.!]?$/i)
  const [measure, value, baseline, period] = labelled
    ? [labelled[1], labelled[2], labelled[3], labelled[4]]
    : [range?.[1], range?.[3], range?.[2], range?.[4]]
  if (!value || !/\d/.test(value)) return null
  return parseResult({ measure, value, baseline, period })
}

export function parseNotes(markdown: string) {
  let heading: string | null = null
  const activities: ExtractedActivity[] = []
  const fallback: ExtractedActivity[] = []
  const skills: ExtractedSkill[] = []
  const unparsed: string[] = []
  let offset = 0
  let previous: { claim: ExtractedActivity; start: number } | undefined

  for (const raw of markdown.split('\n')) {
    const start = offset
    offset += raw.length + 1
    const line = raw.trimEnd()
    const title = line.match(H2_RE)?.[1].toLowerCase()
    if (title) {
      heading = headings.includes(title) ? title : null
      if (!heading) unparsed.push(raw)
      previous = undefined
      continue
    }
    if (!heading) unparsed.push(raw)
    const impact = line.match(IMPACT_RE)?.[1].trim()
    if (impact && previous) {
      const { claim } = previous
      claim.original = markdown.slice(previous.start, start + raw.length).trim()
      const projectName = impact.match(/^project:\s*(.+)$/i)?.[1].trim()
      if (projectName) {
        claim.projectName = projectName
      } else {
        claim.impact = claim.impact ? `${claim.impact}\n${impact}` : impact
        if (claim.kind === 'achievement') claim.result = localResult(claim.description, impact) ?? claim.result
      }
      continue
    }
    previous = undefined
    const bullet = line.match(BULLET_RE)?.[1].trim()
    const text = bullet ?? line.trim()
    if (!text || impact || heading === 'overview') continue
    if (unresolvedIntent(text)) continue
    if (heading === 'skills') {
      const name = text.slice(0, 120)
      if (name) skills.push({ name, category: null, level: null, source: 'parser', original: line.trim() })
      continue
    }
    if (!heading && !/^(I|We)\s/i.test(text) && !(bullet && (action.test(text) || duty.test(text)))) continue

    const scope = heading === 'scope' || heading === 'responsibilities' || duty.test(text) || toolUsage(text)
    const cleaned = cleanClaim(text)
    if (!cleaned || (!heading && !bullet && cleaned === text && !/^(?:I\b|My\b)/i.test(text))) continue
    const description = /^(?:I\b|My\b)/i.test(cleaned) ? cleaned : `I worked on ${cleaned}`
    const claim: ExtractedActivity = {
      source: 'parser', kind: scope ? 'scope' : 'achievement', description,
      original: line.trim(), impact: null, result: scope ? null : localResult(description, null), projectName: null,
    }
    const bucket = heading ? activities : fallback
    bucket.push(claim)
    previous = { claim, start }
  }
  return { activities, fallback, skills, unparsed: unparsed.join('\n').trim() }
}
