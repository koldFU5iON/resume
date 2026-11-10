'use server'

import type { ExtractionResult, ExtractedJob } from './extract-utils'
import { decode, td, formatSalaryBand, scoreCompleteness, mergeExtractedJob, COMPLETE_THRESHOLD } from './extract-utils'
import {
  linkedInJobId, extractLinkedIn,
  greenhouseFromUrl, greenhouseFromHtml, extractGreenhouse,
  matchSiteOverride,
  leverFromUrl, extractLever,
  ashbyFromUrl, extractAshby,
  workdayFromUrl, extractWorkday,
} from './extract-ats'
import { isSafeUrl, fetchPageContent } from './extract-fetch'
import { extractWithLLM } from './extract-llm'
import { requireProfile } from '@/lib/session'

/** The signed-in profile, or null (e.g. a bearer-token route with no session). */
async function sessionProfileId(): Promise<string | null> {
  try {
    const { profile } = await requireProfile()
    return profile.id
  } catch {
    return null
  }
}

export async function extractJobFromUrl(url: string): Promise<ExtractionResult> {
  if (!(await isSafeUrl(url))) {
    return { ok: false, error: 'Invalid URL — only public HTTPS job pages are supported.' }
  }

  // ── Tier 1: ATS routing (no HTML fetch) ──────────────────────────────────
  let accumulated: ExtractedJob = {}

  const linkedInId = linkedInJobId(url)
  if (linkedInId) {
    const result = await extractLinkedIn(linkedInId)
    if (result.ok) {
      if (scoreCompleteness(result.data) >= COMPLETE_THRESHOLD) return result
      accumulated = mergeExtractedJob(accumulated, result.data)
    }
  }

  if (Object.keys(accumulated).every(k => !accumulated[k as keyof ExtractedJob])) {
    const siteOverride = matchSiteOverride(url)
    if (siteOverride) {
      const result = await extractGreenhouse(siteOverride.board, siteOverride.jobId)
      if (result.ok) {
        if (scoreCompleteness(result.data) >= COMPLETE_THRESHOLD) return result
        accumulated = mergeExtractedJob(accumulated, result.data)
      }
    }
  }

  if (Object.keys(accumulated).every(k => !accumulated[k as keyof ExtractedJob])) {
    const directGh = greenhouseFromUrl(url)
    if (directGh) {
      const result = await extractGreenhouse(directGh.board, directGh.jobId)
      if (result.ok) {
        if (scoreCompleteness(result.data) >= COMPLETE_THRESHOLD) return result
        accumulated = mergeExtractedJob(accumulated, result.data)
      }
    }
  }

  if (Object.keys(accumulated).every(k => !accumulated[k as keyof ExtractedJob])) {
    const lever = leverFromUrl(url)
    if (lever) {
      const result = await extractLever(lever.company, lever.jobId)
      if (result.ok) {
        if (scoreCompleteness(result.data) >= COMPLETE_THRESHOLD) return result
        accumulated = mergeExtractedJob(accumulated, result.data)
      }
    }
  }

  if (Object.keys(accumulated).every(k => !accumulated[k as keyof ExtractedJob])) {
    const ashby = ashbyFromUrl(url)
    if (ashby) {
      const result = await extractAshby(ashby.company, ashby.jobSlug)
      if (result.ok) {
        if (scoreCompleteness(result.data) >= COMPLETE_THRESHOLD) return result
        accumulated = mergeExtractedJob(accumulated, result.data)
      }
    }
  }

  if (Object.keys(accumulated).every(k => !accumulated[k as keyof ExtractedJob])) {
    const workday = workdayFromUrl(url)
    if (workday) {
      const result = await extractWorkday(workday.subdomain, workday.tenant, workday.group, workday.jobId)
      if (result?.ok) {
        if (scoreCompleteness(result.data) >= COMPLETE_THRESHOLD) return result
        accumulated = mergeExtractedJob(accumulated, result.data)
      }
      // null or ok:false = API unavailable, fall through to HTML fetch
    }
  }

  // ── Tier 2: HTML fetch + structural parse ─────────────────────────────────
  const fetchResult = await fetchPageContent(url)
  if (!fetchResult.ok) {
    // If ATS gave us something partial, return it; otherwise return the fetch error
    if (accumulated.title || accumulated.company || accumulated.jobDescription) {
      return { ok: true, data: accumulated }
    }
    return fetchResult
  }

  const { html } = fetchResult

  const embeddedGh = greenhouseFromHtml(url, html)
  if (embeddedGh) {
    const ghResult = await extractGreenhouse(embeddedGh.board, embeddedGh.jobId)
    if (ghResult.ok) {
      accumulated = mergeExtractedJob(accumulated, ghResult.data)
    }
  }

  const jsonLdData = fromJsonLd(html)
  if (jsonLdData) {
    accumulated = mergeExtractedJob(accumulated, jsonLdData)
  }

  const metaData = fromMetaTags(html)
  accumulated = mergeExtractedJob(accumulated, metaData)

  if (scoreCompleteness(accumulated) >= COMPLETE_THRESHOLD) {
    return { ok: true, data: accumulated }
  }

  // ── Tier 3: LLM extraction ────────────────────────────────────────────────
  const llmResult = await extractWithLLM(html, await sessionProfileId())
  if (llmResult.ok) {
    accumulated = mergeExtractedJob(accumulated, llmResult.data)
  }

  if (accumulated.title || accumulated.company || accumulated.jobDescription) {
    return { ok: true, data: accumulated }
  }

  // Return LLM error if we have one, otherwise a generic fallback
  if (!llmResult.ok) return llmResult
  return { ok: false, error: 'Could not extract job details — try pasting manually.' }
}

// ── JSON-LD JobPosting ────────────────────────────────────────────────────────

function fromJsonLd(html: string): ExtractedJob | null {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]

  for (const block of blocks) {
    try {
      const raw = JSON.parse(block[1])
      const candidates: unknown[] = Array.isArray(raw?.['@graph']) ? raw['@graph'] : [raw]
      const job = candidates.find(
        (c): c is Record<string, unknown> =>
          typeof c === 'object' && c !== null && (c as Record<string, unknown>)['@type'] === 'JobPosting',
      )
      if (!job) continue

      const addr = (job.jobLocation as Record<string, unknown> | undefined)?.address as Record<string, unknown> | undefined
      const city = addr?.addressLocality as string | undefined
      const country = addr?.addressCountry as string | undefined
      const isRemote = job.jobLocationType === 'TELECOMMUTE'
      const locationParts = isRemote
        ? ['Remote', city, country].filter(Boolean)
        : [city, country].filter(Boolean)

      const descHtml = (job.description as string | undefined) ?? ''
      const jobDescription = descHtml ? td.turndown(descHtml) : undefined

      const rawDate = job.datePosted as string | undefined
      const parsed = rawDate ? new Date(rawDate) : undefined
      const datePublished = parsed && !isNaN(parsed.getTime()) ? parsed : undefined

      const org = job.hiringOrganization as Record<string, unknown> | undefined
      const identifier = job.identifier as Record<string, unknown> | undefined

      return {
        title: decode((job.title as string | undefined)?.trim()),
        company: decode((org?.name as string | undefined)?.trim()),
        location: decode(locationParts.length > 0 ? (locationParts as string[]).join(', ') : undefined),
        jobDescription,
        jobNumber: identifier?.value != null ? String(identifier.value) : undefined,
        datePublished,
        salaryBand: formatSalaryBand(job.baseSalary),
      }
    } catch {
      // malformed block — try the next one
    }
  }
  return null
}

// ── OpenGraph / meta fallback ─────────────────────────────────────────────────

function fromMetaTags(html: string): ExtractedJob {
  const og = (prop: string) => {
    const a = html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
    const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'))
    return decode((a?.[1] ?? b?.[1])?.trim())
  }

  const title =
    og('og:title') ??
    decode(html.match(/<h1[^>]*>([^<]{3,120})<\/h1>/i)?.[1]?.trim()) ??
    decode(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.replace(/\s*[\|\-–]\s*.+$/, '').trim())

  return {
    title: title ?? undefined,
    jobDescription: og('og:description') ?? undefined,
  }
}
