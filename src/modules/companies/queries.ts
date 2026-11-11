// Read side of companies: what the UK sponsor register says about a company.

import { prisma } from '@/lib/db'
import { countryFromLocation, toCountryCode } from '@/modules/job-assessment/countries'
import { latestCompleteImport, REGISTER_COUNTRY } from './import'
import { licenceRating, SKILLED_WORKER_ROUTE } from './sponsor-register'

/** Spec §5. 'unknown' = no company match, or no complete import yet. */
export type SponsorRegisterResult = 'licensed' | 'licensed_other_route' | 'not_listed' | 'unknown'

export type SponsorEntry = { orgName: string; townCity: string; typeRating: string; route: string }

export type SponsorStatus = {
  result: SponsorRegisterResult
  /** Best Skilled Worker rating ('A', 'B' or the raw type) when licensed, else null. */
  rating: string | null
  /** Current register entries for the company, Skilled Worker first (at most MAX_ENTRIES). */
  entries: SponsorEntry[]
  /** All current entries, including any beyond `entries`. */
  totalEntries: number
  /** Start of the import the result is based on; null with no complete import. */
  registerAsOf: Date | null
}

const MAX_ENTRIES = 5

/** Pure: the status from a company's current licences. */
export function sponsorStatusFrom(
  licences: readonly SponsorEntry[],
  registerAsOf: Date | null,
  matched: boolean,
): SponsorStatus {
  if (!matched || !registerAsOf) {
    return { result: 'unknown', rating: null, entries: [], totalEntries: 0, registerAsOf }
  }
  const skilled = licences.filter((l) => l.route === SKILLED_WORKER_ROUTE)
  const ordered = [...skilled, ...licences.filter((l) => l.route !== SKILLED_WORKER_ROUTE)]
  const ratings = skilled.map((l) => licenceRating(l.typeRating))
  const rating = skilled.length === 0 ? null : ratings.includes('A') ? 'A' : ratings.includes('B') ? 'B' : ratings[0]
  return {
    result: skilled.length > 0 ? 'licensed' : licences.length > 0 ? 'licensed_other_route' : 'not_listed',
    rating,
    entries: ordered.slice(0, MAX_ENTRIES),
    totalEntries: licences.length,
    registerAsOf,
  }
}

/** What the UK register currently says about `companyId` (null = the job has no matched company). */
export async function getSponsorStatus(companyId: string | null): Promise<SponsorStatus> {
  const latest = await latestCompleteImport()
  if (!companyId || !latest) return sponsorStatusFrom([], latest?.startedAt ?? null, false)
  const licences = await prisma.sponsorLicence.findMany({
    where: { companyId, country: REGISTER_COUNTRY, lastSeenAt: { gte: latest.startedAt } },
    orderBy: [{ orgName: 'asc' }, { townCity: 'asc' }],
    select: { orgName: true, townCity: true, typeRating: true, route: true },
  })
  return sponsorStatusFrom(licences, latest.startedAt, true)
}

/**
 * Whether the UK register is relevant to a job: true when any of its
 * countries reads as the UK, or none reads as a country (location unknown).
 */
export function isUkOrUnknownJob(countries: readonly string[]): boolean {
  const codes = countries
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => toCountryCode(c) ?? countryFromLocation(c))
    .filter((c): c is string => c !== null)
  // Only cities ("London") or nothing: the country is unknown, so the register may apply.
  if (codes.length === 0) return true
  return codes.includes('GB')
}

/**
 * The register status for one of the profile's jobs, or null when the register
 * doesn't apply (the job is outside the UK) or the job isn't the profile's.
 */
export async function getJobSponsorStatus(profileId: string, jobId: string): Promise<SponsorStatus | null> {
  const job = await prisma.jobApplication.findFirst({
    where: { id: jobId, profileId },
    select: { companyId: true, countries: true },
  })
  if (!job || !isUkOrUnknownJob(job.countries)) return null
  return getSponsorStatus(job.companyId)
}
