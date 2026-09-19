// Job-capture orchestrator — wraps URL extraction + dedup + create into a
// single server-side function. Used by:
//   - the public POST /api/jobs/capture endpoint (bearer-token auth)
//   - any future browser-extension / agent / bookmarklet path that lands
//     on a stable internal API
//
// Takes profileId explicitly (no session lookup) so it can be called from
// API routes that authenticate via something other than the session cookie.

import { prisma } from '@/lib/db'
import { extractJobFromUrl } from './extract'
import {
  findPotentialDuplicatesForProfile,
  type DuplicateMatch,
} from './dedup-internal'

export type CaptureInput = {
  url: string
  notes?: string
  applicationSource?: 'cold' | 'referral' | 'recruiter_outreach'
  // What to do when an existing job matches:
  //   return_existing — return the matched job, don't create a new one (default)
  //   create_anyway   — proceed with creation even if a match is found
  dedupeStrategy?: 'return_existing' | 'create_anyway'
}

export type CaptureSuccess = {
  ok: true
  created: boolean  // true = new row written, false = returned existing match
  job: {
    id: string
    title: string
    company: string | null
  }
  duplicate: DuplicateMatch | null  // populated whenever a match was found, regardless of strategy
  extraction: {
    fieldsExtracted: string[]
  }
}

export type CaptureFailure = {
  ok: false
  status: number
  error: string
}

export type CaptureResult = CaptureSuccess | CaptureFailure

export type PreparedJobCapture = {
  url: string
  title: string
  company: string
  jobNumber: string | null
  jobDescription: string | null
  countries: string[]
  datePublished: Date | null
  salaryBand: string | null
  duplicate: DuplicateMatch | null
  fieldsExtracted: string[]
}

// Required fields for a "real enough" record. If extraction can't satisfy
// these and the caller didn't supply overrides, we reject — better than
// quietly creating a placeholder no agent will know to fix later.
const PLACEHOLDER_TITLE = '(untitled)'
const PLACEHOLDER_COMPANY = '(unknown)'

export async function captureJobFromUrl(
  profileId: string,
  input: CaptureInput,
): Promise<CaptureResult> {
  const prepared = await prepareJobCapture(profileId, input.url)
  if (!prepared.ok) return prepared
  const strategy = input.dedupeStrategy ?? 'return_existing'

  if (prepared.data.duplicate && strategy === 'return_existing') {
    return {
      ok: true,
      created: false,
      job: { id: prepared.data.duplicate.id, title: prepared.data.duplicate.title, company: prepared.data.duplicate.company ?? '' },
      duplicate: prepared.data.duplicate,
      extraction: { fieldsExtracted: prepared.data.fieldsExtracted },
    }
  }

  const created = await prisma.jobApplication.create({
    data: {
      profileId,
      url: prepared.data.url,
      title: prepared.data.title,
      company: prepared.data.company,
      jobNumber: prepared.data.jobNumber,
      jobDescription: prepared.data.jobDescription,
      countries: prepared.data.countries,
      datePublished: prepared.data.datePublished,
      notes: input.notes?.trim() || null,
      applicationSource: input.applicationSource ?? 'cold',
      salaryBand: prepared.data.salaryBand,
      // status + progress default to "not started"; intake doesn't auto-apply.
    },
    select: { id: true, title: true, company: true },
  })

  return {
    ok: true,
    created: true,
    job: created,
    duplicate: prepared.data.duplicate, // null when no match; non-null when match existed but strategy was create_anyway
    extraction: { fieldsExtracted: prepared.data.fieldsExtracted },
  }
}

export async function prepareJobCapture(
  profileId: string,
  rawUrl: string,
): Promise<{ ok: true; data: PreparedJobCapture } | CaptureFailure> {
  const url = rawUrl.trim()
  if (!url) return { ok: false, status: 400, error: 'url is required' }

  try { new URL(url) } catch {
    return { ok: false, status: 400, error: 'url is not a valid URL' }
  }

  const extraction = await extractJobFromUrl(url)
  if (!extraction.ok) {
    return { ok: false, status: 422, error: `Could not extract job details: ${extraction.error}` }
  }
  const data = extraction.data
  const title = data.title?.trim() || PLACEHOLDER_TITLE
  const company = data.company?.trim() || PLACEHOLDER_COMPANY
  const matches = await findPotentialDuplicatesForProfile(profileId, {
    jobNumber: data.jobNumber,
    title,
    company,
  })

  return {
    ok: true,
    data: {
      url,
      title,
      company,
      jobNumber: data.jobNumber ?? null,
      jobDescription: data.jobDescription ?? null,
      countries: data.location ? data.location.split(',').map(s => s.trim()).filter(Boolean) : [],
      datePublished: data.datePublished ?? null,
      salaryBand: data.salaryBand ?? null,
      duplicate: matches[0] ?? null,
      fieldsExtracted: extractedFieldList(data),
    },
  }
}

function extractedFieldList(data: {
  title?: string
  company?: string
  location?: string
  jobNumber?: string
  jobDescription?: string
  datePublished?: Date
  salaryBand?: string
}): string[] {
  return (
    [
      ['title', data.title],
      ['company', data.company],
      ['location', data.location],
      ['jobNumber', data.jobNumber],
      ['jobDescription', data.jobDescription],
      ['datePublished', data.datePublished],
      ['salaryBand', data.salaryBand],
    ] as const
  )
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k]) => k)
}
