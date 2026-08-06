import type { CVDocumentContent, CVSection } from './schema'
import type {
  KeywordCoverageDetail,
  KeywordMatch,
  ImpliedKeywordMatch,
  TitleAlignmentDetail,
  SectionCompletenessDetail,
  SenioritySignalDetail,
  ATSScoreBreakdown,
} from './ats-score-schema'

// ── Stop words ───────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  // Function words / prepositions / conjunctions
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
  'against', 'between', 'out', 'off', 'over', 'under', 'per', 'via',
  'upon', 'across', 'along', 'among', 'within', 'without', 'toward',
  'towards', 'beyond', 'below', 'above', 'behind', 'around', 'beside',

  // Auxiliary / modal verbs
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'shall', 'can', 'need', 'dare', 'ought', 'used', 'able',

  // Pronouns
  'you', 'your', 'we', 'our', 'they', 'their', 'it', 'its', 'his', 'her',
  'hers', 'him', 'them', 'us', 'who', 'whom', 'whose', 'me', 'my', 'mine',
  'he', 'she',

  // Demonstratives / interrogatives / connectors
  'this', 'that', 'these', 'those', 'what', 'which', 'when', 'where', 'why',
  'how', 'not', 'no', 'nor', 'so', 'yet', 'both', 'either', 'neither',
  'as', 'if', 'then', 'than', 'because', 'while', 'although', 'though',
  'since', 'unless', 'until', 'after', 'before', 'some', 'any', 'all',
  'each', 'every', 'few', 'more', 'most', 'other', 'such', 'own', 'same',
  'another', 'much', 'many', 'less', 'least', 'even', 'also', 'just',
  'still', 'already', 'ever', 'never', 'always', 'often', 'sometimes',
  'usually', 'here', 'there', 'now', 'then', 'very', 'really', 'quite',
  'rather', 'especially', 'particularly', 'generally', 'typically', 'well',

  // Common non-technical verbs (but NOT 'work' or 'ability' — preserved for test compat)
  'get', 'give', 'take', 'make', 'let', 'put', 'see', 'look', 'feel',
  'seem', 'become', 'keep', 'turn', 'try', 'ask', 'say', 'tell', 'call',
  'come', 'go', 'move', 'run', 'bring', 'happen', 'set', 'meet', 'follow',
  'start', 'stop', 'open', 'close', 'allow', 'begin', 'end', 'find', 'show',
  'hold', 'join', 'seek', 'want', 'know', 'think', 'believe', 'mean', 'own',
  'serve', 'help', 'use', 'apply', 'ensure', 'enable', 'share', 'inform',
  'create', 'build', 'grow', 'improve', 'provide', 'include', 'drive',
  'lead', 'solve', 'learn', 'send', 'receive', 'produce', 'perform',
  'report', 'represent', 'engage', 'contribute', 'communicate', 'collaborate',
  'coordinate', 'facilitate', 'participate', 'navigate', 'leverage',
  'demonstrate', 'define', 'identify', 'deliver', 'manage', 'support',
  'maintain', 'develop', 'execute',

  // Common adjectives / descriptors
  'new', 'old', 'big', 'small', 'large', 'long', 'short', 'high', 'low',
  'next', 'last', 'right', 'best', 'real', 'full', 'hard', 'early', 'clear',
  'free', 'easy', 'true', 'fast', 'deep', 'wide', 'safe', 'far', 'bad',
  'ready', 'light', 'top', 'current', 'recent', 'major', 'whole', 'entire',
  'various', 'diverse', 'broad', 'global', 'local', 'unique', 'common',
  'typical', 'standard', 'direct', 'simple', 'complex', 'flexible',
  'robust', 'reliable', 'stable', 'effective', 'efficient', 'significant',
  'important', 'relevant', 'specific', 'general', 'additional', 'available',
  'responsible', 'similar', 'related', 'certain', 'necessary', 'possible',
  'likely', 'different', 'successful', 'exceptional', 'innovative',
  'inclusive', 'ambitious', 'autonomous', 'passionate', 'proactive',
  'collaborative', 'comfortable', 'ambiguous', 'genuine', 'meaningful',
  'independent', 'dynamic', 'diverse', 'critical', 'multiple', 'several',

  // Common non-technical nouns
  'people', 'time', 'way', 'life', 'world', 'hand', 'part', 'place', 'case',
  'week', 'day', 'month', 'point', 'fact', 'number', 'line', 'home', 'side',
  'kind', 'thing', 'things', 'member', 'members', 'area', 'areas', 'type',
  'types', 'list', 'group', 'groups', 'level', 'levels', 'rate', 'range',
  'value', 'values', 'goal', 'goals', 'focus', 'issue', 'issues', 'impact',
  'path', 'step', 'steps', 'style', 'process', 'moment', 'direction',
  'sense', 'potential', 'person', 'individual', 'someone', 'anyone',
  'everyone', 'something', 'everything', 'anything', 'nothing', 'others',
  'effort', 'efforts', 'result', 'results', 'approach', 'context', 'culture',
  'mission', 'vision', 'values', 'opportunity', 'growth', 'success',

  // JD signal words that are boilerplate (the keyword follows, not "essential" itself)
  'essential', 'must', 'mandatory', 'crucial', 'needed', 'needed',

  // JD boilerplate / HR terms
  'role', 'job', 'position', 'candidate', 'applicant', 'hire', 'hiring',
  'recruit', 'department', 'office', 'location', 'remote', 'hybrid',
  'onsite', 'visa', 'sponsorship', 'compensation', 'salary', 'equity',
  'commission', 'benefits', 'healthcare', 'insurance', 'perks', 'workplace',
  'diversity', 'inclusion', 'equal', 'accommodation', 'disability', 'veteran',
  'interview', 'assessment', 'screening', 'background', 'check', 'offer',
  'deadline', 'qualified', 'combination', 'study', 'degree', 'bachelor',
  'master', 'education', 'training', 'credential',
  'team', 'company', 'organization', 'strong', 'good', 'excellent', 'great',
  'skills', 'knowledge', 'understanding', 'experience', 'years',
  'minimum', 'required', 'preferred', 'ideally', 'plus', 'bonus', 'etc',

  // Discourse markers
  'including', 'following', 'example', 'examples', 'however', 'therefore',
  'furthermore', 'moreover', 'additionally', 'consequently', 'otherwise',
  'instead', 'whereas', 'regardless', 'despite',
])

// ── Seniority levels ──────────────────────────────────────────────────────────

const SENIORITY_LEVELS: Record<string, number> = {
  junior: 1, entry: 1, graduate: 1, associate: 2, mid: 3,
  senior: 4, sr: 4, lead: 5, staff: 5, principal: 6, head: 7,
  director: 7, vp: 8, chief: 9,
}

// ── Text utilities ───────────────────────────────────────────────────────────

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenize(text: string): string[] {
  if (!text.trim()) return []
  return normalizeText(text)
    .split(' ')
    .filter(token => token.length > 2 && !STOP_WORDS.has(token))
}

// ── JD parsing ───────────────────────────────────────────────────────────────

// Regex patterns for JD section markers — match any line containing the keyword
// so headers like "## Requirements:", "Basic Qualifications", "**Must Have**" all work.
const REQUIRED_SECTION_RE = /^[^\n]*\b(?:requirements?|qualifications?|basic\s+qualifications?|minimum\s+qualifications?|required\s+qualifications?|key\s+requirements?|core\s+requirements?|must\s+have|what\s+(?:we(?:'re|\s+are)\s+looking\s+for|you(?:'ll|\s+will)\s+(?:need|bring|have))|what\s+we\s+need|about\s+you)\b[^\n]*\n/im
const PREFERRED_SECTION_RE = /^[^\n]*\b(?:nice\s+to\s+have|preferred\s+qualifications?|plus(?:es)?|would\s+be\s+great|ideal(?:ly)?)\b[^\n]*\n/im
const NEXT_SECTION_RE = /^(?:#+\s|\*\*|__|\w[^\n]*:\s*$)/m

// Signal words in individual bullet lines that mark a bullet as "preferred" (not required)
const PREFERRED_BULLET_SIGNAL_RE = /\b(?:prefer(?:red)?|bonus|nice\s+to\s+have|ideal|optional|helpful|advantageous)\b/i

function extractSection(jdText: string, startPattern: RegExp): string | null {
  const match = startPattern.exec(jdText)
  if (!match) return null
  const start = match.index + match[0].length
  const remaining = jdText.slice(start)
  const nextMatch = NEXT_SECTION_RE.exec(remaining)
  return nextMatch ? remaining.slice(0, nextMatch.index) : remaining
}

// Fallback when no structured section headers are detected: extract tokens only
// from bullet-pointed lines. JD requirements are almost always bulleted; prose
// sections (company intro, benefits copy) rarely are, so this filters the noise
// that caused the original "hundreds of common words" bug.
function extractKeywordsFromBullets(jdText: string): { required: string[]; preferred: string[] } {
  const BULLET_RE = /^[ \t]*[-*•·]\s+(.+)$/

  const required: string[] = []
  const preferred: string[] = []

  for (const line of jdText.split('\n')) {
    const match = BULLET_RE.exec(line)
    if (!match) continue
    const content = match[1]
    const tokens = tokenize(content)
    if (PREFERRED_BULLET_SIGNAL_RE.test(content)) {
      preferred.push(...tokens)
    } else {
      required.push(...tokens)
    }
  }

  const requiredSet = new Set(required)
  return {
    required: [...requiredSet],
    preferred: [...new Set(preferred)].filter(t => !requiredSet.has(t)),
  }
}

export function extractJDKeywords(jdText: string): { required: string[]; preferred: string[] } {
  const requiredSection = extractSection(jdText, REQUIRED_SECTION_RE)
  const preferredSection = extractSection(jdText, PREFERRED_SECTION_RE)

  if (!requiredSection && !preferredSection) {
    return extractKeywordsFromBullets(jdText)
  }

  const requiredTokens = requiredSection ? tokenize(requiredSection) : []
  const requiredSet = new Set(requiredTokens)
  const preferredTokens = preferredSection
    ? tokenize(preferredSection).filter(t => !requiredSet.has(t))
    : []

  return { required: requiredTokens, preferred: preferredTokens }
}

export function extractJDTitle(jdText: string): string | null {
  // Try markdown H1 heading at start
  const h1Match = /^#\s+(.+)$/m.exec(jdText)
  if (h1Match) return h1Match[1].trim()

  // Try "Role:" or "Position:" prefix
  const roleMatch = /^(?:role|position|title|job\s+title)\s*:\s*(.+)$/im.exec(jdText)
  if (roleMatch) return roleMatch[1].trim()

  return null
}

export function extractJDYearsRequired(jdText: string): number | null {
  const pattern = /(\d+)\+?\s*(?:to\s*\d+)?\s*years?/gi
  const matches = [...jdText.matchAll(pattern)]
  if (matches.length === 0) return null
  return Math.max(...matches.map(m => parseInt(m[1], 10)))
}

export function extractJDSeniorityLevel(jdText: string): number | null {
  const lower = jdText.toLowerCase()
  // Check in descending order to return the highest matched level
  const levels = Object.entries(SENIORITY_LEVELS).sort((a, b) => b[1] - a[1])
  for (const [keyword, level] of levels) {
    if (new RegExp(`\\b${keyword}\\b`).test(lower)) {
      return level
    }
  }
  return null
}

export function inferExpectedSections(jdText: string): string[] {
  const sections: string[] = ['skills', 'experience'] // always expected
  const lower = jdText.toLowerCase()

  if (/\b(?:tool|platform|software|system|docker|kubernetes|aws|gcp|azure)\b/.test(lower)) {
    sections.push('tools')
  }
  if (/\b(?:degree|bachelor|master|phd|bsc|msc|computer science|engineering)\b/.test(lower)) {
    sections.push('education')
  }
  if (/\b(?:certif|pmp|cpa|cfa|cia|cissp)/.test(lower)) {
    sections.push('certifications')
  }

  return [...new Set(sections)]
}

// ── CV text extraction ───────────────────────────────────────────────────────

export type SectionToken = {
  text: string
  sectionType: string
  weight: number
}

export function extractCVSectionTokens(cvContent: CVDocumentContent): SectionToken[] {
  const tokens: SectionToken[] = []

  for (const section of cvContent.sections.filter(s => s.visible)) {
    switch (section.type) {
      case 'skills':
        for (const item of section.data.items) {
          tokens.push({ text: item.toLowerCase(), sectionType: 'skills', weight: 1.0 })
        }
        break
      case 'tools':
        for (const item of section.data.items) {
          tokens.push({ text: item.toLowerCase(), sectionType: 'tools', weight: 1.0 })
        }
        break
      case 'competencies':
        for (const item of section.data.items) {
          tokens.push({ text: item.toLowerCase(), sectionType: 'competencies', weight: 0.9 })
        }
        break
      case 'capabilities':
        for (const item of section.data.items) {
          tokens.push({ text: item.toLowerCase(), sectionType: 'capabilities', weight: 0.9 })
        }
        break
      case 'experience': {
        const d = section.data
        const titleText = d.titles.join(' ').toLowerCase()
        tokens.push({ text: titleText, sectionType: 'exp-title', weight: 0.9 })
        const bodyText = [d.description, d.subtitle, ...d.outcomes].filter(Boolean).join(' ').toLowerCase()
        tokens.push({ text: bodyText, sectionType: 'exp-body', weight: 0.7 })
        break
      }
      case 'profile':
        tokens.push({ text: section.data.content.toLowerCase(), sectionType: 'profile', weight: 0.6 })
        break
      case 'education': {
        const d = section.data
        const text = [d.qualification, d.field, d.institution].filter(Boolean).join(' ').toLowerCase()
        tokens.push({ text, sectionType: 'education', weight: 0.5 })
        break
      }
      case 'certification':
        tokens.push({ text: section.data.name.toLowerCase(), sectionType: 'certification', weight: 0.5 })
        break
      // header, languages: intentionally skipped — not scored by ATS engine
    }
  }

  return tokens
}

export function parseDurationToYears(duration: string): number {
  const MONTH_MAP: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  }

  const parts = duration.split(/\s*[–—-]\s*/)
  if (parts.length < 2) return 0
  const [startStr, endStr] = parts

  function parseDate(s: string): Date | null {
    const lower = s.toLowerCase().trim()
    if (['present', 'current', 'now', 'today'].includes(lower)) return new Date()

    const monthYear = lower.match(/([a-z]{3})\s+(\d{4})/)
    if (monthYear) {
      const month = MONTH_MAP[monthYear[1]]
      const year = parseInt(monthYear[2], 10)
      if (month !== undefined && !isNaN(year)) return new Date(year, month, 1)
    }

    const yearOnly = lower.match(/^(\d{4})$/)
    if (yearOnly) return new Date(parseInt(yearOnly[1], 10), 6, 1)

    return null
  }

  const start = parseDate(startStr)
  const end = parseDate(endStr)
  if (!start || !end) return 0

  return Math.max(0, (end.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
}

// ── Keyword matching helper ───────────────────────────────────────────────────

function keywordMatchesToken(keyword: string, token: SectionToken): boolean {
  const kw = normalizeText(keyword)
  if (kw.length < 3) return false
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`).test(token.text)
}

function findBestMatch(
  keyword: string,
  sectionTokens: SectionToken[],
): { section: string; sectionWeight: number } | null {
  let best: { section: string; sectionWeight: number } | null = null
  for (const token of sectionTokens) {
    if (keywordMatchesToken(keyword, token)) {
      if (!best || token.weight > best.sectionWeight) {
        best = { section: token.sectionType, sectionWeight: token.weight }
      }
    }
  }
  return best
}

// ── Dimension 1: Keyword Coverage (weight: 0.45) ─────────────────────────────

export function scoreKeywordCoverage(
  cvContent: CVDocumentContent,
  requiredKeywords: string[],
  preferredKeywords: string[],
  impliedKeywords: string[],
): KeywordCoverageDetail {
  const WEIGHT = 0.45
  const sectionTokens = extractCVSectionTokens(cvContent)

  const matchedRequired: KeywordMatch[] = []
  const missingRequired: string[] = []
  const matchedPreferred: KeywordMatch[] = []
  const missingPreferred: string[] = []
  const matchedImplied: ImpliedKeywordMatch[] = []
  const missingImplied: string[] = []

  for (const kw of requiredKeywords) {
    const match = findBestMatch(kw, sectionTokens)
    if (match) matchedRequired.push({ keyword: kw, ...match })
    else missingRequired.push(kw)
  }

  for (const kw of preferredKeywords) {
    const match = findBestMatch(kw, sectionTokens)
    if (match) matchedPreferred.push({ keyword: kw, ...match })
    else missingPreferred.push(kw)
  }

  for (const kw of impliedKeywords) {
    const match = findBestMatch(kw, sectionTokens)
    if (match) matchedImplied.push({ keyword: kw, section: match.section })
    else missingImplied.push(kw)
  }

  const totalRequired = requiredKeywords.length
  const totalPreferred = preferredKeywords.length
  const totalImplied = impliedKeywords.length

  // Required contributes 70% of score, section-weighted (skills match > body match)
  const requiredScore = totalRequired === 0
    ? 1
    : matchedRequired.reduce((s, m) => s + m.sectionWeight, 0) / totalRequired

  // Preferred explicit: section-weighted match rate
  const preferredExplicitScore = totalPreferred === 0
    ? 1
    : matchedPreferred.reduce((s, m) => s + m.sectionWeight, 0) / totalPreferred

  // Implied: flat match rate (no section weight — they're bonus signals), capped at 0.5
  const impliedScore = totalImplied === 0
    ? 1
    : (matchedImplied.length / totalImplied) * 0.5

  // Preferred score blends explicit preferred (75%) and implied (25%)
  const preferredScore = totalPreferred === 0 && totalImplied === 0
    ? 1
    : preferredExplicitScore * 0.75 + impliedScore * 0.25

  // Only include preferredScore in the blend when there ARE preferred/implied keywords
  const hasPreferredOrImplied = totalPreferred > 0 || totalImplied > 0

  const raw = hasPreferredOrImplied
    ? (requiredScore * 0.70 + preferredScore * 0.30) * 100
    : requiredScore * 100

  const score = Math.min(100, Math.max(0, Math.round(raw)))

  return {
    score,
    weight: WEIGHT,
    weightedContribution: score * WEIGHT,
    matchedRequired,
    matchedPreferred,
    matchedImplied,
    missingRequired,
    missingPreferred,
    missingImplied,
  }
}

// ── Dimension 2: Title Alignment (weight: 0.20) ───────────────────────────────

export function scoreTitleAlignment(
  cvContent: CVDocumentContent,
  jdTitle: string | null,
): TitleAlignmentDetail {
  const WEIGHT = 0.20

  const mostRecentExp = cvContent.sections
    .filter(s => s.visible && s.type === 'experience')
    .at(0)

  const cvTitle = mostRecentExp?.type === 'experience'
    ? mostRecentExp.data.titles[0] ?? null
    : null

  if (!jdTitle || !cvTitle) {
    return {
      score: 50, weight: WEIGHT, weightedContribution: 50 * WEIGHT,
      jdTitle: jdTitle ?? null, cvTitle: cvTitle ?? null, matchedTokens: [],
    }
  }

  const jdTokens = new Set(tokenize(jdTitle))
  const cvTokens = new Set(tokenize(cvTitle))

  const intersection = [...jdTokens].filter(t => cvTokens.has(t))
  const union = new Set([...jdTokens, ...cvTokens])

  const jaccard = union.size === 0 ? 0 : intersection.length / union.size
  const score = Math.round(jaccard * 100)

  return {
    score,
    weight: WEIGHT,
    weightedContribution: score * WEIGHT,
    jdTitle,
    cvTitle,
    matchedTokens: intersection,
  }
}

// ── Dimension 3: Section Completeness (weight: 0.20) ─────────────────────────

// Baseline sections assumed present on any CV — excluded from contextual scoring
const COMPLETENESS_BASELINE = new Set(['skills', 'experience'])

// Maps inferExpectedSections output strings → actual CVSection type discriminant
const SECTION_TYPE_MAP: Record<string, string> = {
  certifications: 'certification',
}

export function scoreSectionCompleteness(
  cvContent: CVDocumentContent,
  jdText: string,
): SectionCompletenessDetail {
  const WEIGHT = 0.20
  const allExpected = inferExpectedSections(jdText)
  // Only score contextual sections — baseline sections are assumed on every CV
  const expectedSections = allExpected.filter(s => !COMPLETENESS_BASELINE.has(s))

  if (expectedSections.length === 0) {
    return {
      score: 100, weight: WEIGHT, weightedContribution: 100 * WEIGHT,
      expectedSections: [], presentSections: [], missingSections: [],
    }
  }

  const visibleTypes = new Set(
    cvContent.sections.filter(s => s.visible).map(s => s.type),
  )

  const presentSections: string[] = []
  const missingSections: string[] = []

  for (const expected of expectedSections) {
    const sectionType = SECTION_TYPE_MAP[expected] ?? expected
    // skills and tools are interchangeable for completeness purposes
    const found = expected === 'skills'
      ? visibleTypes.has('skills') || visibleTypes.has('tools')
      : expected === 'tools'
      ? visibleTypes.has('tools') || visibleTypes.has('skills')
      : visibleTypes.has(sectionType as CVSection['type'])

    if (found) presentSections.push(expected)
    else missingSections.push(expected)
  }

  const score = Math.round((presentSections.length / expectedSections.length) * 100)

  return {
    score,
    weight: WEIGHT,
    weightedContribution: score * WEIGHT,
    expectedSections,
    presentSections,
    missingSections,
  }
}

// ── Dimension 4: Seniority Signal (weight: 0.15) ─────────────────────────────

export function scoreSenioritySignal(
  cvContent: CVDocumentContent,
  jdText: string,
): SenioritySignalDetail {
  const WEIGHT = 0.15

  const cvTotalYears = cvContent.sections
    .filter(s => s.visible && s.type === 'experience')
    .reduce((sum, s) => {
      if (s.type !== 'experience') return sum
      return sum + parseDurationToYears(s.data.duration)
    }, 0)

  const jdRequiredYears = extractJDYearsRequired(jdText)

  if (jdRequiredYears !== null) {
    const score = Math.min(100, Math.round((cvTotalYears / jdRequiredYears) * 100))
    return {
      score, weight: WEIGHT, weightedContribution: score * WEIGHT,
      jdRequiredYears, cvTotalYears, seniorityBasis: 'years',
    }
  }

  // Keyword-based seniority: compare JD seniority level to CV's most recent title seniority
  const jdSeniorityLevel = extractJDSeniorityLevel(jdText)
  const cvSeniorityLevel = extractJDSeniorityLevel(
    cvContent.sections
      .filter(s => s.visible && s.type === 'experience')
      .flatMap(s => s.type === 'experience' ? s.data.titles : [])
      .join(' '),
  )

  if (jdSeniorityLevel === null || cvSeniorityLevel === null) {
    return {
      score: 60, weight: WEIGHT, weightedContribution: 60 * WEIGHT,
      jdRequiredYears: null, cvTotalYears, seniorityBasis: 'neutral',
    }
  }

  const diff = Math.abs(jdSeniorityLevel - cvSeniorityLevel)
  const score = diff === 0 ? 100 : diff === 1 ? 70 : 40

  return {
    score, weight: WEIGHT, weightedContribution: score * WEIGHT,
    jdRequiredYears: null, cvTotalYears, seniorityBasis: 'keywords',
  }
}

// ── Score aggregation ─────────────────────────────────────────────────────────

function deriveLabel(score: number): ATSScoreBreakdown['label'] {
  if (score >= 85) return 'excellent'
  if (score >= 70) return 'strong'
  if (score >= 55) return 'good'
  if (score >= 40) return 'fair'
  return 'poor'
}

export function scoreATS(
  cvContent: CVDocumentContent,
  jobDescription: string,
  impliedKeywords: string[],
): ATSScoreBreakdown {
  const { required, preferred } = extractJDKeywords(jobDescription)
  const jdTitle = extractJDTitle(jobDescription)

  const keywordCoverage = scoreKeywordCoverage(cvContent, required, preferred, impliedKeywords)
  const titleAlignment = scoreTitleAlignment(cvContent, jdTitle)
  const sectionCompleteness = scoreSectionCompleteness(cvContent, jobDescription)
  const senioritySignal = scoreSenioritySignal(cvContent, jobDescription)

  const finalScore = Math.round(
    keywordCoverage.weightedContribution +
    titleAlignment.weightedContribution +
    sectionCompleteness.weightedContribution +
    senioritySignal.weightedContribution,
  )

  return {
    finalScore: Math.min(100, Math.max(0, finalScore)),
    label: deriveLabel(finalScore),
    dimensions: { keywordCoverage, titleAlignment, sectionCompleteness, senioritySignal },
  }
}
