/**
 * Stage 2, Select: one call, role 'fast'. The model picks evidence by id per
 * section with a reason each; CODE then enforces every hard cap (caps.ts):
 * unknown ids are dropped, duplicates removed, each list truncated in the
 * model's rank order, the most recent role is always kept, and activities are
 * limited per role by recency tier. If the call fails or returns nothing
 * usable, a deterministic fallback chooses by rules (recency, highlighted
 * activities, matches to the brief) and the run goes on: Select never fails a
 * run. Both paths go through `enforceSelection`, so the caps hold either way.
 *
 * The pure functions here are exported for tests.
 */

import * as z from 'zod'
import { composeSystem, loadCVSelectPrompt } from '@/modules/llm/prompt-context'
import { LLMError } from '@/modules/llm/errors'
import { completeValidated } from './call'
import {
  FLAT_CAPS,
  FLAT_SECTIONS,
  MAX_EXPERIENCES,
  MAX_RECORDED_DROPPED,
  activityBudget,
  type FlatSection,
} from './caps'
import { candidatesToPrompt, labelIndex, type Candidates, type CandidateActivity } from './candidates'
import type { GatherResult } from './gather'
import {
  CV_GENERATION_FEATURES,
  DROP_REASON_LABEL,
  MAX_OUTPUT_TOKENS,
  TIME_BUDGET_MS,
  type CvBrief,
  type CvSelection,
  type DropReason,
  type DroppedItem,
  type SelectedItem,
} from './schema'

type Gathered = Extract<GatherResult, { ok: true }>

// ── What the model returns ──────────────────────────────────────────────────

const reason = z.string().default('').describe('One short sentence: what this item shows for the role (at most 160 characters)')
  .transform((v) => v.trim().slice(0, 160).trim())
const PickSchema = z.object({ id: z.string(), reason })
const list = () => z.array(PickSchema).default([])

export const SelectOutputSchema = z.object({
  experiences: list().describe('Most relevant roles, best first'),
  activities: z.array(z.object({
    experienceId: z.string().describe('The id of the role the activity belongs to'),
    id: z.string(),
    reason,
  })).default([]).describe('Activities to keep, best first within each role'),
  skills: list(),
  tools: list(),
  competencies: list(),
  certifications: list(),
  education: list(),
  projects: list(),
})
export type SelectOutput = z.infer<typeof SelectOutputSchema>

const OUTPUT_FORMAT = `Output: one JSON object in a \`\`\`json code block, nothing else. It must match this JSON Schema. Use only ids from the candidate list.
\`\`\`json
${JSON.stringify(z.toJSONSchema(SelectOutputSchema, { io: 'input' }))}
\`\`\``

/** The select prompt (everything but the instructions). Pure. */
export function selectPrompt(brief: CvBrief, cands: Candidates): string {
  const l = (items: readonly string[]) => (items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : '(none)')
  const b = brief.budgets
  return [
    '# Brief',
    [
      `The problem the role is hired to solve: ${brief.hiddenQuestion}`,
      `Positioning: ${brief.positioning}`,
      `Lead with:\n${l(brief.leadWith)}`,
      `Emphasise:\n${l(brief.emphasise.map((e) => `${e.item}: ${e.why}`))}`,
      `Play down:\n${l(brief.playDown)}`,
    ].join('\n\n'),
    `# Budgets (hard limits; extra picks are discarded)\n\nRoles ${b.experiences}, skills ${b.skills}, tools ${b.tools}, competencies ${b.competencies}, certifications ${b.certifications}, education ${b.education}, projects ${b.projects}. Activities per role: ${activityBudget(0)} for the most recent kept role, ${activityBudget(1)} for the next, ${activityBudget(2)} for older ones.`,
    '# Candidates',
    candidatesToPrompt(cands),
    'Return your picks as one JSON object matching the schema, in a ```json code block.',
  ].join('\n\n')
}

// ── Enforcement (code owns the caps) ────────────────────────────────────────

const SECTION_NAME: Record<string, string> = {
  experiences: 'Role', activities: 'Activity', skills: 'Skill', tools: 'Tool', competencies: 'Competency',
  certifications: 'Certification', education: 'Education', projects: 'Project',
}

/** Rule-picked activity order: highlighted, achievements, then ones with an impact. */
function activityRank(a: CandidateActivity): number {
  return (a.highlighted ? 4 : 0) + (a.kind === 'achievement' ? 2 : 0) + (a.impact ? 1 : 0)
}

export type EnforceResult = {
  selection: CvSelection
  /** Things the page should say about what code changed. */
  notes: string[]
  /** Model picks that matched a real candidate; 0 means the answer was junk. */
  recognised: number
}

/**
 * Applies the hard caps to a set of picks (the model's, or the fallback's).
 * Pure. The brief's budgets are clamped to the caps again here so a hand-made
 * or stored brief can never ask for more than a cap.
 */
export function enforceSelection(
  out: SelectOutput,
  cands: Candidates,
  brief: Pick<CvBrief, 'budgets'>,
  mode: CvSelection['mode'] = 'model',
): EnforceResult {
  const notes: string[] = []
  const labels = labelIndex(cands)
  const dropReason = new Map<string, DropReason>()
  let unknown = 0
  let duplicates = 0
  let recognised = 0
  /** Picks that were not a real id, or were repeated. */
  const unknownIds: DroppedItem[] = []

  /** Valid, deduplicated picks in the model's order; unknown and repeated ids are recorded. */
  function rank<P extends { id: string }>(section: string, picks: readonly P[], known: ReadonlySet<string>): P[] {
    const seen = new Set<string>()
    const ranked: P[] = []
    for (const p of picks) {
      if (!known.has(p.id)) {
        unknown++
        unknownIds.push({ section, id: p.id.slice(0, 64), label: '', why: 'unknown_id' })
        continue
      }
      if (seen.has(p.id)) {
        duplicates++
        unknownIds.push({ section, id: p.id, label: labels.get(p.id) ?? '', why: 'duplicate' })
        continue
      }
      seen.add(p.id)
      recognised++
      ranked.push(p)
    }
    return ranked
  }

  const item = (id: string, why: string): SelectedItem => ({ id, label: labels.get(id) ?? id, reason: why })
  const clampBudget = (n: number, cap: number) => Math.min(cap, Math.max(0, Math.floor(n)))

  // Roles: at most the budget, most recent always kept, shown newest first.
  const expIds = new Set(cands.experiences.map((e) => e.id))
  const roleLimit = Math.max(1, clampBudget(brief.budgets.experiences, MAX_EXPERIENCES))
  const roleRanked = rank('experiences', out.experiences, expIds)
  let keptRoles = roleRanked.slice(0, roleLimit)
  for (const p of roleRanked.slice(roleLimit)) dropReason.set(p.id, 'over_cap')
  const newest = cands.experiences[0]
  const reasonOf = new Map(roleRanked.map((p) => [p.id, p.reason]))
  if (newest && !keptRoles.some((p) => p.id === newest.id)) {
    if (keptRoles.length >= roleLimit) {
      const removed = keptRoles[keptRoles.length - 1]
      dropReason.set(removed.id, 'over_cap')
      keptRoles = keptRoles.slice(0, -1)
    }
    dropReason.delete(newest.id)
    keptRoles = [...keptRoles, { id: newest.id, reason: '' }]
    notes.push('Kept the most recent role, which is always on the CV.')
  }
  const keptRoleIds = new Set(keptRoles.map((p) => p.id))
  const experiences = cands.experiences
    .filter((e) => keptRoleIds.has(e.id))
    .map((e) => item(e.id, reasonOf.get(e.id) || (e.id === newest?.id ? 'Most recent role' : '')))

  // Activities: per kept role, by recency tier among the kept roles.
  const parentOf = new Map<string, string>()
  for (const e of cands.experiences) for (const a of e.activities) parentOf.set(a.id, e.id)
  const actIds = new Set(parentOf.keys())
  const actRanked = rank('activities', out.activities, actIds)
  const byRole = new Map<string, typeof actRanked>()
  for (const p of actRanked) {
    const parent = parentOf.get(p.id)!
    if (!keptRoleIds.has(parent)) {
      dropReason.set(p.id, 'role_not_kept')
      continue
    }
    byRole.set(parent, [...(byRole.get(parent) ?? []), p])
  }
  const activities: CvSelection['activities'] = {}
  const keptActIds = new Set<string>()
  let backfilled = 0
  experiences.forEach((exp, i) => {
    const role = cands.experiences.find((e) => e.id === exp.id)!
    const limit = activityBudget(i)
    const picks = byRole.get(exp.id) ?? []
    let kept: SelectedItem[] = picks.slice(0, limit).map((p) => item(p.id, p.reason))
    for (const p of picks.slice(limit)) dropReason.set(p.id, 'over_cap')
    if (kept.length === 0 && role.activities.length > 0) {
      kept = role.activities
        .map((a, idx) => ({ a, idx }))
        .sort((x, y) => activityRank(y.a) - activityRank(x.a) || x.idx - y.idx)
        .slice(0, limit)
        .map(({ a }) => item(a.id, 'Chosen by rule: no pick was made for this role'))
      backfilled++
    }
    for (const k of kept) keptActIds.add(k.id)
    activities[exp.id] = kept
  })
  if (backfilled > 0) notes.push(`No activities were picked for ${backfilled} ${backfilled === 1 ? 'role' : 'roles'}; chose the highlighted and achievement ones by rule.`)

  // Flat sections: truncate in the model's rank order.
  const flat = {} as Record<FlatSection, SelectedItem[]>
  const keptFlat = new Set<string>()
  const flatSectionOf = new Map<string, FlatSection>()
  for (const s of FLAT_SECTIONS) {
    const known = new Set(cands[s].map((c) => c.id))
    for (const id of known) flatSectionOf.set(id, s)
    const limit = clampBudget(brief.budgets[s], FLAT_CAPS[s])
    const picks = rank(s, out[s], known)
    let kept = picks.slice(0, limit)
    for (const p of picks.slice(limit)) dropReason.set(p.id, 'over_cap')
    if (s === 'education' && kept.length === 0 && limit > 0 && cands.education.length > 0) {
      kept = cands.education.slice(0, limit).map((c) => ({ id: c.id, reason: '' }))
      notes.push('The model picked no education; kept the most recent entries.')
    }
    flat[s] = kept.map((p) => item(p.id, p.reason))
    for (const k of kept) keptFlat.add(k.id)
  }

  // What was dropped: every candidate that is not kept, with why. Not-selected
  // items of roles that are not kept are not listed one by one.
  const dropped: DroppedItem[] = unknownIds.slice(0, MAX_RECORDED_DROPPED)
  let droppedTotal = unknown + duplicates
  const addDrop = (section: string, id: string, why: DropReason) => {
    droppedTotal++
    if (dropped.length < MAX_RECORDED_DROPPED) {
      const parentId = section === 'activities' ? parentOf.get(id) : undefined
      dropped.push({ section, id, label: labels.get(id) ?? '', ...(parentId ? { parentId } : {}), why })
    }
  }
  for (const e of cands.experiences) {
    if (keptRoleIds.has(e.id)) {
      for (const a of e.activities) if (!keptActIds.has(a.id)) addDrop('activities', a.id, dropReason.get(a.id) ?? 'not_selected')
    } else {
      addDrop('experiences', e.id, dropReason.get(e.id) ?? 'not_selected')
      for (const a of e.activities) if (dropReason.get(a.id) === 'role_not_kept') addDrop('activities', a.id, 'role_not_kept')
    }
  }
  for (const s of FLAT_SECTIONS) for (const c of cands[s]) if (!keptFlat.has(c.id)) addDrop(s, c.id, dropReason.get(c.id) ?? 'not_selected')

  if (unknown > 0) notes.push(`Dropped ${unknown} ${unknown === 1 ? 'id' : 'ids'} that are not in the profile.`)
  const overCap = [...dropReason.values()].filter((w) => w === 'over_cap').length
  if (overCap > 0) notes.push(`Cut ${overCap} ${overCap === 1 ? 'pick' : 'picks'} over the limits.`)

  return {
    selection: { mode, experiences, activities, ...flat, dropped, droppedTotal },
    notes,
    recognised,
  }
}

// ── Fallback (rules, no model) ──────────────────────────────────────────────

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'their', 'into', 'across', 'role', 'team', 'work', 'experience', 'strong'])

/** Lower-case words of at least 3 characters, without filler. */
export function briefTerms(brief: Pick<CvBrief, 'leadWith' | 'emphasise'>): string[] {
  const text = [...brief.leadWith, ...brief.emphasise.map((e) => e.item)].join(' ').toLowerCase()
  const words = text.split(/[^a-z0-9+#.]+/).map((w) => w.replace(/^\.+|\.+$/g, '')).filter((w) => w.length >= 3 && !STOPWORDS.has(w))
  return [...new Set(words)]
}

function matches(text: string, terms: readonly string[]): string[] {
  const words = new Set(text.toLowerCase().split(/[^a-z0-9+#.]+/).map((w) => w.replace(/^\.+|\.+$/g, '')))
  return terms.filter((t) => words.has(t))
}

/**
 * Picks by rules when the model cannot: roles and items matching the brief's
 * terms first, then recency / highlighted / achievement / evidence-backed.
 * Returns picks, not a selection: `enforceSelection` applies the caps.
 */
export function fallbackPicks(brief: Pick<CvBrief, 'leadWith' | 'emphasise'>, cands: Candidates): SelectOutput {
  const terms = briefTerms(brief)
  const matchReason = (m: string[], otherwise = '') => (m.length > 0 ? `Matches the brief: ${m.slice(0, 3).join(', ')}` : otherwise)

  const roles = cands.experiences
    .map((e, idx) => {
      const m = matches([e.label, ...e.activities.map((a) => a.text)].join(' '), terms)
      return { e, idx, m }
    })
    .sort((x, y) => y.m.length - x.m.length || x.idx - y.idx)

  const ranked = <T extends { id: string; label: string; detail: string | null; proven: boolean }>(items: readonly T[]) =>
    items
      .map((i, idx) => ({ i, idx, m: matches(`${i.label} ${i.detail ?? ''}`, terms) }))
      .sort((x, y) => y.m.length - x.m.length || Number(y.i.proven) - Number(x.i.proven) || x.idx - y.idx)
      .map(({ i, m }) => ({ id: i.id, reason: matchReason(m) }))

  return {
    experiences: roles.map(({ e, m }) => ({ id: e.id, reason: matchReason(m, 'Recent role') })),
    activities: cands.experiences.flatMap((e) =>
      e.activities
        .map((a, idx) => ({ a, idx, m: matches(`${a.text} ${a.impact ?? ''}`, terms) }))
        .sort((x, y) => (activityRank(y.a) + 2 * y.m.length) - (activityRank(x.a) + 2 * x.m.length) || x.idx - y.idx)
        .map(({ a, m }) => ({
          experienceId: e.id,
          id: a.id,
          reason: matchReason(m, a.highlighted ? 'Highlighted in your profile' : a.kind === 'achievement' ? 'An achievement' : ''),
        })),
    ),
    skills: ranked(cands.skills),
    tools: ranked(cands.tools),
    competencies: ranked(cands.competencies),
    certifications: ranked(cands.certifications),
    education: cands.education.map((c) => ({ id: c.id, reason: '' })),
    projects: ranked(cands.projects),
  }
}

/** The fallback selection: rule picks run through the same caps. */
export function fallbackSelection(brief: CvBrief, cands: Candidates): EnforceResult {
  return enforceSelection(fallbackPicks(brief, cands), cands, brief, 'fallback')
}

// ── The stage ───────────────────────────────────────────────────────────────

export type SelectResult = {
  selection: CvSelection
  /** The model that answered; null when the fallback chose. */
  model: string | null
  retries: number
  notes: string[]
}

/** Runs Select. Never throws for a failed or unusable model answer: the fallback chooses. */
export async function runSelect(
  g: Gathered,
  brief: CvBrief,
  ctx: { profileId: string; jobApplicationId: string; runId: string; deadline: number },
): Promise<SelectResult> {
  let failure: string
  let retries = 0
  try {
    const instructions = await loadCVSelectPrompt(ctx.profileId)
    const call = await completeValidated(ctx.profileId, selectPrompt(brief, g.candidates), SelectOutputSchema, {
      role: 'fast',
      system: composeSystem(instructions, OUTPUT_FORMAT),
      maxOutputTokens: MAX_OUTPUT_TOKENS.select,
      retryMaxOutputTokens: MAX_OUTPUT_TOKENS.selectRetry,
      temperature: 0.1,
      timeoutMs: TIME_BUDGET_MS.select,
      deadline: ctx.deadline,
      feature: CV_GENERATION_FEATURES.select,
      attribution: { jobApplicationId: ctx.jobApplicationId, runId: ctx.runId },
      label: 'selection',
    })
    retries = call.retries
    const enforced = enforceSelection(call.value, g.candidates, brief, 'model')
    if (enforced.recognised > 0) {
      return { selection: enforced.selection, model: call.model, retries, notes: enforced.notes }
    }
    failure = 'the answer named no item that is in the profile'
  } catch (err) {
    failure = err instanceof LLMError ? `the call failed (${err.kind})` : 'the call failed'
    if (!(err instanceof LLMError)) console.error('[cv-generation] select failed', { runId: ctx.runId, err })
  }
  const fb = fallbackSelection(brief, g.candidates)
  return {
    selection: fb.selection,
    model: null,
    retries,
    notes: [`Chose by rules instead: ${failure}.`, ...fb.notes],
  }
}

// ── Log lines ───────────────────────────────────────────────────────────────

/**
 * What the Select log entry lists: kept items by section, and the items code
 * cut (not the ones the model simply left out, which are only counted).
 */
export function selectionLogLines(sel: CvSelection): { kept: string[]; dropped: string[]; notSelected: number } {
  const roleLabel = new Map(sel.experiences.map((e) => [e.id, e.label]))
  const kept: string[] = []
  for (const e of sel.experiences) {
    kept.push(`${SECTION_NAME.experiences}: ${e.label}`)
    for (const a of sel.activities[e.id] ?? []) kept.push(`${SECTION_NAME.activities}: ${a.label} (${roleLabel.get(e.id)})`)
  }
  for (const s of FLAT_SECTIONS) for (const i of sel[s]) kept.push(`${SECTION_NAME[s]}: ${i.label}`)
  const cut = sel.dropped.filter((d) => d.why !== 'not_selected')
  const dropped = cut.map((d) => `${SECTION_NAME[d.section] ?? d.section}: ${d.label || d.id} (${DROP_REASON_LABEL[d.why]})`)
  return { kept, dropped, notSelected: Math.max(0, sel.droppedTotal - cut.length) }
}
