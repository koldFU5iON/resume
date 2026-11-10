/**
 * Facts step (spec §3): the cheap model turns the job description into the
 * structured JobFacts the judge questions and combine rules are built from.
 *
 * - Runs on the user's own key with FAST_MODELS (`resolveFastModel`),
 *   temperature 0, feature 'job-assessment-facts'.
 * - The job description is untrusted page text: it goes into the user
 *   message inside <job_description> tags, never into the system prompt.
 * - Cached by `factsHash`: a sha256 over everything that goes into the facts
 *   request — PIPELINE_VERSION, title, company, description, the normalised
 *   countries hint and the salary-band hint. When the newest run of this
 *   profile with the same hash has facts, they're reused with no LLM call, so
 *   re-assessing after a profile or eligibility change costs Jev calls only,
 *   while an edit to any input (or a prompt/version bump) re-extracts.
 */

import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { completeStructured, resolveFastModel } from '@/modules/llm/client'
import { cutAtSentence } from './candidate-state'
import { toCountryCode } from './countries'
import { DESCRIPTION_MAX_CHARS, JobFactsSchema, PIPELINE_VERSION, type JobFacts } from './schema'

/** Bound on the cheap-model call; it runs inside after(). */
export const FACTS_TIMEOUT_MS = 30_000

/** Headroom over the spec's 1,600 for 14 requirements with years and parts. */
export const FACTS_MAX_OUTPUT_TOKENS = 2_400

/** Spec §3 system prompt, verbatim. Edit only with a PIPELINE_VERSION bump. */
export const FACTS_SYSTEM_PROMPT = `You extract structured facts from a job description for an automated screening step. Output only what the
description states. Do not guess, estimate or add anything.

Requirements
- One requirement per distinct line item. Keep the description's own wording, trimmed to one sentence.
- importance = "must" for required / minimum / essential items. Use "nice" for preferred, ideally, a plus,
  bonus, nice to have, or "we also consider candidates with fewer…".
- Skip personality traits and generic attitudes that no CV can show (e.g. "positive energy",
  "can-do attitude", "attention to detail", "passion for our mission").
- kind:
  education      degree or diploma requirements
  certification  named certifications (PMP, CISSP, Six Sigma…)
  licence        legal licences (driving, medical, bar…)
  clearance      security clearance
  language       a spoken or written language level
  experience     years or type of past work, track records, domain background
  skill          tools, methods, abilities
  availability   travel, on-call, shifts, start date, hours: things a CV can't show
- years: when a requirement names a number of years, set min to the lowest number accepted and area to the
  kind of work, without the number. Example: "5 to 8 years in business operations or chief of staff roles"
  → { min: 5, area: "business operations or chief of staff roles" }. Otherwise null.
- If one line has two year clauses ("8+ years in X, including 3+ years leading Y"), write two requirements,
  one per clause. If a line gives a total plus a specific ("8+ years of relevant experience, including 6+ in
  strategy…"), keep only the specific clause.
- parts: when a requirement asks for several distinct things that must ALL be present ("hands-on across A,
  B, C and D", "strong in A, B and C"), list each thing as a short noun phrase. Do not split alternatives
  joined by "or" ("consulting, strategy or operations"): those are one requirement with parts = null.
- At most 8 must and 6 nice. If there are more, keep the ones most specific to this role.

Location
- countries: ISO 3166-1 alpha-2 codes for every country the role can be based in. Use the hints below if the
  description says nothing.
- basedInRequired: true when the description requires living or working in specific countries (onsite,
  "must be based in", "only open to candidates in…").

Salary: only a range or figure printed in the description. Otherwise null.`

export interface FactsJob {
  title: string
  company: string | null
  jobDescription: string | null
  /** Job row hint; may be empty or wrong. */
  countries: readonly string[]
  /** Job row hint; may be empty or wrong. */
  salaryBand: string | null
}

export interface FactsResult {
  facts: JobFacts
  factsHash: string
  /** True when facts came from an earlier run with the same hash (no LLM call). */
  cached: boolean
}

/** Country hints as a stable set: codes where recognised, else lowercased text; sorted, unique. */
export function normalizeCountryHints(countries: readonly string[]): string[] {
  const out = new Set<string>()
  for (const c of countries) {
    const v = c.trim()
    if (v) out.add(toCountryCode(v) ?? v.toLowerCase())
  }
  return [...out].sort()
}

export function computeFactsHash(job: FactsJob): string {
  return createHash('sha256')
    .update(JSON.stringify([
      PIPELINE_VERSION,
      job.title,
      job.company ?? '',
      job.jobDescription ?? '',
      normalizeCountryHints(job.countries),
      job.salaryBand?.trim() ?? '',
    ]))
    .digest('hex')
}

/** The user message: title, company, hints, and the description inside tags. */
export function buildFactsPrompt(job: FactsJob): string {
  const countries = job.countries.map((c) => c.trim()).filter(Boolean)
  return [
    `Job title: ${job.title}`,
    `Company: ${job.company ?? ''}`,
    '',
    'Hints from the job tracker (may be empty or wrong):',
    `- Countries: ${countries.length > 0 ? countries.join(', ') : '(empty)'}`,
    `- Salary band: ${job.salaryBand?.trim() || '(empty)'}`,
    '',
    '<job_description>',
    cutAtSentence(job.jobDescription ?? '', DESCRIPTION_MAX_CHARS),
    '</job_description>',
  ].join('\n')
}

/** Facts from the newest run of this profile with the same hash, or null. */
async function findCachedFacts(profileId: string, factsHash: string): Promise<JobFacts | null> {
  const row = await prisma.jobAssessment.findFirst({
    where: { profileId, factsHash, facts: { not: Prisma.DbNull } },
    orderBy: { createdAt: 'desc' },
    select: { facts: true },
  })
  const parsed = JobFactsSchema.safeParse(row?.facts)
  return parsed.success ? parsed.data : null
}

/**
 * Facts for `job`, from the cache or the cheap model. Throws LLMError (e.g.
 * kind 'not_configured' when the user has no key) on a model failure.
 */
export async function extractJobFacts(profileId: string, job: FactsJob): Promise<FactsResult> {
  const factsHash = computeFactsHash(job)
  const cached = await findCachedFacts(profileId, factsHash)
  if (cached) return { facts: cached, factsHash, cached: true }

  const result = await completeStructured(profileId, buildFactsPrompt(job), JobFactsSchema, {
    system: FACTS_SYSTEM_PROMPT,
    model: await resolveFastModel(profileId),
    feature: 'job-assessment-facts',
    temperature: 0,
    maxOutputTokens: FACTS_MAX_OUTPUT_TOKENS,
    timeoutMs: FACTS_TIMEOUT_MS,
    // The raw output can echo the job description; log only zod issue paths.
    redactInvalidOutput: true,
  })
  return { facts: result.object, factsHash, cached: false }
}
