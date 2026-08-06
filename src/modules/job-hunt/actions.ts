'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'
import { completeStructured } from '@/modules/llm/client'
import { LLMError } from '@/modules/llm/errors'
import { buildProfileSnapshot, serializeProfileForLLM } from '@/modules/profile/snapshot'
import { normalizeOnboardingContext } from '@/modules/onboarding/schema'
import { loadWritingRules, composeSystem } from '@/modules/llm/prompt-context'
import { JobFitSchema } from '@/modules/jobs/schema'
import { discoverAts } from './ats-discovery'
import { scanBoardSource } from './board-sources/actions'
import { getAdapter } from './adapters/index'
import { buildKeywords, matchesProfile, matchesLocation, type ProfileFilterData } from './profile-filter'
import {
  AddCompanyInputSchema,
  AtsHintSchema,
  UpdateWatchInputSchema,
  RetryAtsInputSchema,
  type AddCompanyInput,
  type AtsHint,
  type ScanResult,
  type UpdateWatchInput,
  type RetryAtsInput,
} from './schema'
import {
  greenhouseFromUrl,
  leverFromUrl,
  ashbyFromUrl,
} from '@/modules/jobs/extract-ats'

// ── addCompany ────────────────────────────────────────────────────────────────

type AddCompanyResult = { ok: true; watchId: string } | { ok: false; error: string }

// Extracts ATS provider + board slug directly from a known ATS URL without
// any scraping — covers board URLs, careers pages, and specific job links.
function detectAtsBoardFromUrl(url: string): { provider: 'greenhouse' | 'lever' | 'ashby' | 'successfactors' | 'workday' | 'smartrecruiters' | 'bamboohr'; boardSlug: string } | null {
  const gh = url.match(/(?:boards|job-boards)\.greenhouse\.io\/([^/?#]+)/i)
  if (gh) return { provider: 'greenhouse', boardSlug: gh[1] }
  const lv = url.match(/jobs\.lever\.co\/([^/?#]+)/i)
  if (lv) return { provider: 'lever', boardSlug: lv[1] }
  const ash = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/i)
  if (ash) return { provider: 'ashby', boardSlug: ash[1] }
  // SuccessFactors: subdomain varies (career1–4, performancemanager, etc.)
  // Board identity lives in the company= query param, not the URL path.
  // Covers .com, .eu, .cn and other regional TLDs.
  const sf = url.match(/(?:successfactors|sapsf)\.[a-z]+.*[?&]company=([^&\s#]+)/i)
  if (sf) return { provider: 'successfactors', boardSlug: sf[1] }
  // Workday: {company}.{datacenter}.myworkdayjobs.com/{BoardName}
  // boardSlug encodes both subdomain and board: "logitech.wd5/Logitech"
  const wd = url.match(/([a-zA-Z0-9-]+\.[a-zA-Z0-9]+)\.myworkdayjobs\.com\/([^/?#\s]+)/i)
  if (wd) return { provider: 'workday', boardSlug: `${wd[1].toLowerCase()}/${wd[2]}` }
  // SmartRecruiters: jobs.smartrecruiters.com/company/{Slug} (oneclick-ui path)
  // or jobs.smartrecruiters.com/{Slug}/... (direct job board path)
  const srCompany = url.match(/jobs\.smartrecruiters\.com\/(?:[\w-]+\/)?company\/([a-zA-Z0-9][a-zA-Z0-9_-]+)/i)
  if (srCompany) return { provider: 'smartrecruiters', boardSlug: srCompany[1] }
  const srDirect = url.match(/jobs\.smartrecruiters\.com\/([a-zA-Z][a-zA-Z0-9_-]+)(?:\/|[?#]|$)/i)
  if (srDirect && !['oneclick-ui', 'api', 'widget', 'static'].includes(srDirect[1].toLowerCase())) {
    return { provider: 'smartrecruiters', boardSlug: srDirect[1] }
  }
  // BambooHR: {company}.bamboohr.com/careers/...
  // boardSlug is the company subdomain.
  const bhr = url.match(/([a-zA-Z0-9-]+)\.bamboohr\.com/i)
  if (bhr) return { provider: 'bamboohr', boardSlug: bhr[1].toLowerCase() }
  return null
}

export async function addCompany(input: AddCompanyInput): Promise<AddCompanyResult> {
  const parsed = AddCompanyInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }

  const { profile } = await requireProfile()
  const { name, website } = parsed.data

  // Fast path: if the URL is directly recognisable as an ATS board/job URL,
  // extract the board slug without scraping. Handles cases where the company
  // site is hard to crawl (SPAs, JS-heavy, etc.) but their job board URL is known.
  const urlAts = detectAtsBoardFromUrl(website)

  let atsProvider: string
  let boardSlug: string | null
  let careersUrl: string | null = null
  let confidence: number
  let status: string

  if (urlAts) {
    atsProvider = urlAts.provider
    boardSlug = urlAts.boardSlug
    confidence = 1
    status = 'active'
  } else {
    const discovery = await discoverAts(profile.id, website)
    atsProvider = discovery.provider
    boardSlug = discovery.boardSlug ?? null
    careersUrl = discovery.careersUrl ?? null
    confidence = discovery.confidence
    status = discovery.provider === 'unknown' ? 'discovery_failed' : 'active'
  }

  const watch = await prisma.companyWatch.create({
    data: {
      profileId: profile.id,
      name,
      website,
      careersUrl,
      atsProvider,
      boardSlug,
      confidence,
      status,
      searchLocations: parsed.data.searchLocations,
      includeRemote: parsed.data.includeRemote,
    },
    select: { id: true },
  })

  revalidatePath('/dashboard/job-hunt')
  return { ok: true, watchId: watch.id }
}

// ── addCompanyFromHint ────────────────────────────────────────────────────────

export async function addCompanyFromHint(hint: AtsHint): Promise<AddCompanyResult> {
  const parsed = AtsHintSchema.safeParse(hint)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }

  const { profile } = await requireProfile()

  const watch = await prisma.companyWatch.create({
    data: {
      profileId: profile.id,
      name: parsed.data.name,
      website: '',
      atsProvider: parsed.data.provider,
      boardSlug: parsed.data.boardSlug,
      confidence: 1,
      status: 'active',
      searchLocations: [],
      includeRemote: true,
    },
    select: { id: true },
  })

  revalidatePath('/dashboard/job-hunt')
  return { ok: true, watchId: watch.id }
}

// ── getAtsHintFromUrl ─────────────────────────────────────────────────────────

export async function getAtsHintFromUrl(
  url: string,
  company: string,
): Promise<AtsHint | null> {
  const gh = greenhouseFromUrl(url)
  if (gh) return { provider: 'greenhouse', boardSlug: gh.board, name: company }

  const lv = leverFromUrl(url)
  if (lv) return { provider: 'lever', boardSlug: lv.company, name: company }

  const ash = ashbyFromUrl(url)
  if (ash) return { provider: 'ashby', boardSlug: ash.company, name: company }

  return null
}

// ── removeWatch ───────────────────────────────────────────────────────────────

export async function removeWatch(watchId: string): Promise<void> {
  const { profile } = await requireProfile()
  await prisma.companyWatch.deleteMany({
    where: { id: watchId, profileId: profile.id },
  })
  revalidatePath('/dashboard/job-hunt')
}

// ── updateWatch ───────────────────────────────────────────────────────────────

export async function updateWatch(
  input: UpdateWatchInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = UpdateWatchInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }

  const { profile } = await requireProfile()

  const { count } = await prisma.companyWatch.updateMany({
    where: { id: parsed.data.watchId, profileId: profile.id },
    data: {
      searchLocations: parsed.data.searchLocations,
      includeRemote: parsed.data.includeRemote,
    },
  })

  if (count === 0) return { ok: false, error: 'Watch not found' }

  revalidatePath('/dashboard/job-hunt')
  return { ok: true }
}

// ── scanCompany ───────────────────────────────────────────────────────────────

export async function scanCompany(watchId: string): Promise<ScanResult> {
  const { profile } = await requireProfile()

  const watch = await prisma.companyWatch.findFirst({
    where: { id: watchId, profileId: profile.id, status: 'active' },
  })
  if (!watch) return { ok: false, error: 'not_found' }
  if (!watch.boardSlug || watch.atsProvider === 'unknown') {
    return { ok: false, error: 'no_ats_detected' }
  }

  const adapter = getAdapter(watch.atsProvider)
  if (!adapter) return { ok: false, error: 'no_ats_detected' }

  const [settings, experiences, skills, profileRow] = await Promise.all([
    prisma.userSettings.findUnique({
      where: { profileId: profile.id },
      select: { onboardingContext: true },
    }),
    prisma.experience.findMany({
      where: { profileId: profile.id },
      select: { role: true },
    }),
    prisma.skill.findMany({
      where: { profileId: profile.id },
      select: { name: true },
    }),
    prisma.profile.findUnique({
      where: { id: profile.id },
      select: { headline: true },
    }),
  ])

  const context = normalizeOnboardingContext(settings?.onboardingContext)
  const filterData: ProfileFilterData = {
    targetRole: context.targetRole,
    currentRole: context.currentRole,
    headline: profileRow?.headline ?? '',
    experienceRoles: experiences.map((e) => e.role),
    skillNames: skills.map((s) => s.name),
    additionalRoles: context.additionalRoles,
  }
  const keywords = buildKeywords(filterData)

  let listings
  try {
    listings = await adapter.fetchJobList(watch.boardSlug)
  } catch {
    await prisma.companyWatch.updateMany({
      where: { id: watchId, profileId: profile.id },
      data: { lastScanError: 'Could not reach job board', lastScannedAt: new Date() },
    })
    revalidatePath('/dashboard/job-hunt')
    return { ok: false, error: 'fetch_failed' }
  }

  const matched = listings.filter((j) =>
    matchesProfile(j.title, keywords) &&
    matchesLocation(j.location, watch.searchLocations, watch.includeRemote)
  )

  const withDescriptions = await Promise.all(
    matched.map(async (listing) => {
      try {
        const description = await adapter.fetchDescription(watch.boardSlug!, listing.externalId)
        return { ...listing, description }
      } catch {
        return { ...listing, description: null }
      }
    }),
  )

  const existing = await prisma.discoveredJob.findMany({
    where: { watchId, profileId: profile.id },
    select: { externalId: true },
  })
  const existingIds = new Set(existing.map((e) => e.externalId))
  const newJobs = withDescriptions.filter((j) => !existingIds.has(j.externalId))

  if (newJobs.length > 0) {
    await prisma.discoveredJob.createMany({
      data: newJobs.map((j) => ({
        watchId,
        profileId: profile.id,
        externalId: j.externalId,
        title: j.title,
        company: watch.name,
        location: j.location,
        url: j.url,
        postedAt: j.postedAt,
        description: j.description,
        status: 'new',
      })),
    })
  }

  await prisma.companyWatch.updateMany({
    where: { id: watchId, profileId: profile.id },
    data: { lastScannedAt: new Date(), lastScanError: null },
  })

  revalidatePath('/dashboard/job-hunt')
  return { ok: true, found: listings.length, matched: matched.length, newJobs: newJobs.length }
}

// ── scanAll ───────────────────────────────────────────────────────────────────

export async function scanAll(): Promise<
  { ok: true; scanned: number; newJobs: number; failed: number } | { ok: false; error: string }
> {
  const { profile } = await requireProfile()

  const [watches, boardSources] = await Promise.all([
    prisma.companyWatch.findMany({
      where: { profileId: profile.id, status: 'active', boardSlug: { not: null } },
      select: { id: true },
    }),
    prisma.jobBoardSource.findMany({
      where: { profileId: profile.id, enabled: true },
      select: { id: true },
    }),
  ])

  let scanned = 0
  let newJobs = 0
  let failed = 0

  const companyResults = await Promise.allSettled(
    watches.map((w) => scanCompany(w.id)),
  )
  for (const r of companyResults) {
    if (r.status === 'rejected' || !r.value.ok) { failed++; continue }
    scanned++
    newJobs += r.value.newJobs
  }

  const boardResults = await Promise.allSettled(
    boardSources.map((s) => scanBoardSource(s.id)),
  )
  for (const r of boardResults) {
    if (r.status === 'rejected' || !r.value.ok) { failed++; continue }
    scanned++
    newJobs += r.value.newJobs
  }

  revalidatePath('/dashboard/job-hunt')
  return { ok: true, scanned, newJobs, failed }
}

// ── scoreDiscoveredJob ────────────────────────────────────────────────────────

type ScoreResult =
  | { ok: true; fitLabel: string; fitScore: number }
  | { ok: false; error: string }

export async function scoreDiscoveredJob(jobId: string): Promise<ScoreResult> {
  const { profile } = await requireProfile()

  const job = await prisma.discoveredJob.findFirst({
    where: { id: jobId, profileId: profile.id },
  })
  if (!job) return { ok: false, error: 'Job not found' }
  if (!job.description?.trim()) return { ok: false, error: 'No description available to score against' }

  const [snapshot, settings, rules] = await Promise.all([
    buildProfileSnapshot(profile.id),
    prisma.userSettings.findUnique({
      where: { profileId: profile.id },
      select: { onboardingContext: true, writingBrief: true },
    }),
    loadWritingRules(profile.id),
  ])

  const context = normalizeOnboardingContext(settings?.onboardingContext)
  const hasGoals = !!(context.targetRole || context.industries)

  const featureInstructions = `You are an experienced career coach assessing whether a candidate is a strong fit for a role.

Be honest and concrete. Calibrate the rating against real-world hiring bars:
- 0–2 (reach): missing core requirements.
- 3–4 (possible): partial overlap.
- 5–6 (stretch): meets most requirements but has a meaningful gap.
- 7–8 (solid): strong baseline match.
- 9–10 (standout): unusually well-aligned.`

  const system = composeSystem(rules, settings?.writingBrief ?? null, featureInstructions)

  let userPrompt = `# Candidate\n\n${serializeProfileForLLM(snapshot)}\n\n# Role\n\n**${job.title}** at ${job.company}\n\n${job.description}`

  if (hasGoals) {
    userPrompt += '\n\n# Career Goals'
    if (context.targetRole) userPrompt += `\n**Target role:** ${context.targetRole}`
    if (context.industries) userPrompt += `\n**Industries:** ${context.industries}`
  }

  userPrompt += '\n\nReturn a single JSON object matching the schema.'

  let fit
  try {
    const result = await completeStructured(profile.id, userPrompt, JobFitSchema, {
      system,
      maxOutputTokens: 700,
      temperature: 0.2,
      feature: 'job-hunt-fit',
    })
    fit = result.object
  } catch (err) {
    if (err instanceof LLMError) return { ok: false, error: err.message }
    throw err
  }

  await prisma.discoveredJob.updateMany({
    where: { id: jobId, profileId: profile.id },
    data: {
      fitScore: fit.rating,
      fitLabel: fit.label,
      fitJustification: fit.justification,
      status: 'scored',
    },
  })

  revalidatePath('/dashboard/job-hunt')
  return { ok: true, fitLabel: fit.label, fitScore: fit.rating }
}

// ── importJob ─────────────────────────────────────────────────────────────────

type ImportResult = { ok: true; jobId: string } | { ok: false; error: string }

export async function importJob(jobId: string): Promise<ImportResult> {
  const { profile } = await requireProfile()

  const job = await prisma.discoveredJob.findFirst({
    where: { id: jobId, profileId: profile.id, status: { not: 'imported' } },
  })
  if (!job) return { ok: false, error: 'Job not found' }

  const countries = job.location
    ? job.location.split(',').map((s) => s.trim()).filter(Boolean)
    : []

  const newJob = await prisma.jobApplication.create({
    data: {
      profileId: profile.id,
      title: job.title,
      company: job.company,
      url: job.url ?? null,
      countries,
      jobDescription: job.description ?? null,
      datePublished: job.postedAt ?? null,
      applicationSource: 'cold',
      ...(job.fitLabel
        ? {
            jobFit: {
              rating: job.fitScore,
              label: job.fitLabel,
              justification: job.fitJustification,
            },
            jobFitAssessedAt: new Date(),
          }
        : {}),
    },
    select: { id: true },
  })

  await prisma.discoveredJob.updateMany({
    where: { id: jobId, profileId: profile.id },
    data: { status: 'imported', importedJobId: newJob.id },
  })

  revalidatePath('/dashboard/job-applications')
  revalidatePath('/dashboard/job-hunt')
  return { ok: true, jobId: newJob.id }
}

// ── ignoreJob ─────────────────────────────────────────────────────────────────

export async function ignoreJob(jobId: string): Promise<void> {
  const { profile } = await requireProfile()
  await prisma.discoveredJob.updateMany({
    where: { id: jobId, profileId: profile.id },
    data: { status: 'ignored' },
  })
  revalidatePath('/dashboard/job-hunt')
}

// ── removeDiscoveredJob ───────────────────────────────────────────────────────

export async function removeDiscoveredJob(jobId: string): Promise<void> {
  const { profile } = await requireProfile()
  await prisma.discoveredJob.deleteMany({
    where: { id: jobId, profileId: profile.id },
  })
  revalidatePath('/dashboard/job-hunt')
}

// ── retryAtsDiscovery ─────────────────────────────────────────────────────────

type RetryAtsResult = { ok: true; provider: string; boardSlug: string | null } | { ok: false; error: string }

export async function retryAtsDiscovery(input: RetryAtsInput): Promise<RetryAtsResult> {
  const parsed = RetryAtsInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }

  const { profile } = await requireProfile()

  const watch = await prisma.companyWatch.findFirst({
    where: { id: parsed.data.watchId, profileId: profile.id },
    select: { id: true },
  })
  if (!watch) return { ok: false, error: 'Watch not found' }

  const urlAts = detectAtsBoardFromUrl(parsed.data.website)

  let atsProvider: string
  let boardSlug: string | null
  let careersUrl: string | null = null
  let confidence: number
  let status: string

  if (urlAts) {
    atsProvider = urlAts.provider
    boardSlug = urlAts.boardSlug
    confidence = 1
    status = 'active'
  } else {
    const discovery = await discoverAts(profile.id, parsed.data.website)
    atsProvider = discovery.provider
    boardSlug = discovery.boardSlug ?? null
    careersUrl = discovery.careersUrl ?? null
    confidence = discovery.confidence
    status = discovery.provider === 'unknown' ? 'discovery_failed' : 'active'
  }

  await prisma.companyWatch.updateMany({
    where: { id: parsed.data.watchId, profileId: profile.id },
    data: { website: parsed.data.website, atsProvider, boardSlug, careersUrl, confidence, status },
  })

  revalidatePath('/dashboard/job-hunt')

  if (atsProvider === 'unknown') {
    return { ok: false, error: 'Could not detect ATS — try a direct careers page or ATS board URL' }
  }
  return { ok: true, provider: atsProvider, boardSlug }
}

// ── saveAdditionalRoles ───────────────────────────────────────────────────────
// Partial-merge update for additionalRoles. Does not touch any other field in
// onboardingContext — the onboarding form manages the rest.

export async function saveAdditionalRoles(roles: string[]): Promise<void> {
  const { profile } = await requireProfile()

  const existing = await prisma.userSettings.findUnique({
    where: { profileId: profile.id },
    select: { onboardingContext: true },
  })
  const context = normalizeOnboardingContext(existing?.onboardingContext)
  context.additionalRoles = roles.map((r) => r.trim()).filter(Boolean)

  await prisma.userSettings.upsert({
    where: { profileId: profile.id },
    create: { profileId: profile.id, onboardingContext: context },
    update: { onboardingContext: context },
  })

  revalidatePath('/dashboard/job-hunt')
}
