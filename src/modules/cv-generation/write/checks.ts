/**
 * Code checks on writer output. Pure: no DB, no network, no model. The writers
 * (experience.ts, profile.ts) call these after every answer; a soft problem is
 * retried once with feedback and then accepted and logged (call.ts,
 * completeChecked).
 *
 * Owner policies enforced here (docs/cv-generation.md, Phase 3):
 * - every number, percentage, currency figure, spelled-out number and
 *   multiplier ("doubled") must be supported by the evidence the writer was
 *   given, compared by VALUE (14k = 14,000; forty percent = 40%);
 * - a claimed (unevidenced) skill, tool or competency may be named in bullets
 *   and the profile only when the job's requirements name it;
 * - no job title, company name or date the model introduced;
 * - no certification or education the evidence does not mention, and an
 *   in-progress one only with in-progress wording.
 */

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

// ── Figures ─────────────────────────────────────────────────────────────────

const UNIT_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS_WORDS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const SCALE_WORDS: Record<string, number> = { hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9 }
/** "doubled", "twice" and friends → the multiplier they mean, as the key "<n>x". */
const MULTIPLIER_WORDS: Record<string, number> = {
  double: 2, doubled: 2, doubling: 2, twice: 2, twofold: 2, triple: 3, tripled: 3, tripling: 3, threefold: 3,
  quadruple: 4, quadrupled: 4, fourfold: 4, quintupled: 5, fivefold: 5, tenfold: 10, halved: 0.5,
}
const MAGNITUDE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 }

/** A figure: digits with optional separators, decimals, a magnitude (k, m, bn, million) or a percent sign; a currency sign is ignored. Digit runs touching a letter (B2B, Q3, 1st) or joined by "/" (24/7) are not figures. */
const FIGURE_RE = /(?<![\p{L}\p{N}.,]|\d\/)[£$€]?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s?(%)|\s?(billion|million|thousand|bn)\b|([kmbx]))?(?![\p{L}\p{N}]|\/\d)/giu

export type Figure = {
  /** The canonical value: "14000", "40%", "3x". */
  key: string
  /** As written in the text. */
  raw: string
}

const numKey = (n: number) => String(Number(n.toPrecision(12)))

function digitFigures(text: string): Figure[] {
  const prepared = text.replace(/(\d)\s*(?:percent|per cent)\b/gi, '$1%')
  const out: Figure[] = []
  for (const m of prepared.matchAll(FIGURE_RE)) {
    const value = Number(`${m[1].replace(/,/g, '')}${m[2] ?? ''}`)
    const word = (m[4] ?? '').toLowerCase()
    const letter = (m[5] ?? '').toLowerCase()
    let key: string
    if (m[3]) key = `${numKey(value)}%`
    else if (letter === 'x') key = `${numKey(value)}x`
    else if (word || letter) key = numKey(value * (MAGNITUDE[word || letter] ?? 1))
    else key = numKey(value)
    out.push({ key, raw: m[0].trim() })
  }
  return out
}

/** Spelled-out numbers, multipliers and "a dozen" in a text. `bareOne` also counts a lone "one" (too common in prose to check in an output). */
function wordFigures(text: string, bareOne: boolean): Figure[] {
  const tokens = [...text.matchAll(/[\p{L}\p{N}']+/gu)].map((m) => ({ w: m[0].toLowerCase(), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))
  const isNumberWord = (w: string) => w in UNIT_WORDS || w in TENS_WORDS || w in SCALE_WORDS || w === 'dozen'
  const out: Figure[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.w in MULTIPLIER_WORDS) {
      out.push({ key: `${numKey(MULTIPLIER_WORDS[t.w])}x`, raw: text.slice(t.start, t.end) })
      continue
    }
    // A scale word alone ("2 million": the digits already read it) does not start a figure; "a hundred" and "three hundred" do.
    const startsPhrase = (isNumberWord(t.w) && !(t.w in SCALE_WORDS)) || ((t.w === 'a' || t.w === 'an') && tokens[i + 1] && (tokens[i + 1].w in SCALE_WORDS || tokens[i + 1].w === 'dozen'))
    if (!startsPhrase) continue
    let j = i
    if (t.w === 'a' || t.w === 'an') j++
    let total = 0
    let current = 0
    let tokenCount = 0
    let hasScale = false
    for (; j < tokens.length; j++) {
      const w = tokens[j].w
      if (w in UNIT_WORDS) current += UNIT_WORDS[w]
      else if (w in TENS_WORDS) current += TENS_WORDS[w]
      else if (w === 'dozen') current = (current || 1) * 12
      else if (w === 'hundred') { current = (current || 1) * 100; hasScale = true }
      else if (w === 'thousand' || w === 'million' || w === 'billion') { total += (current || 1) * SCALE_WORDS[w]; current = 0; hasScale = true }
      else if (w === 'and' && tokenCount > 0 && tokens[j + 1] && isNumberWord(tokens[j + 1].w) && hasScale) { /* "one hundred and five" */ tokenCount++; continue }
      else break
      tokenCount++
    }
    const last = tokens[j - 1]
    const value = total + current
    const bare = tokenCount === 1 && tokens[i].w === 'one'
    i = j - 1
    if (bare && !bareOne) continue
    const next = tokens[j]
    const percent = next && (next.w === 'percent' || (next.w === 'per' && tokens[j + 1]?.w === 'cent'))
    out.push({ key: percent ? `${numKey(value)}%` : numKey(value), raw: text.slice(t.start, (percent ? (next.w === 'percent' ? next.end : tokens[j + 1].end) : last.end)) })
  }
  return out
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const nameRe = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name.trim())}(?![\\p{L}\\p{N}])`, 'giu')

/** Text with the given names (skills, tools, certifications) blanked out: digits inside "ISO 27001" are part of a name, not a figure. */
function withoutNames(text: string, names: readonly string[]): string {
  let out = text
  for (const n of names) if (/\d/.test(n) && n.trim().length >= 2) out = out.replace(nameRe(n), ' ')
  return out
}

/** The figures in a text, by value, in order of appearance. "40 percent", "forty percent" and "40%" are the same figure; 14k is 14,000. */
export function figuresIn(text: string, opts: { names?: readonly string[]; bareOne?: boolean } = {}): Figure[] {
  const t = withoutNames(text, opts.names ?? [])
  return [...digitFigures(t), ...wordFigures(t, opts.bareOne ?? false)]
}

/** The values an evidence set supports (a lone "one" counts too). */
export function supportedFigures(evidence: readonly string[], names: readonly string[] = []): Set<string> {
  const out = new Set<string>()
  for (const text of evidence) for (const f of figuresIn(text, { names, bareOne: true })) out.add(f.key)
  return out
}

/** Figures of `output` that no evidence text supports (by value), as written in the output. */
export function unsupportedFigures(output: string, evidence: readonly string[], names: readonly string[] = []): string[] {
  const ok = supportedFigures(evidence, names)
  const bad: string[] = []
  for (const f of figuresIn(output, { names })) if (!ok.has(f.key) && !bad.includes(f.raw)) bad.push(f.raw)
  return bad
}

// ── Repeated figures ────────────────────────────────────────────────────────

/**
 * A figure worth guarding against repetition: a percentage, a multiplier, or a
 * number of 100 or more (14,000+, £500k, "doubled"). Small bare numbers ("3
 * markets", "8 teams") and years are not: two different facts often share them,
 * and a retry for that would cost more than the repetition does.
 */
export function isNotableFigure(f: Figure): boolean {
  if (/[%x]$/.test(f.key)) return true
  if (/^(?:19|20)\d{2}$/.test(f.raw.replace(/^[£$€]/, '').trim())) return false
  return Number(f.key) >= 100
}

const notableIn = (text: string, names: readonly string[]) => figuresIn(text, { names }).filter(isNotableFigure)

/** Notable figures (by value) that appear more than once across `parts`, as first written. */
export function repeatedFigures(parts: readonly string[], names: readonly string[] = []): string[] {
  const seen = new Map<string, { raw: string; n: number }>()
  for (const part of parts) {
    for (const f of notableIn(part, names)) {
      const e = seen.get(f.key)
      if (e) e.n++
      else seen.set(f.key, { raw: f.raw, n: 1 })
    }
  }
  return [...seen.values()].filter((e) => e.n > 1).map((e) => e.raw)
}

/** Notable figures of `text` (by value) that also appear in any of `others`, as written in `text`. */
export function sharedFigures(text: string, others: readonly string[], names: readonly string[] = []): string[] {
  const taken = new Set(others.flatMap((o) => notableIn(o, names).map((f) => f.key)))
  const out: string[] = []
  for (const f of notableIn(text, names)) if (taken.has(f.key) && !out.includes(f.raw)) out.push(f.raw)
  return out
}

/** The distinct notable figures in `text`, as first written. */
export function distinctNotableFigures(text: string, names: readonly string[] = []): string[] {
  const seen = new Map<string, string>()
  for (const f of notableIn(text, names)) if (!seen.has(f.key)) seen.set(f.key, f.raw)
  return [...seen.values()]
}

// ── Projects ────────────────────────────────────────────────────────────────

const distinctiveWords = (text: string) => new Set(text.toLowerCase().split(/[^\p{L}\p{N}+#]+/u).filter((w) => w.length >= 5))

/**
 * Whether `output` reflects a selected project: it names the project, or it
 * uses at least two of the project's own distinctive words (5+ letters; all of
 * them when the project has fewer). Best effort: a paraphrase with no shared
 * word is a false negative, which costs one retry and a log note, never a
 * failed run.
 */
export function projectReflected(output: string, project: { name: string; text: string }): boolean {
  if (containsPhrase(output, project.name)) return true
  const mine = [...distinctiveWords(`${project.name} ${project.text}`)]
  if (mine.length === 0) return true
  const theirs = distinctiveWords(output)
  return mine.filter((w) => theirs.has(w)).length >= Math.min(2, mine.length)
}

// ── Competency labels ───────────────────────────────────────────────────────

/** Why a Core Competencies label is not a short noun phrase (2-5 words, no numbers, no sentence), or null when it is fine. */
export function competencyLabelProblem(label: string, bounds: { min: number; max: number }): string | null {
  const l = label.trim()
  const n = wordCount(l)
  if (n < bounds.min) return `"${l}" is ${n === 0 ? 'empty' : 'one word'}; use ${bounds.min} to ${bounds.max} words`
  if (n > bounds.max) return `"${l}" is ${n} words; use ${bounds.min} to ${bounds.max}`
  if (figuresIn(l, { bareOne: true }).length > 0 || /\d/.test(l)) return `"${l}" has a number; labels carry no numbers`
  if (/[.;:!?]/.test(l)) return `"${l}" reads as a sentence; use a plain noun phrase`
  return null
}

// ── Names ───────────────────────────────────────────────────────────────────

const SHORT_NAME_MAX = 2
const SHORT_NAME_JOINERS = "\\-&/'’"

/**
 * Whole-word, case-insensitive phrase match. A name of two characters or fewer
 * ("C", "R", "Go") is matched case-sensitively and not when it touches "-", "&",
 * "/" or an apostrophe, so "C" is not in "C-suite", "R" not in "R&D" and "Go"
 * not in "go-to-market".
 */
export function containsPhrase(text: string, phrase: string): boolean {
  const p = phrase.trim()
  if (!p) return false
  if ([...p].length <= SHORT_NAME_MAX) {
    return new RegExp(`(?<![\\p{L}\\p{N}${SHORT_NAME_JOINERS}])${escapeRe(p)}(?![\\p{L}\\p{N}${SHORT_NAME_JOINERS}])`, 'u').test(text)
  }
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p)}(?![\\p{L}\\p{N}])`, 'iu').test(text)
}

/**
 * Best-effort aliases (the same thing under another name), kept tiny on
 * purpose. Anything not listed here is a known gap: a claimed "Tableau Desktop"
 * is not matched as "Tableau". Each group is mutually equivalent.
 */
const ALIAS_GROUPS: string[][] = [
  ['GA4', 'Google Analytics'],
  ['JavaScript', 'JS'],
  ['Kubernetes', 'K8s'],
  ['PostgreSQL', 'Postgres'],
]

/** The name and its aliases. */
export function nameVariants(name: string): string[] {
  const n = name.trim()
  const group = ALIAS_GROUPS.find((g) => g.some((a) => a.toLowerCase() === n.toLowerCase()))
  return group ? [n, ...group.filter((a) => a.toLowerCase() !== n.toLowerCase())] : [n]
}

/** Whether `text` contains the name or one of its aliases. */
export function mentionsName(text: string, name: string): boolean {
  return nameVariants(name).some((v) => containsPhrase(text, v))
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
    if (!key || seen.has(key) || !mentionsName(output, name)) continue
    seen.add(key)
    if (mentionsName(opts.evidenceText, name)) continue
    hits.push({ name: name.trim(), requested: mentionsName(opts.requirementText, name) })
  }
  return hits
}

/**
 * Capitalised title-like phrases ("Head of Delivery", "Senior Product Manager",
 * "Chief Operating Officer"). Best effort: it only sees capitalised phrases, so
 * "head of delivery" in lower case passes.
 */
const CAP = "[A-Z][\\w&'’-]+"
const TITLE_LIKE = new RegExp(
  [
    `\\b(?:Head|Director|Vice President|VP|Manager|Chief)\\s+of\\s+${CAP}(?:\\s+(?:and\\s+)?${CAP})*`,
    `\\bChief\\s+${CAP}(?:\\s+${CAP})*\\s+Officer\\b`,
    `\\b(?:Senior|Junior|Lead|Principal|Associate|Staff)\\s+(?:${CAP}\\s+){0,3}(?:Manager|Director|Engineer|Analyst|Consultant|Officer|Architect|Specialist|Producer|Designer|Developer|Coordinator|Lead)\\b`,
  ].join('|'),
  'gu',
)

/** Title-like phrases in `text` that neither the candidate's titles nor the evidence text contain. */
export function titleLikePhrases(text: string, titles: readonly string[], evidenceText: string): string[] {
  const found: string[] = []
  for (const m of text.matchAll(TITLE_LIKE)) {
    const phrase = m[0].trim()
    if (found.some((f) => f.toLowerCase() === phrase.toLowerCase())) continue
    if (titles.some((t) => containsPhrase(t, phrase) || containsPhrase(phrase, t.trim() || '\u0000')) || containsPhrase(evidenceText, phrase)) continue
    found.push(phrase)
  }
  return found
}

/**
 * Titles and company names of the profile that `output` mentions although the
 * evidence text does not: the model must not write titles or employers (code
 * renders them). `titles` also holds title-like phrases ("As Head of
 * Delivery...") that are not one of the profile's titles (best effort).
 * Returns the offending strings.
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
  const titles = pick(names.titles)
  for (const p of titleLikePhrases(output, names.titles, evidenceText)) if (!titles.some((t) => t.toLowerCase() === p.toLowerCase())) titles.push(p)
  return { titles, companies: pick(names.companies) }
}

// ── Certifications and education ────────────────────────────────────────────

export type CredentialRef = {
  name: string
  /** Still in progress: it may be named only with in-progress wording in the same sentence. */
  inProgress: boolean
}

const IN_PROGRESS_NEAR = /\b(in[\s-]?progress|ongoing|studying|working towards|pursuing|currently|completing|enrolled|expected|towards)\b/i

/**
 * Certification and education names that `output` mentions without support:
 * a name the evidence text does not contain, or an in-progress one that is
 * not written with in-progress wording ("PMP-certified" for a PMP that is
 * still being studied for). Returns a problem sentence per name.
 */
export function credentialProblems(output: string, creds: readonly CredentialRef[], evidenceText: string): Array<{ name: string; inProgress: boolean; problem: string }> {
  const sentences = output.split(/(?<=[.!?;])\s+|\n+/)
  const out: Array<{ name: string; inProgress: boolean; problem: string }> = []
  for (const c of creds) {
    const name = c.name.trim()
    if (!name || out.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue
    const where = sentences.filter((s) => containsPhrase(s, name))
    if (where.length === 0) continue
    if (c.inProgress) {
      if (!where.every((s) => IN_PROGRESS_NEAR.test(s))) {
        out.push({ name, inProgress: true, problem: `"${name}" is not finished yet: name it only as in progress ("studying for ${name}"), never as held or earned` })
      }
    } else if (!containsPhrase(evidenceText, name)) {
      out.push({ name, inProgress: false, problem: `"${name}" is a certification or qualification the evidence does not mention, so do not name it` })
    }
  }
  return out
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
