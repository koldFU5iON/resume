/**
 * Enrich step (plan §2): when verification fails and the job has a URL, fetch
 * the page once and let the cheap model fill the fields that are still empty
 * or placeholders. Never overwrites a value the user entered.
 *
 * Fillable fields and what counts as "missing":
 *   title           empty or "(untitled)"
 *   company         empty or "(unknown)"
 *   jobDescription  empty
 *   countries       empty list
 *   salaryBand      empty
 *
 * One exception: when verification failed because the description is
 * incomplete (a teaser, a truncated preview, too short), the caller passes
 * `replaceDescription` and a non-empty description may be replaced by the
 * fetched one, but only when the fetched one is clearly better: it passes the
 * length check and is at least 1.5× longer. That's recorded as
 * REPLACED_DESCRIPTION in `filled`, so the UI can say it came from the page.
 *
 * The write is conditional on those fields still holding the values read at
 * the start, so an edit made while the fetch ran wins.
 */

import { prisma } from '@/lib/db'
import { linkJobCompany } from '@/modules/companies/match'
import { assertLLMConfigured } from '@/modules/llm/client'
import { fetchPageContent } from '@/modules/jobs/extract-fetch'
import { extractWithLLM } from '@/modules/jobs/extract-llm'
import { ASSESSMENT_CONFIG } from './schema'
import { PLACEHOLDER_COMPANY, PLACEHOLDER_TITLE } from './verify'

/** Enough output for a full job description (the capture flow's 400 is not). */
const ENRICH_MAX_OUTPUT_TOKENS = 4000

/** Bound on the cheap-model call; it runs inside after(). */
export const ENRICH_TIMEOUT_MS = 30_000

export interface EnrichJob {
  id: string
  url: string | null
  title: string
  company: string | null
  jobDescription: string | null
  countries: string[]
  salaryBand: string | null
}

export type EnrichField = 'title' | 'company' | 'jobDescription' | 'countries' | 'salaryBand'

/** Recorded in `filled` / enrichedFields when a truncated description was replaced from the job page. */
export const REPLACED_DESCRIPTION = 'jobDescription (replaced truncated)'

export type EnrichedField = EnrichField | typeof REPLACED_DESCRIPTION

/** A fetched description must be at least this many times longer to replace an existing one. */
export const REPLACE_DESCRIPTION_MIN_RATIO = 1.5

export interface EnrichOptions {
  /** Verification found the description incomplete: a non-empty one may be replaced (see file header). */
  replaceDescription?: boolean
  /** Groups the call with the rest of the assessment run in usage logs. */
  runId?: string
}

export interface EnrichResult {
  /** Fields written back to the JobApplication (empty when nothing changed). */
  filled: EnrichedField[]
  /** The job with the filled values applied. */
  job: EnrichJob
  /** Plain-words reason when nothing could be fetched or extracted. */
  error?: string
}

function isMissing(value: string | null | undefined, placeholder?: string): boolean {
  const v = value?.trim() ?? ''
  return v === '' || (placeholder !== undefined && v.toLowerCase() === placeholder)
}

/** Fields of `job` that enrichment may fill. */
export function missingFields(job: EnrichJob): EnrichField[] {
  const out: EnrichField[] = []
  if (isMissing(job.title, PLACEHOLDER_TITLE)) out.push('title')
  if (isMissing(job.company, PLACEHOLDER_COMPANY)) out.push('company')
  if (isMissing(job.jobDescription)) out.push('jobDescription')
  if (job.countries.every((c) => !c.trim())) out.push('countries')
  if (isMissing(job.salaryBand)) out.push('salaryBand')
  return out
}

/** Whether `fetched` is clearly better than a non-empty `current` description. */
export function isClearlyBetterDescription(current: string, fetched: string): boolean {
  const cur = current.trim().length
  const next = fetched.trim().length
  return next >= ASSESSMENT_CONFIG.verify.minDescriptionChars && next >= REPLACE_DESCRIPTION_MIN_RATIO * cur
}

/** Fields whose change can change the verify result; only these trigger a fetch or a re-verify. */
export const VERIFY_FIELDS: ReadonlySet<EnrichedField> = new Set(['title', 'company', 'jobDescription', REPLACED_DESCRIPTION])

/** Whether enrichment would fetch: a verify field is missing, or the description may be replaced. */
export function needsEnrichment(job: EnrichJob, opts: EnrichOptions = {}): boolean {
  return Boolean(opts.replaceDescription) || missingFields(job).some((f) => VERIFY_FIELDS.has(f))
}

/**
 * Fetches `job.url` once and fills missing fields. Fetches only when the
 * title, company or description is missing or a placeholder, or the
 * description may be replaced; empty countries and salary band are then
 * filled too, but never trigger a fetch on their own. Throws LLMError
 * (kind 'not_configured') when the user has no LLM key, before any fetch.
 */
export async function enrichJob(profileId: string, job: EnrichJob, opts: EnrichOptions = {}): Promise<EnrichResult> {
  if (!job.url) return { filled: [], job, error: 'The job has no URL to fetch details from' }
  if (!needsEnrichment(job, opts)) return { filled: [], job, error: 'Nothing the job page could fix' }

  const missing = missingFields(job)
  const mayReplaceDescription = Boolean(opts.replaceDescription) && !missing.includes('jobDescription')

  await assertLLMConfigured(profileId)

  const page = await fetchPageContent(job.url)
  if (!page.ok) return { filled: [], job, error: 'Could not fetch the job page' }

  const extracted = await extractWithLLM(page.html, profileId, {
    feature: 'job-assessment-enrich',
    maxOutputTokens: ENRICH_MAX_OUTPUT_TOKENS,
    timeoutMs: ENRICH_TIMEOUT_MS,
    redactInvalidOutput: true,
    attribution: { jobApplicationId: job.id, runId: opts.runId },
  })
  if (!extracted.ok) {
    return {
      filled: [],
      job,
      error: extracted.timedOut ? 'Reading the job page timed out' : 'Could not read job details from the page',
    }
  }
  const data = extracted.data

  const updates: Partial<Pick<EnrichJob, EnrichField>> = {}
  const filled: EnrichedField[] = []
  const title = data.title?.trim()
  if (missing.includes('title') && title) updates.title = title
  const company = data.company?.trim()
  if (missing.includes('company') && company) updates.company = company
  const description = data.jobDescription?.trim()
  let replaced = false
  if (missing.includes('jobDescription') && description) {
    updates.jobDescription = description
  } else if (mayReplaceDescription && description && isClearlyBetterDescription(job.jobDescription ?? '', description)) {
    updates.jobDescription = description
    replaced = true
  }
  const countries = data.location ? data.location.split(',').map((s) => s.trim()).filter(Boolean) : []
  if (missing.includes('countries') && countries.length > 0) updates.countries = countries
  const salaryBand = data.salaryBand?.trim()
  if (missing.includes('salaryBand') && salaryBand) updates.salaryBand = salaryBand

  for (const k of Object.keys(updates) as EnrichField[]) {
    filled.push(k === 'jobDescription' && replaced ? REPLACED_DESCRIPTION : k)
  }
  if (filled.length === 0) return { filled: [], job, error: 'The job page had no missing details' }

  // Only write while every filled field still holds what we read.
  const unchanged = {
    ...(updates.title !== undefined ? { title: job.title } : {}),
    ...(updates.company !== undefined ? { company: job.company } : {}),
    ...(updates.jobDescription !== undefined ? { jobDescription: job.jobDescription } : {}),
    ...(updates.countries !== undefined ? { countries: { equals: job.countries } } : {}),
    ...(updates.salaryBand !== undefined ? { salaryBand: job.salaryBand } : {}),
  }
  const res = await prisma.jobApplication.updateMany({
    where: { id: job.id, profileId, ...unchanged },
    data: updates,
  })
  if (res.count === 0) return { filled: [], job, error: 'The job was edited while details were fetched' }
  if (updates.company !== undefined) await linkJobCompany(profileId, job.id)

  return { filled, job: { ...job, ...updates } }
}
