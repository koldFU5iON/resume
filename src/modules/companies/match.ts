// Links a job application's free-text company to a shared Company.
//
// Company names are shared across users, so only the register is trusted to
// say what matches what. Lookup order for a job's normalised name:
//   1. a register company with that exact name
//   2. a register trading-name alias held by exactly one company
//      (held by several = ambiguous: the job stays unlinked, nothing is created)
//   3. a company created earlier from a job with that exact name
//   4. otherwise a new company is created from the job's name, without aliases
// A job-created company never adds aliases and never outranks a register
// name or alias, so one user's typing can't change another user's matches.
// Placeholders ("(unknown)", "Confidential") are never matched or created.
// Linking is best effort and never fails the caller.

import { prisma } from '@/lib/db'
import { isPlaceholderCompany, parseCompanyName } from './normalize'

export type CompanyLookup =
  | { kind: 'match'; id: string }
  /** A register alias held by several companies (e.g. a franchise trading name). */
  | { kind: 'ambiguous' }
  | { kind: 'none' }

/** The Company a name matches, following the order above. Never creates anything. */
export async function findCompany(rawName: string): Promise<CompanyLookup> {
  // Trading names in a job's company field are ignored: only the register supplies aliases.
  const { normalizedName } = parseCompanyName(rawName)
  if (!normalizedName) return { kind: 'none' }

  const exact = await prisma.company.findUnique({
    where: { normalizedName },
    select: { id: true, fromRegister: true },
  })
  if (exact?.fromRegister) return { kind: 'match', id: exact.id }

  const byAlias = await prisma.company.findMany({
    where: { fromRegister: true, aliases: { has: normalizedName } },
    select: { id: true },
    take: 2,
  })
  if (byAlias.length === 1) return { kind: 'match', id: byAlias[0].id }
  if (byAlias.length > 1) return { kind: 'ambiguous' }

  return exact ? { kind: 'match', id: exact.id } : { kind: 'none' }
}

/**
 * The matching Company's id, creating one when nothing matches. Null for a
 * blank or placeholder name, and for an ambiguous register alias.
 */
export async function matchOrCreateCompany(rawName: string | null | undefined): Promise<string | null> {
  const name = rawName?.trim()
  if (!name || isPlaceholderCompany(name)) return null
  const found = await findCompany(name)
  if (found.kind === 'match') return found.id
  if (found.kind === 'ambiguous') return null

  const { normalizedName } = parseCompanyName(name)
  // Upsert so two concurrent links of the same new name end on one row. No aliases, not from the register.
  const row = await prisma.company.upsert({
    where: { normalizedName },
    create: { name, normalizedName, aliases: [], fromRegister: false },
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
 * that didn't link), and re-checks jobs linked to a job-created company so
 * they move to a register company once the register lists that name. Walks by
 * id so placeholder names don't block the rest.
 */
export async function sweepJobCompanyLinks(opts: { deadline: number; batchSize?: number }): Promise<{ checked: number; linked: number }> {
  const batchSize = opts.batchSize ?? 200
  let cursor: string | undefined
  let checked = 0
  let linked = 0
  while (Date.now() < opts.deadline) {
    const jobs = await prisma.jobApplication.findMany({
      where: {
        company: { not: null },
        // Unlinked, or linked to a job-created company that a register name may now outrank.
        OR: [{ companyId: null }, { companyRef: { fromRegister: false } }],
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
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
