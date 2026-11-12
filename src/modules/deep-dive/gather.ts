/**
 * Stage 1 of the deep dive (spec §3.1): everything the run needs, read from
 * the DB with no LLM call.
 *
 * The result is split in two on purpose:
 * - `brief` is public job information only (title, company, location, the
 *   ad). It is all the researchers ever see (spec §2: no profile data in
 *   research, so nothing personal reaches a search query).
 * - everything else (profile, search profile, notes, the early assessment)
 *   goes to the synthesis step alone.
 */

import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { getSponsorStatus, type SponsorStatus } from '@/modules/companies/queries'
import { coveredCountries } from '@/modules/job-assessment/eligibility'
import { countryFromLocation, toCountryCode } from '@/modules/job-assessment/countries'
import { DESCRIPTION_MAX_CHARS, type Blocker } from '@/modules/job-assessment/schema'
import { SalaryEstimateSchema, type SalaryEstimate } from '@/modules/jobs/schema'
import { loadWritingRules } from '@/modules/llm/prompt-context'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { emitSuggestion } from '@/modules/search-profile/actions'
import { normalizeSearchProfile, type Eligibility, type SearchProfile, type SearchSuggestion } from '@/modules/search-profile/schema'
import { FindingSchema, type Finding } from './schema'

/** Public facts about the job: the only input researchers get. */
export type ResearchBrief = {
  title: string
  company: string | null
  /** The ad's URL, so a researcher can read the original posting. */
  url: string | null
  /** As captured: codes, names or cities. */
  countries: string[]
  jobDescription: string
  /** The job's stated band, as captured. */
  salaryBand: string | null
  isRecruitmentAgency: boolean
  /** The job is in the UK (or its country is unknown), so UK visa thresholds may matter. */
  ukJob: boolean
}

export type EarlyAssessmentInput = {
  id: string
  score: number | null
  level: string | null
  blocked: boolean
  blockers: Blocker[]
  strengths: string[]
  gaps: string[]
  unsettled: string[]
  /** JobFacts (requirements, location, salary, seniority, employment type), as stored. */
  facts: unknown
  /** Years breakdown and informational notes from combine, as stored. */
  combine: unknown
}

/** Sponsorship facts worked out in code (spec §5), never by a model. */
export type SponsorshipFacts = {
  /** True/false when the user's work rights and the job's countries settle it; null when they don't. */
  needed: boolean | null
  /** Countries the job resolves to (ISO codes). */
  jobCountries: string[]
  /** UK register result; 'not_applicable' for a job outside the UK. */
  register: 'licensed' | 'licensed_other_route' | 'not_listed' | 'unknown' | 'not_applicable'
  /** Register details when the register applies. */
  sponsorStatus: SponsorStatus | null
}

export type CachedCompanyResearch = { id: string; findings: Finding[]; model: string; createdAt: Date }

export type GatherResult = {
  brief: ResearchBrief
  companyId: string | null
  /** Serialised profile (contact details scrubbed), as for job fit. */
  profileText: string
  searchProfile: SearchProfile
  writingRules: string
  writingBrief: string | null
  /** The user's job notes, only when they chose to include them in fit (notesIncludeInFit). */
  notes: string | null
  salaryEstimate: SalaryEstimate | null
  earlyAssessment: EarlyAssessmentInput | null
  sponsorship: SponsorshipFacts
  cachedCompanyResearch: CachedCompanyResearch | null
  inputsHash: string
}

export type GatherFailure = { ok: false; kind: 'not_found' | 'no_description'; message: string }

/** Job countries as ISO codes: the job row's, plus the early assessment's facts. Unreadable values are dropped. */
export function resolveJobCountries(rowCountries: readonly string[], facts: unknown): string[] {
  const factCountries = (facts as { location?: { countries?: unknown } } | null)?.location?.countries
  const all = [...rowCountries, ...(Array.isArray(factCountries) ? factCountries.filter((c): c is string => typeof c === 'string') : [])]
  const codes = all
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => toCountryCode(c) ?? countryFromLocation(c))
    .filter((c): c is string => c !== null)
  return [...new Set(codes)]
}

/**
 * Whether the user needs sponsorship for this job: false when they can work
 * in any of its countries, true when they can work in none, null when the job
 * has no known country or the user hasn't entered citizenships or visas.
 */
export function sponsorshipNeeded(eligibility: Eligibility, jobCountries: readonly string[], today: Date): boolean | null {
  if (jobCountries.length === 0) return null
  if (eligibility.citizenships.length === 0 && eligibility.visas.length === 0) return null
  const covered = coveredCountries(eligibility, today)
  return !jobCountries.some((c) => covered.has(c))
}

/** sha256 of the inputs that change the report (spec §4.1); drives the "out of date" banner. */
/** The job description as the deep dive reads it (and hashes it). */
function normaliseDescription(text: string | null | undefined): string {
  return text?.trim().slice(0, DESCRIPTION_MAX_CHARS) ?? ''
}

export function computeInputsHash(parts: {
  profileText: string
  searchProfile: SearchProfile
  jobDescription: string
  salaryBand: string | null
  sourceAssessmentId: string | null
}): string {
  return createHash('sha256')
    .update(JSON.stringify([parts.profileText, parts.searchProfile, parts.jobDescription, parts.salaryBand, parts.sourceAssessmentId]))
    .digest('hex')
}

function parseSalaryEstimate(value: unknown): SalaryEstimate | null {
  const parsed = SalaryEstimateSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function parseFindings(value: unknown): Finding[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((f) => {
    const parsed = FindingSchema.safeParse(f)
    return parsed.success ? [parsed.data] : []
  })
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** Newest fresh CompanyResearch for the company (topic 'company'), or null. */
export async function findFreshCompanyResearch(companyId: string, now: Date): Promise<CachedCompanyResearch | null> {
  const row = await prisma.companyResearch.findFirst({
    where: { companyId, topic: 'company', expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, findings: true, model: true, createdAt: true },
  })
  if (!row) return null
  const findings = parseFindings(row.findings)
  return findings.length > 0 ? { id: row.id, findings, model: row.model, createdAt: row.createdAt } : null
}

/** Inputs for a run of `jobId`, or why it can't run. */
export async function gatherDeepDiveInputs(
  profileId: string,
  jobId: string,
  now: Date = new Date(),
): Promise<({ ok: true } & GatherResult) | GatherFailure> {
  const job = await prisma.jobApplication.findFirst({
    where: { id: jobId, profileId },
    select: {
      title: true, company: true, companyId: true, url: true, countries: true,
      jobDescription: true, salaryBand: true, notes: true, notesIncludeInFit: true,
      salaryEstimate: true, isRecruitmentAgency: true,
    },
  })
  if (!job) return { ok: false, kind: 'not_found', message: 'Job not found' }
  const jobDescription = normaliseDescription(job.jobDescription)
  if (!jobDescription) {
    return { ok: false, kind: 'no_description', message: 'Add a job description first: the deep dive needs it.' }
  }

  const [snapshot, settings, writingRules, assessment, cachedCompanyResearch] = await Promise.all([
    buildProfileSnapshot(profileId),
    prisma.userSettings.findUnique({ where: { profileId }, select: { searchProfile: true, writingBrief: true } }),
    loadWritingRules(profileId).catch(() => ''),
    prisma.jobAssessment.findFirst({
      where: { jobApplicationId: jobId, profileId, status: 'complete' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, score: true, level: true, blocked: true, blockers: true,
        strengths: true, gaps: true, unsettled: true, facts: true, signals: true,
      },
    }),
    // An agency ad is researched with its own prompt (find the real employer), so it never reuses cached company research.
    job.companyId && !job.isRecruitmentAgency ? findFreshCompanyResearch(job.companyId, now) : Promise.resolve(null),
  ])

  const searchProfile = normalizeSearchProfile(settings?.searchProfile)
  const profileText = serializeProfileForLLM(snapshot)
  const salaryBand = job.salaryBand?.trim() || null

  const jobCountries = resolveJobCountries(job.countries, assessment?.facts ?? null)
  // No resolvable country: treat it as possibly UK, so the register is still checked.
  const ukJob = jobCountries.length === 0 || jobCountries.includes('GB')
  const sponsorStatus = ukJob ? await getSponsorStatus(job.companyId) : null

  const earlyAssessment: EarlyAssessmentInput | null = assessment
    ? {
        id: assessment.id,
        score: assessment.score,
        level: assessment.level,
        blocked: assessment.blocked,
        blockers: Array.isArray(assessment.blockers) ? (assessment.blockers as unknown as Blocker[]) : [],
        strengths: stringArray(assessment.strengths),
        gaps: stringArray(assessment.gaps),
        unsettled: stringArray(assessment.unsettled),
        facts: assessment.facts ?? null,
        combine: (assessment.signals as { combine?: unknown } | null)?.combine ?? null,
      }
    : null

  const notes = job.notesIncludeInFit && job.notes?.trim() ? job.notes.trim() : null

  return {
    ok: true,
    brief: {
      title: job.title,
      company: job.company?.trim() || null,
      url: job.url?.trim() || null,
      countries: job.countries,
      jobDescription,
      salaryBand,
      isRecruitmentAgency: job.isRecruitmentAgency,
      ukJob,
    },
    companyId: job.companyId,
    profileText,
    searchProfile,
    writingRules,
    writingBrief: settings?.writingBrief ?? null,
    notes,
    salaryEstimate: parseSalaryEstimate(job.salaryEstimate),
    earlyAssessment,
    sponsorship: {
      needed: sponsorshipNeeded(searchProfile.eligibility, jobCountries, now),
      jobCountries,
      register: sponsorStatus ? sponsorStatus.result : 'not_applicable',
      sponsorStatus,
    },
    cachedCompanyResearch,
    inputsHash: computeInputsHash({ profileText, searchProfile, jobDescription, salaryBand, sourceAssessmentId: assessment?.id ?? null }),
  }
}

/** The inputsHash a run started now would get, or null when the job can't be deep-dived. Reads only what the hash needs. */
export async function currentInputsHash(profileId: string, jobId: string): Promise<string | null> {
  const [job, snapshot, settings, assessment] = await Promise.all([
    prisma.jobApplication.findFirst({ where: { id: jobId, profileId }, select: { jobDescription: true, salaryBand: true } }),
    buildProfileSnapshot(profileId),
    prisma.userSettings.findUnique({ where: { profileId }, select: { searchProfile: true } }),
    prisma.jobAssessment.findFirst({
      where: { jobApplicationId: jobId, profileId, status: 'complete' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }),
  ])
  const jobDescription = normaliseDescription(job?.jobDescription)
  if (!job || !jobDescription) return null
  return computeInputsHash({
    profileText: serializeProfileForLLM(snapshot),
    searchProfile: normalizeSearchProfile(settings?.searchProfile),
    jobDescription,
    salaryBand: job.salaryBand?.trim() || null,
    sourceAssessmentId: assessment?.id ?? null,
  })
}

// ── Search-profile suggestions (moved from the retired assessJobFit, spec §10) ──

export type SuggestionDraft = Omit<SearchSuggestion, 'id' | 'createdAt'>

/** Smallest figure read as an annual salary: keeps "less than 30 minutes" or "minimum 10 years" out. */
const MIN_SALARY_FLOOR = 10_000

const CURRENCY_SIGNS: Record<string, string> = { '£': 'GBP', '$': 'USD', '€': 'EUR' }

/**
 * A salary floor written in the notes ("not worth it below £85k", "minimum
 * salary 90,000", "Minimum expected: $150k"), or null. The figure must come
 * within a few words of the phrase, on the same line, and read as an annual
 * salary. The currency comes from its sign; GBP without one.
 */
export function salaryFloorFromNotes(notes: string): { amount: number; currency: string } | null {
  const re = /(?:not worth|minimum|at least|below|less than|under)[^\d£$€\n]{0,25}?([£$€])?\s*(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/gi
  for (const m of notes.matchAll(re)) {
    const amount = Number(m[2].replace(/,/g, '')) * (m[3] ? 1000 : 1)
    if (Number.isFinite(amount) && amount >= MIN_SALARY_FLOOR) {
      return { amount: Math.round(amount), currency: m[1] ? CURRENCY_SIGNS[m[1]] : 'GBP' }
    }
  }
  return null
}

/**
 * Suggestions for the user's search profile from a run's inputs, the same two
 * rules assessJobFit had: a salary floor written in the job notes (only notes
 * the user lets fit read) when the profile has no salary band, and a job
 * title that isn't one of the target roles. Pure.
 */
export function searchProfileSuggestions(g: Pick<GatherResult, 'brief' | 'searchProfile' | 'notes'>): SuggestionDraft[] {
  const out: SuggestionDraft[] = []
  const { searchProfile, notes, brief } = g

  if (notes && !searchProfile.salaryBand) {
    const floor = salaryFloorFromNotes(notes)
    if (floor !== null) {
      out.push({
        field: 'salaryBand',
        suggestedValue: { min: floor.amount, max: null, currency: floor.currency },
        reason: `You noted a salary floor around ${floor.amount.toLocaleString('en-GB')} ${floor.currency} while reviewing ${brief.company ?? 'this role'}.`,
        source: 'deep-dive',
      })
    }
  }

  const title = brief.title.trim()
  if (title && searchProfile.roles.length > 0) {
    const t = title.toLowerCase()
    const tracked = searchProfile.roles.some((r) => t.includes(r.toLowerCase()) || r.toLowerCase().includes(t))
    if (!tracked) {
      out.push({
        field: 'roles',
        suggestedValue: [...searchProfile.roles, title],
        reason: `You ran a deep dive on "${title}", which isn't in your target roles.`,
        source: 'deep-dive',
      })
    }
  }
  return out
}

/** Queues the run's suggestions. Best effort: a failure never affects the run. */
export async function emitSearchProfileSuggestions(profileId: string, g: Pick<GatherResult, 'brief' | 'searchProfile' | 'notes'>): Promise<void> {
  for (const s of searchProfileSuggestions(g)) {
    await emitSuggestion(profileId, s).catch((err) => console.error('[deep-dive] could not queue suggestion', { field: s.field, err }))
  }
}
