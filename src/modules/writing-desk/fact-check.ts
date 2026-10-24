// Best-effort, warnings-only fact check of a CV draft against the profile.
// Compares employers, date ranges and qualifications found in the Markdown.
// Silent whenever a fact cannot be extracted: a wrong warning on a correct CV
// is worse than a missed one. Never throws and never blocks anything.

import type { ProfileSnapshot } from '@/modules/profile/snapshot'

export type FactWarning = {
  kind: 'employer' | 'dates' | 'qualification'
  message: string
  excerpt: string
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const DATE = `(?:(\\d{1,2})\\/(\\d{4})|(?:(${MONTHS.join('|')})[a-z]*\\.?\\s+)?(\\d{4}))`
const RANGE = new RegExp(
  `(?<![\\d/])${DATE}\\s*[-–—]\\s*(?:${DATE}|(present|current|now))(?![\\d/])`,
  'i',
)

type Point = { year: number; month: number | null }
type Range = { start: Point; end: Point | 'present' }

function parseRange(line: string): Range | null {
  const m = RANGE.exec(line)
  if (!m) return null
  const point = (numMonth?: string, numYear?: string, name?: string, year?: string): Point | null => {
    if (numYear) {
      const month = Number(numMonth)
      return month >= 1 && month <= 12 ? { year: Number(numYear), month } : null
    }
    if (year) return { year: Number(year), month: name ? MONTHS.indexOf(name.toLowerCase()) + 1 : null }
    return null
  }
  const start = point(m[1], m[2], m[3], m[4])
  if (!start) return null
  if (m[9]) return { start, end: 'present' }
  const end = point(m[5], m[6], m[7], m[8])
  return end ? { start, end } : null
}

type Span = { start: Date; end: Date | null }

function pointMatches(p: Point, date: Date): boolean {
  if (p.year !== date.getUTCFullYear()) return false
  return p.month === null || p.month === date.getUTCMonth() + 1
}

function rangeMatches(r: Range, s: Span): boolean {
  if (!pointMatches(r.start, s.start)) return false
  if (r.end === 'present') return s.end === null
  return s.end !== null && pointMatches(r.end, s.end)
}

function fmt(d: Date | null): string {
  return d ? `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : 'Present'
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function containsName(haystack: string, name: string): boolean {
  const n = name.trim()
  if (!n) return false
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, 'iu').test(haystack)
}

function coreCompanyName(company: string): string {
  const stripped = company
    .replace(/[,.]?\s+(ltd|limited|inc|llc|llp|plc|corp|corporation|gmbh|co|company)\.?$/i, '')
    .trim()
  return stripped || company.trim()
}

const DEGREE_ABBREVIATIONS = /(?<![\p{L}\p{N}])(BSc|BA|MSc|MA|MBA|PhD)(?![\p{L}\p{N}])/u
const DEGREE_WORDS = /(?<![\p{L}\p{N}])(Bachelor|Master|Doctor)/iu

function degreeKeywords(line: string): string[] {
  const found: string[] = []
  const abbr = DEGREE_ABBREVIATIONS.exec(line)
  if (abbr) found.push(abbr[1])
  const word = DEGREE_WORDS.exec(line)
  if (word) found.push(word[1])
  return found
}

function excerptOf(line: string): string {
  const t = line.trim()
  return t.length > 200 ? `${t.slice(0, 197)}...` : t
}

export function checkFacts(markdown: string, profile: ProfileSnapshot): FactWarning[] {
  const warnings: FactWarning[] = []
  const lines = markdown.split(/\r?\n/)

  let fence: { char: string; length: number } | null = null
  let inEducation = false
  // Content since the most recent heading (inclusive), used as context for a date line.
  let context: string[] = []

  for (const raw of lines) {
    const text = raw.trim()

    const fenceMatch = /^(`{3,}|~{3,})/.exec(text)
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.length && text === fenceMatch[1]) {
        fence = null
      }
      continue
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length }
      continue
    }
    if (text.startsWith(':::') || text === '') continue

    const heading = /^(#{1,6})\s+(.*)$/.exec(text)
    if (heading) {
      if (heading[1].length <= 2) inEducation = /education/i.test(heading[2])
      context = [text]
      continue
    }
    context.push(text)

    if (inEducation) {
      const keywords = degreeKeywords(text)
      if (keywords.length === 0) continue
      const scope = context.join('\n')
      const recognised =
        profile.educations.some(
          e => containsName(scope, e.qualification) || containsName(scope, e.institution),
        ) ||
        profile.educations.some(e =>
          keywords.some(k => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(k)}`, 'iu').test(e.qualification)),
        )
      if (!recognised) {
        warnings.push({
          kind: 'qualification',
          message: 'This qualification does not match any qualification or institution in your profile.',
          excerpt: excerptOf(text),
        })
      }
      continue
    }

    const range = parseRange(text)
    if (!range) continue
    const scope = context.join('\n')

    let matched = profile.experiences.filter(e => containsName(scope, coreCompanyName(e.company)))
    if (matched.length === 0) matched = profile.experiences.filter(e => containsName(scope, e.role))

    if (matched.length === 0) {
      warnings.push({
        kind: 'employer',
        message: 'No employer or role in your profile matches this entry.',
        excerpt: excerptOf(text),
      })
      continue
    }

    const spans: Span[] = matched.map(e => ({ start: e.startDate, end: e.endDate }))
    // A merged tenure may span several roles at one employer.
    const merged: Span = {
      start: new Date(Math.min(...spans.map(s => s.start.getTime()))),
      end: spans.some(s => s.end === null)
        ? null
        : new Date(Math.max(...spans.map(s => s.end!.getTime()))),
    }
    if ([...spans, merged].some(s => rangeMatches(range, s))) continue

    const actual = spans.length === 1 ? spans[0] : merged
    warnings.push({
      kind: 'dates',
      message: `Dates differ from your profile, which has ${fmt(actual.start)} – ${fmt(actual.end)} for ${matched[0].company}.`,
      excerpt: excerptOf(text),
    })
  }

  return warnings
}
