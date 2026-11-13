import * as z from 'zod'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { completeStructured, type LlmAttribution } from '@/modules/llm/client'
import { LLMError } from '@/modules/llm/errors'
import type { ExtractedJob, ExtractionResult } from './extract-utils'

export const ExtractedJobLLMSchema = z.object({
  title:          z.string().optional().describe('Job title exactly as written'),
  company:        z.string().optional().describe('Hiring company name'),
  location:       z.string().optional().describe('Office location or "Remote"'),
  jobDescription: z.string().optional().describe('Full job description text, preserve all detail'),
  jobNumber:      z.string().optional().describe('Job ID or requisition number visible on the page'),
  salaryBand:     z.string().optional().describe('Salary range as a short string, e.g. "$120k–$160k"'),
  datePublished:  z.string().optional().describe('ISO date string if a posting date is visible on the page'),
})

const NOISE_TAGS_RE = /<(script|style|noscript|nav|header|footer|aside|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi
const ALL_TAGS_RE = /<[^>]+>/g
const MAX_CHARS = 12_000

export function stripHtmlToText(html: string): string {
  return html
    .replace(NOISE_TAGS_RE, '')
    .replace(ALL_TAGS_RE, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS)
}

export function extractReadableContent(html: string): string {
  try {
    const { document } = parseHTML(html)
    const reader = new Readability(document as unknown as Document)
    const article = reader.parse()
    if (article?.textContent) {
      return article.textContent.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS)
    }
  } catch { /* fall through to regex stripper */ }
  return stripHtmlToText(html)
}

const NO_KEY_ERROR = 'No job details found. Add an LLM key in Settings to enable AI extraction, or paste manually.'

export type ExtractWithLLMOptions = {
  /** Usage feature tag. Default 'job-extract' (the capture/extract flows). */
  feature?: string
  /** Default 400 (the capture/extract flows). */
  maxOutputTokens?: number
  /** Abort after this many ms; a timeout returns `{ ok: false, timedOut: true }`. */
  timeoutMs?: number
  /** Log only zod issue paths on invalid output (the raw output echoes page text). */
  redactInvalidOutput?: boolean
  /** Set when the job row already exists (e.g. assessment enrichment); capture flows have none. */
  attribution?: LlmAttribution
}

/**
 * LLM fallback for job-page extraction. Takes `profileId` explicitly (no
 * session lookup) so it also works inside after() and bearer-token routes;
 * null means "no signed-in profile" and returns the add-a-key message.
 */
export async function extractWithLLM(
  html: string,
  profileId: string | null,
  opts: ExtractWithLLMOptions = {},
): Promise<ExtractionResult> {
  if (!profileId) return { ok: false, error: NO_KEY_ERROR }

  const text = extractReadableContent(html)
  const prompt = `Extract the job posting details from the following webpage text. Return only what is explicitly present — do not infer or invent values.\n\n${text}`

  try {
    const result = await completeStructured(profileId, prompt, ExtractedJobLLMSchema, {
      maxOutputTokens: opts.maxOutputTokens ?? 400,
      temperature: 0,
      feature: opts.feature ?? 'job-extract',
      role: 'fast',
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.redactInvalidOutput ? { redactInvalidOutput: true } : {}),
      ...(opts.attribution ? { attribution: opts.attribution } : {}),
    })
    const raw = result.object
    const parsedDate = raw.datePublished ? new Date(raw.datePublished) : undefined
    const data: ExtractedJob = {
      title: raw.title,
      company: raw.company,
      location: raw.location,
      jobDescription: raw.jobDescription,
      jobNumber: raw.jobNumber,
      salaryBand: raw.salaryBand,
      datePublished: parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : undefined,
    }
    if (!data.title && !data.company && !data.jobDescription) {
      return { ok: false, error: 'Could not extract details — try pasting manually.' }
    }
    return { ok: true, data }
  } catch (err) {
    if (err instanceof LLMError && err.kind === 'not_configured') {
      return { ok: false, error: NO_KEY_ERROR }
    }
    if (err instanceof LLMError && err.kind === 'timeout') {
      return { ok: false, error: 'Reading the job page timed out — try pasting manually.', timedOut: true }
    }
    return { ok: false, error: 'Could not extract details — try pasting manually.' }
  }
}
