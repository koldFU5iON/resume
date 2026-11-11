// Links a job application's free-text company to a shared Company.
//
// Matching is exact only: the normalised name, then a trading-name alias held
// by exactly one company. When nothing matches, a Company is created from the
// job's name. Placeholders ("(unknown)", "Confidential") are never matched or
// created. Linking is best effort and never fails the caller.

import { prisma } from '@/lib/db'
import { isPlaceholderCompany, parseCompanyName } from './normalize'

/** Company id for a name, by normalised name and then by a unique alias; null when none. */
export async function findCompanyId(rawName: string): Promise<string | null> {
  const { normalizedName } = parseCompanyName(rawName)
  if (!normalizedName) return null
  const exact = await prisma.company.findUnique({ where: { normalizedName }, select: { id: true } })
  if (exact) return exact.id
  // An alias shared by several companies (a franchise trading name) is ambiguous: no match.
  const byAlias = await prisma.company.findMany({
    where: { aliases: { has: normalizedName } },
    select: { id: true },
    take: 2,
  })
  return byAlias.length === 1 ? byAlias[0].id : null
}

/** The matching Company's id, creating one when nothing matches; null for a blank or placeholder name. */
export async function matchOrCreateCompany(rawName: string | null | undefined): Promise<string | null> {
  const name = rawName?.trim()
  if (!name || isPlaceholderCompany(name)) return null
  const found = await findCompanyId(name)
  if (found) return found

  const { normalizedName, aliases } = parseCompanyName(name)
  // Upsert so two concurrent links of the same new name end on one row.
  const row = await prisma.company.upsert({
    where: { normalizedName },
    create: { name, normalizedName, aliases },
    update: {},
    select: { id: true },
  })
  return row.id
}

/**
 * Sets JobApplication.companyId from the job's current company name (null for
 * a placeholder). Raw SQL so `lastUpdated` isn't bumped, and only if the name
 * hasn't changed since it was read. Never throws. Returns true when the job
 * ends up linked to a Company.
 */
export async function linkJobCompany(profileId: string, jobId: string): Promise<boolean> {
  try {
    const job = await prisma.jobApplication.findFirst({
      where: { id: jobId, profileId },
      select: { company: true, companyId: true },
    })
    if (!job) return false
    const companyId = await matchOrCreateCompany(job.company)
    if (companyId === job.companyId) return companyId !== null
    const updated = await prisma.$executeRaw`
      UPDATE "JobApplication" SET "companyId" = ${companyId}::text
      WHERE "id" = ${jobId} AND "profileId" = ${profileId} AND "company" IS NOT DISTINCT FROM ${job.company}::text`
    return updated > 0 && companyId !== null
  } catch (err) {
    console.error('[companies] could not link job to a company', { jobId, err })
    return false
  }
}

/**
 * Links jobs that have a company name but no Company yet (the backfill for
 * jobs captured before companies existed, and a safety net for any write path
 * that didn't link). Walks by id so placeholder names don't block the rest.
 */
export async function linkUnlinkedJobs(opts: { deadline: number; batchSize?: number }): Promise<{ checked: number; linked: number }> {
  const batchSize = opts.batchSize ?? 200
  let cursor: string | undefined
  let checked = 0
  let linked = 0
  while (Date.now() < opts.deadline) {
    const jobs = await prisma.jobApplication.findMany({
      where: { companyId: null, company: { not: null }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, profileId: true, company: true },
    })
    if (jobs.length === 0) break
    for (const job of jobs) {
      if (Date.now() >= opts.deadline) break
      cursor = job.id
      checked++
      if (isPlaceholderCompany(job.company)) continue
      if (await linkJobCompany(job.profileId, job.id)) linked++
    }
  }
  return { checked, linked }
}
