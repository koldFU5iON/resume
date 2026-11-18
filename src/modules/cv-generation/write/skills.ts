/**
 * The skills and tools writer (wave 1): ONE call that only ORDERS and GROUPS
 * the already-selected names. It adds nothing: every name in the answer is
 * checked in code against the selected names (unknown ones dropped, repeats
 * dropped, names it left out put back), at most MAX_SKILL_GROUPS short group
 * labels per list. If the call fails or returns nothing usable, or there is too
 * little to group, code orders the names (evidence-backed first, then the
 * selection's order): this stage never fails the run.
 *
 * Claimed (unevidenced) skills and tools may appear here: the Skills and Tools
 * lists are the only place they are allowed without the job asking for them.
 */

import * as z from 'zod'
import { composeSystem } from '@/modules/llm/prompt-context'
import { attributionOf, completeValidated, type CallUsage, NO_USAGE, usageOfError } from '../call'
import { CV_GENERATION_FEATURES, MAX_OUTPUT_TOKENS, TEMPERATURE, TIME_BUDGET_MS } from '../schema'
import { GROUP_LABEL_MAX_WORDS, MAX_SKILL_GROUPS, MIN_CALL_MS, MIN_NAMES_TO_GROUP } from './limits'
import { wordCount } from './checks'
import type { CapabilityEvidence } from './evidence'
import { plainLine } from './plain'
import { briefText, data, requirementsBlock } from './prompt'
import { renderNameGroups, type NameGroup } from './render'
import type { WriteContext } from './types'

const GroupSchema = z.object({
  label: z.string().default('').describe(`A short plain label of at most ${GROUP_LABEL_MAX_WORDS} words, or an empty string for a single unlabeled group`),
  names: z.array(z.string()).default([]).describe('Names from the given list, copied exactly'),
})
export const SkillsOutputSchema = z.object({
  skills: z.array(GroupSchema).default([]).describe(`The skills in order, split into at most ${MAX_SKILL_GROUPS} groups`),
  tools: z.array(GroupSchema).default([]).describe(`The tools in order, split into at most ${MAX_SKILL_GROUPS} groups`),
})
export type SkillsOutput = z.infer<typeof SkillsOutputSchema>

export const SKILLS_OUTPUT_FORMAT = `Output: one JSON object in a \`\`\`json code block, nothing else. It must match this JSON Schema. Limits in the descriptions are hard limits.
\`\`\`json
${JSON.stringify(z.toJSONSchema(SkillsOutputSchema, { io: 'input' }))}
\`\`\``

/** Evidence-backed names first, then the selection's order. The fallback order. */
export function codeOrder(items: readonly CapabilityEvidence[]): NameGroup[] {
  const names = items
    .map((c, i) => ({ c, i }))
    .sort((a, b) => Number(a.c.claimed) - Number(b.c.claimed) || a.i - b.i)
    .map(({ c }) => c.name)
  return names.length > 0 ? [{ label: null, names }] : []
}

const cleanLabel = (label: string): string | null => {
  const l = plainLine(label).replace(/[:\-–—]+$/, '').trim()
  if (!l || wordCount(l) > GROUP_LABEL_MAX_WORDS || l.length > 40) return null
  return l
}

/**
 * The model's groups for one list, validated against the selected names. Returns
 * null when nothing usable remains (junk): the caller then orders by code.
 * Unknown names and repeats are dropped; names the model left out are appended
 * to the last group; surplus groups are merged into the last allowed one; a
 * label that is too long is dropped; a single group loses its label.
 */
export function validateGroups(groups: ReadonlyArray<{ label: string; names: string[] }>, selected: readonly CapabilityEvidence[]): NameGroup[] | null {
  const canon = new Map(selected.map((c) => [c.name.trim().toLowerCase(), c.name]))
  const used = new Set<string>()
  const out: NameGroup[] = []
  for (const g of groups) {
    const names: string[] = []
    for (const raw of g.names) {
      const key = raw.trim().toLowerCase()
      const name = canon.get(key)
      if (!name || used.has(key)) continue
      used.add(key)
      names.push(name)
    }
    if (names.length > 0) out.push({ label: cleanLabel(g.label), names })
  }
  if (out.length === 0) return null
  while (out.length > MAX_SKILL_GROUPS) {
    const extra = out.pop()!
    out[out.length - 1].names.push(...extra.names)
  }
  const left = selected.filter((c) => !used.has(c.name.trim().toLowerCase())).map((c) => c.name)
  if (left.length > 0) out[out.length - 1].names.push(...left)
  return out.length === 1 ? [{ label: null, names: out[0].names }] : out
}

export function skillsPrompt(ctx: Pick<WriteContext, 'brief' | 'strategy'>, skills: readonly CapabilityEvidence[], tools: readonly CapabilityEvidence[]): string {
  const list = (items: readonly CapabilityEvidence[]) => (items.length > 0 ? items.map((i) => `- ${i.name}${i.category ? ` (${i.category})` : ''}`).join('\n') : '(none)')
  return [
    '# Brief',
    briefText(ctx.brief),
    '# Job requirements',
    data('job_requirements', requirementsBlock(ctx.strategy)),
    '# Skills (most relevant first; copy names exactly)',
    data('skills', list(skills)),
    '# Tools (most relevant first; copy names exactly)',
    data('tools', list(tools)),
    `# Limits\n\nAt most ${MAX_SKILL_GROUPS} groups per list, each label at most ${GROUP_LABEL_MAX_WORDS} words. Use only the names above. Labels are plain text: no Markdown, links, HTML or ":::". Code builds the lists from your groups.`,
    'Return the ordered groups as one JSON object matching the schema, in a ```json code block.',
  ].join('\n\n')
}

export type SkillsOutcome = {
  skills: NameGroup[]
  tools: NameGroup[]
  skillsMarkdown: string
  toolsMarkdown: string
  model: string | null
  usage: CallUsage
  retries: number
  retryReasons: string[]
  notes: string[]
}

const render = (skills: NameGroup[], tools: NameGroup[]) => ({
  skillsMarkdown: renderNameGroups(skills, 'skills'),
  toolsMarkdown: renderNameGroups(tools, 'inline-list'),
})

/** Orders and groups the selected skills and tools. Never throws for a failed or junk answer. */
export async function writeSkills(
  ctx: WriteContext,
  instructions: { rules: string; brief: string | null; prompt: string },
): Promise<SkillsOutcome> {
  const { skills, tools } = ctx.evidence
  const byCode = (notes: string[], usage: CallUsage = NO_USAGE): SkillsOutcome => {
    const s = codeOrder(skills)
    const t = codeOrder(tools)
    return { skills: s, tools: t, ...render(s, t), model: null, usage, retries: 0, retryReasons: [], notes }
  }
  if (skills.length === 0 && tools.length === 0) return byCode(['Nothing selected.'])
  if (skills.length < MIN_NAMES_TO_GROUP && tools.length < MIN_NAMES_TO_GROUP) {
    return byCode([`Too few names to group (under ${MIN_NAMES_TO_GROUP} in each list), so ordered by code: evidence-backed first, then the selection's order. No model call.`])
  }
  if (ctx.deadline - Date.now() < MIN_CALL_MS) return byCode(['Not enough time left for the grouping call, so the names are ordered by code: evidence-backed first, then the selection\'s order.'])
  try {
    const call = await completeValidated(ctx.profileId, skillsPrompt(ctx, skills, tools), SkillsOutputSchema, {
      role: 'fast',
      system: composeSystem(instructions.rules, instructions.brief, instructions.prompt, SKILLS_OUTPUT_FORMAT),
      maxOutputTokens: MAX_OUTPUT_TOKENS.writeSkills,
      retryMaxOutputTokens: MAX_OUTPUT_TOKENS.writeSkillsRetry,
      temperature: TEMPERATURE.writeSkills,
      timeoutMs: TIME_BUDGET_MS.write,
      deadline: ctx.deadline,
      feature: CV_GENERATION_FEATURES.writeSkills,
      attribution: attributionOf(ctx),
      label: 'skills grouping',
    })
    const notes: string[] = []
    const pick = (label: string, raw: SkillsOutput['skills'], items: readonly CapabilityEvidence[]): NameGroup[] => {
      if (items.length === 0) return []
      const valid = validateGroups(raw, items)
      if (!valid) {
        notes.push(`The ${label} grouping named none of the selected ${label}, so they are ordered by code.`)
        return codeOrder(items)
      }
      return valid
    }
    const s = pick('skills', call.value.skills, skills)
    const t = pick('tools', call.value.tools, tools)
    return { skills: s, tools: t, ...render(s, t), model: call.model, usage: call.usage, retries: call.retries, retryReasons: call.retryReasons ?? [], notes }
  } catch (err) {
    const why = (err as { kind?: string })?.kind ? ` (${(err as { kind: string }).kind})` : ''
    // The calls that did answer (a failed retry, say) were still paid for.
    return byCode([`The grouping call failed${why}, so the names are ordered by code: evidence-backed first, then the selection's order.`], usageOfError(err))
  }
}
