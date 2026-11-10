import TurndownService from 'turndown'

export type ExtractedJob = {
  title?: string
  company?: string
  location?: string
  jobDescription?: string
  jobNumber?: string
  datePublished?: Date
  salaryBand?: string
}

export type ExtractionResult =
  | { ok: true; data: ExtractedJob }
  | { ok: false; error: string; timedOut?: true }

export const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' })
td.remove(['script', 'style', 'noscript'])

export function decode(s: string | undefined): string | undefined {
  return s ? decodeEntities(s) : s
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', GBP: '£', EUR: '€', CAD: 'CA$', AUD: 'A$',
}

export function abbrevAmount(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

export function formatSalaryBand(baseSalary: unknown): string | undefined {
  if (!baseSalary || typeof baseSalary !== 'object') return undefined
  const sal = baseSalary as Record<string, unknown>
  const curr = typeof sal.currency === 'string' ? sal.currency : 'USD'
  const sym = CURRENCY_SYMBOLS[curr] ?? (curr + ' ')
  const qv = sal.value && typeof sal.value === 'object' ? sal.value as Record<string, unknown> : null
  if (qv) {
    const min = typeof qv.minValue === 'number' ? qv.minValue : null
    const max = typeof qv.maxValue === 'number' ? qv.maxValue : null
    const flat = typeof qv.value === 'number' ? qv.value : null
    if (min !== null && max !== null) return `${sym}${abbrevAmount(min)}–${sym}${abbrevAmount(max)}`
    if (flat !== null) return `${sym}${abbrevAmount(flat)}`
  }
  if (typeof sal.value === 'number') return `${sym}${abbrevAmount(sal.value)}`
  return undefined
}

export const COMPLETE_THRESHOLD = 0.65

export function scoreCompleteness(data: ExtractedJob): number {
  let score = 0
  if (data.title)          score += 0.25
  if (data.company)        score += 0.25
  if (data.jobDescription) score += 0.40
  if (data.location || data.salaryBand || data.datePublished || data.jobNumber) score += 0.10
  return score
}

export function mergeExtractedJob(base: ExtractedJob, overlay: ExtractedJob): ExtractedJob {
  return {
    title:          base.title          || overlay.title,
    company:        base.company        || overlay.company,
    location:       base.location       || overlay.location,
    jobDescription: base.jobDescription || overlay.jobDescription,
    jobNumber:      base.jobNumber      || overlay.jobNumber,
    datePublished:  base.datePublished  || overlay.datePublished,
    salaryBand:     base.salaryBand     || overlay.salaryBand,
  }
}
