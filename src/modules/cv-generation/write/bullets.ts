/**
 * Rules about the bullets of one employer entry, all pure (no DB, no network,
 * no model). Used by the experience writer after every answer:
 *
 * - the bullet allowance (the Select allocation, +1 for each lead-with project
 *   that needs a bullet of its own) and the deterministic trim that enforces it
 *   after the last attempt;
 * - which selected projects the Brief names in `leadWith`, and whether such a
 *   project really has its own bullet or only a trailing clause;
 * - a play-down item that has become a bullet of its own;
 * - present tense on a completed or measured result.
 *
 * Every check here is SOFT (one retry with feedback, then accepted and logged);
 * only the allowance is enforced in code, by trimming, and never fails the run.
 */

import type { CvBrief } from '../schema'
import { contentStems, figuresIn, normalised, phraseIndex, projectNameKey } from './checks'
import type { EmployerEvidence } from './evidence'
import { isThinProject } from './limits'

/** A bullet beyond the allocation that a lead-with project is allowed to need (one per such project). */
export const LEAD_WITH_PROJECT_EXTRA_BULLETS = 1

/** `text` is the project's evidence text; when given, a thin project (limits.ts) is recognised by it. */
type ProjectRef = { id?: string; name: string; text?: string }

/** A selected project the Brief names in `leadWith`, with the line that frames it. */
export type LeadWithProject = { name: string; key: string; line: string }

/**
 * The selected projects of an employer that the Brief names in `leadWith`
 * (matched by project name, years and versions ignored), each with the first
 * lead-with line that names it. In the order of `projects`.
 */
export function leadWithProjects(projects: readonly ProjectRef[], leadWith: readonly string[]): LeadWithProject[] {
  return matchLeads(projects, leadWith, false)
}

/**
 * The lead-with projects that have too little text to write from (limits.ts
 * isThinProject): the Brief names them, but there is no evidence behind the
 * framing line, so they get no own bullet and no check asks for one.
 */
export function thinLeadWithProjects(projects: readonly ProjectRef[], leadWith: readonly string[]): LeadWithProject[] {
  return matchLeads(projects, leadWith, true)
}

function matchLeads(projects: readonly ProjectRef[], leadWith: readonly string[], thin: boolean): LeadWithProject[] {
  const out: LeadWithProject[] = []
  for (const p of projects) {
    if ((p.text !== undefined && isThinProject({ name: p.name, text: p.text })) !== thin) continue
    const key = projectNameKey(p.name)
    if (!key) continue
    const line = leadWith.find((l) => phraseIndex(l, key) >= 0)
    if (line) out.push({ name: p.name, key, line })
  }
  return out
}

/**
 * The most bullets an employer entry may have: the allocation Select gave it
 * (its selected activities), plus LEAD_WITH_PROJECT_EXTRA_BULLETS for each
 * lead-with project (that one needs a bullet of its own). Other projects are
 * merged into a bullet and add nothing. An employer with only project evidence
 * (no activities) may still have one bullet.
 */
export function bulletAllowance(emp: Pick<EmployerEvidence, 'activities' | 'projects'>, brief: Pick<CvBrief, 'leadWith'>): number {
  const extra = leadWithProjects(emp.projects, brief.leadWith).length * LEAD_WITH_PROJECT_EXTRA_BULLETS
  return Math.max(emp.activities.length + extra, emp.projects.length > 0 ? 1 : 0)
}

// ── Lead-with project: its own bullet ───────────────────────────────────────

/**
 * Where a lead-with project stands in the bullets:
 * `own` = some bullet names it in its first half (the bullet is about it);
 * `trailing` = it is named, but only late in a bullet (a trailing clause);
 * `missing` = no bullet names it.
 * Best effort on the project's name: a bullet that describes it without
 * naming it counts as `missing`.
 */
export function leadWithStanding(bullets: readonly string[], project: Pick<LeadWithProject, 'key'>): 'own' | 'trailing' | 'missing' {
  let named = false
  for (const b of bullets) {
    const at = phraseIndex(b, project.key)
    if (at < 0) continue
    named = true
    if (at * 2 < normalised(b).length) return 'own'
  }
  return named ? 'trailing' : 'missing'
}

/** Whether a bullet is the own bullet of one of the lead-with projects. */
export function isOwnBulletOf(bullet: string, leads: readonly Pick<LeadWithProject, 'key'>[]): boolean {
  return leads.some((l) => leadWithStanding([bullet], l) === 'own')
}

// ── Trimming to the allowance ───────────────────────────────────────────────

/** Whether a bullet reflects a Brief item (a lead-with line or an emphasise item): a project named in both, or two shared content words (one when the item has only one). */
export function reflectsItem(bullet: string, item: string, projectKeys: readonly string[] = []): boolean {
  if (projectKeys.some((k) => phraseIndex(item, k) >= 0 && phraseIndex(bullet, k) >= 0)) return true
  const wanted = contentStems(item)
  if (wanted.size === 0) return false
  const have = contentStems(bullet)
  let shared = 0
  for (const w of wanted) if (have.has(w)) shared++
  return shared >= Math.min(2, wanted.size)
}

/**
 * Cuts `bullets` to `allowance`, deterministically. Kept first: the own bullet
 * of a lead-with project, then bullets that reflect a lead-with or emphasise
 * item, then the writer's order. The kept bullets stay in the writer's order.
 * Returns what was cut so the log can name it.
 */
export function trimBullets(
  bullets: readonly string[],
  brief: Pick<CvBrief, 'leadWith' | 'emphasise'>,
  projects: readonly ProjectRef[],
  allowance: number,
): { bullets: string[]; trimmed: string[] } {
  if (bullets.length <= allowance) return { bullets: [...bullets], trimmed: [] }
  const items = [...brief.leadWith, ...brief.emphasise.map((e) => e.item)]
  const keys = projects.map((p) => projectNameKey(p.name)).filter(Boolean)
  const leads = leadWithProjects(projects, brief.leadWith)
  const tier = (b: string) => (isOwnBulletOf(b, leads) ? 0 : items.some((it) => reflectsItem(b, it, keys)) ? 1 : 2)
  const ranked = bullets.map((b, i) => ({ i, tier: tier(b) })).sort((x, y) => x.tier - y.tier || x.i - y.i)
  const keep = new Set(ranked.slice(0, Math.max(0, allowance)).map((r) => r.i))
  return { bullets: bullets.filter((_, i) => keep.has(i)), trimmed: bullets.filter((_, i) => !keep.has(i)) }
}

/** A bullet shortened for a log note. */
/**
 * Whether a bullet is a near-verbatim copy of the summary sentence: it has at
 * least 3 content words and at least 85% of them (stems, so tense and plural do not
 * hide it) occur in the summary. Such a bullet is a title-like responsibility
 * that repeats the summary and adds no outcome, scope or figure. Pure.
 */
export function repeatsSummary(bullet: string, summary: string): boolean {
  const b = [...contentStems(bullet)]
  if (b.length < 3 || /\d/.test(bullet)) return false // a figure is something the summary does not say
  const s = contentStems(summary)
  return b.filter((w) => s.has(w)).length / b.length >= 0.85
}

export function shortened(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

// ── Play down ───────────────────────────────────────────────────────────────

/**
 * Bullets (by 0-based index) that are dominated by a Brief play-down item: they
 * name at least two of its words (all of them when it has fewer), starting in
 * the first half of the bullet, so the play-down item IS the bullet rather than
 * a clause inside another one. Words the Brief also asks to lead with or
 * emphasise do not count (they would contradict themselves). Best effort.
 */
export function playDownBullets(bullets: readonly string[], brief: Pick<CvBrief, 'leadWith' | 'emphasise' | 'playDown'>): Array<{ item: string; index: number }> {
  const wanted = new Set([...brief.leadWith, ...brief.emphasise.map((e) => e.item)].flatMap((t) => [...contentStems(t, 3)]))
  const out: Array<{ item: string; index: number }> = []
  for (const item of brief.playDown) {
    const terms = [...contentStems(item, 3)].filter((t) => !wanted.has(t))
    if (terms.length === 0) continue
    const need = Math.min(2, terms.length)
    bullets.forEach((b, index) => {
      const words = normalised(b)
      const stems = words.map((w) => w.slice(0, 5))
      const hit = new Set(terms.filter((t) => stems.includes(t)))
      if (hit.size < need) return
      const first = stems.findIndex((s) => hit.has(s))
      if (first >= 0 && first * 2 < words.length && !out.some((o) => o.item === item && o.index === index)) out.push({ item, index })
    })
  }
  return out
}

// ── Tense ───────────────────────────────────────────────────────────────────

/** Verbs a bullet may open with, in the plain form. Their third-person present forms ("Drives", "Delivers") are what the check looks for. */
const LEAD_VERBS = [
  'drive', 'deliver', 'lead', 'manage', 'build', 'own', 'launch', 'grow', 'create', 'develop', 'design', 'ship', 'scale', 'cut', 'reduce',
  'increase', 'improve', 'oversee', 'direct', 'coordinate', 'establish', 'implement', 'optimise', 'optimize', 'streamline', 'secure', 'earn',
  'generate', 'produce', 'achieve', 'reach', 'partner', 'collaborate', 'define', 'shape', 'champion', 'spearhead', 'orchestrate', 'execute',
  'negotiate', 'transform', 'introduce', 'standardise', 'standardize', 'automate', 'mentor', 'train', 'save', 'boost', 'expand', 'unify',
  'deploy', 'migrate', 'publish', 'accelerate', 'unlock', 'win', 'attract', 'engage', 'influence', 'run', 'rebuild', 'redesign', 'initiate',
]

const thirdPerson = (v: string) => (/[^aeiou]y$/.test(v) ? `${v.slice(0, -1)}ies` : /(?:s|x|z|ch|sh)$/.test(v) ? `${v}es` : `${v}s`)
const PRESENT_LEADS = new Set(LEAD_VERBS.map(thirdPerson))

/** Whether a line opens with a third-person present-tense verb ("Drives 14,000+ voters", "Delivers 9.4M reach"). A curated verb list, so a noun that happens to end in "s" is never flagged. */
export function opensInPresentTense(line: string): boolean {
  const first = normalised(line)[0]
  return !!first && PRESENT_LEADS.has(first)
}

/**
 * Lines that are in the wrong tense for the role. A finished role is past
 * tense throughout, so any line (summary or bullet) opening in the present is
 * wrong. In the current role the summary and ongoing responsibilities may be
 * present tense, but a COMPLETED achievement or measured result is past tense:
 * only a bullet that states a figure is flagged there.
 */
export function wrongTenseLines(parts: { summary: string; bullets: readonly string[] }, current: boolean): string[] {
  const lines = current ? parts.bullets.filter((b) => figuresIn(b).length > 0) : [parts.summary, ...parts.bullets]
  return lines.filter((l) => opensInPresentTense(l))
}
