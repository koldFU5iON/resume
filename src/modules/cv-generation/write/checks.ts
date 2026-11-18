/**
 * Code checks on writer output. Pure: no DB, no network, no model. The writers
 * (experience.ts, profile.ts) call these after every answer; a soft problem is
 * retried once with feedback and then accepted and logged (call.ts,
 * completeChecked).
 *
 * Owner policies enforced here (docs/cv-generation.md, Phase 3):
 * - every number, percentage or currency figure must appear in the evidence
 *   the writer was given (numbers verbatim);
 * - a claimed (unevidenced) skill, tool or competency may be named in bullets
 *   and the profile only when the job's requirements name it;
 * - no job title, company name or date the model introduced.
 */

import { validateDraftMarkdown } from '@/modules/writing-desk/validate'

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

// ── Figures ─────────────────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
}
const NUMBER_WORD_RE = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'gi')

/** A figure: digits with optional separators, decimals, a magnitude (k, m, bn, x) or a percent sign; a currency sign is ignored. */
const FIGURE_RE = /[£$€]?\d[\d,]*(?:\.\d+)?(?:\s?%|\s?(?:bn|[kmbx])(?![a-z]))?/gi

/** "$2.5M", "40 %", "1,200" → "2.5m", "40%", "1200". */
function normaliseFigure(raw: string): string {
  return raw.toLowerCase().replace(/[£$€,\s]/g, '').replace(/^0+(?=\d)/, '')
}

/** The figures in a text, normalised, in order of appearance. "40 percent" counts as "40%". */
export function figuresIn(text: string): string[] {
  const prepared = text.replace(/(\d)\s*(?:percent|per cent)\b/gi, '$1%')
  return [...prepared.matchAll(FIGURE_RE)].map((m) => normaliseFigure(m[0])).filter(Boolean)
}

/** Figures an evidence text supports: its digits, plus its spelled-out numbers ("twelve" → "12"). */
export function supportedFigures(evidence: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const text of evidence) {
    for (const f of figuresIn(text)) out.add(f)
    for (const m of text.matchAll(NUMBER_WORD_RE)) out.add(String(NUMBER_WORDS[m[1].toLowerCase()]))
  }
  return out
}

/** Figures of `output` that no evidence text contains (verbatim after normalising), as written in the output. */
export function unsupportedFigures(output: string, evidence: readonly string[]): string[] {
  const ok = supportedFigures(evidence)
  const bad: string[] = []
  const prepared = output.replace(/(\d)\s*(?:percent|per cent)\b/gi, '$1%')
  for (const m of prepared.matchAll(FIGURE_RE)) {
    const n = normaliseFigure(m[0])
    if (n && !ok.has(n) && !bad.includes(m[0].trim())) bad.push(m[0].trim())
  }
  return bad
}

// ── Names ───────────────────────────────────────────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-word, case-insensitive phrase match. */
export function containsPhrase(text: string, phrase: string): boolean {
  const p = phrase.trim()
  if (!p) return false
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p)}(?![\\p{L}\\p{N}])`, 'iu').test(text)
}

export type ClaimedHit = {
  name: string
  /** The job's requirements name it, so the writer may use it (and it is worth a quick check). */
  requested: boolean
}

/**
 * Claimed (unevidenced) names that `output` mentions. A name the evidence text
 * itself contains is not claimed in effect (the candidate's own words use it)
 * and is not reported. `requested` says whether the job's requirement text
 * names it.
 */
export function claimedHits(
  output: string,
  claimed: readonly string[],
  opts: { evidenceText: string; requirementText: string },
): ClaimedHit[] {
  const seen = new Set<string>()
  const hits: ClaimedHit[] = []
  for (const name of claimed) {
    const key = name.trim().toLowerCase()
    if (!key || seen.has(key) || !containsPhrase(output, name)) continue
    seen.add(key)
    if (containsPhrase(opts.evidenceText, name)) continue
    hits.push({ name: name.trim(), requested: containsPhrase(opts.requirementText, name) })
  }
  return hits
}

/**
 * Titles and company names of the profile that `output` mentions although the
 * evidence text does not: the model must not write titles or employers (code
 * renders them). Returns the offending strings.
 */
export function introducedNames(
  output: string,
  names: { titles: readonly string[]; companies: readonly string[] },
  evidenceText: string,
): { titles: string[]; companies: string[] } {
  const pick = (list: readonly string[]) => {
    const found: string[] = []
    for (const n of list) {
      const t = n.trim()
      if (t.length < 3 || found.some((f) => f.toLowerCase() === t.toLowerCase())) continue
      if (containsPhrase(output, t) && !containsPhrase(evidenceText, t)) found.push(t)
    }
    return found
  }
  return { titles: pick(names.titles), companies: pick(names.companies) }
}

/** Words in `text` from a list of job-title / seniority words that none of the candidate's own titles contain. */
const TITLE_WORDS = ['senior', 'junior', 'lead', 'head of', 'director', 'vp', 'vice president', 'chief', 'cto', 'ceo', 'coo', 'cfo', 'principal', 'manager', 'officer', 'president', 'founder', 'consultant', 'engineer', 'architect', 'analyst']

/**
 * Why a headline reads as an employment title claim, or null. It must be a
 * descriptor, not a title: it may not equal or contain one of the candidate's
 * titles, nor use a title or seniority word (Senior, Head of, Director,
 * Manager...) that none of their own titles uses.
 */
export function headlineTitleProblem(headline: string, titles: readonly string[]): string | null {
  const h = headline.trim()
  if (!h) return null
  const own = titles.map((t) => t.toLowerCase())
  const matched = titles.find((t) => t.trim().length >= 3 && containsPhrase(h, t))
  if (matched) return `it contains the job title "${matched}"; titles are facts shown by code, so write a descriptor of what the person does, not a title`
  const word = TITLE_WORDS.find((w) => containsPhrase(h, w) && !own.some((t) => containsPhrase(t, w)))
  if (word) return `it uses "${word}", which reads as a title or seniority claim the profile does not make; write a descriptor, not a title`
  return null
}

// ── Blocks ──────────────────────────────────────────────────────────────────

/**
 * Checks that `block` is exactly one `:::<id>` block holding one simple list and
 * returns its bullets (one line each, "- " stripped), or the problems. Uses the
 * writing desk's own validator, so what passes here renders there.
 */
export function parseListBlock(block: string, id: string): { ok: true; bullets: string[] } | { ok: false; problems: string[] } {
  const text = block.trim().replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  const problems: string[] = []
  if (lines[0]?.trim() !== `:::${id}`) problems.push(`the block must start with a line ":::${id}"`)
  if (lines[lines.length - 1]?.trim() !== ':::') problems.push('the block must end with a line ":::"')
  if (problems.length > 0) return { ok: false, problems }
  const inner = lines.slice(1, -1).filter((l) => l.trim() !== '')
  const bullets: string[] = []
  for (const l of inner) {
    const m = /^- (\S.*)$/.exec(l.trim())
    if (!m) problems.push(`every line inside the block must be one "- " bullet on a single line (got: "${l.trim().slice(0, 40)}")`)
    else bullets.push(m[1].trim())
  }
  if (bullets.length === 0 && problems.length === 0) problems.push('the block has no bullets')
  if (problems.length > 0) return { ok: false, problems }
  const v = validateDraftMarkdown(text)
  const bad = v.issues.filter((i) => i.severity !== 'info').map((i) => i.message)
  return bad.length > 0 ? { ok: false, problems: bad } : { ok: true, bullets }
}
