// Imports the UK sponsor register into Company + SponsorLicence. Run daily by
// the cron route (/api/internal/sponsor-register/import).
//
// - Skips the download when the gov.uk CSV link is the one the last complete
//   import used, unless forced.
// - Refuses a file that looks wrong (columns, row count) before writing, so a
//   bad download can't mark every licence as lost.
// - Writes in one transaction under an advisory lock: a failed run leaves the
//   previous data untouched, and two runs never overlap.
// - Set-based SQL over unnest() arrays: ~143k rows in a few dozen statements.

import { prisma } from '@/lib/db'
import { parseCompanyName } from './normalize'
import { fetchRegisterCsvUrl, fetchRegisterText, parseRegisterCsv, type RegisterRow } from './sponsor-register'

export const REGISTER_COUNTRY = 'GB'

/** Arbitrary constant key for pg_try_advisory_xact_lock. */
const IMPORT_LOCK_KEY = 735_120_401

const BATCH_SIZE = 5_000

/** The whole write transaction must finish inside the route's 300s. */
const TRANSACTION_TIMEOUT_MS = 200_000

export type ImportResult =
  | { status: 'complete'; importId: string; sourceUrl: string; rows: number; added: number; removed: number }
  | { status: 'skipped'; importId: string; sourceUrl: string }
  | { status: 'failed'; importId: string | null; error: string }

type CompanyRow = { name: string; normalizedName: string; aliases: string[] }

/** One Company per normalised legal name, with every trading name seen as an alias. */
export function companiesFromRegister(rows: readonly RegisterRow[]): CompanyRow[] {
  const byKey = new Map<string, CompanyRow>()
  for (const r of rows) {
    const { normalizedName, aliases } = parseCompanyName(r.orgName)
    if (!normalizedName) continue
    const existing = byKey.get(normalizedName)
    if (existing) {
      for (const a of aliases) if (!existing.aliases.includes(a)) existing.aliases.push(a)
    } else {
      const legalName = r.orgName.split(/\s+(?:t\/a|t\.a\.|trading\s+as)\s+/i)[0].trim() || r.orgName
      byKey.set(normalizedName, { name: legalName, normalizedName, aliases: [...aliases] })
    }
  }
  return [...byKey.values()]
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Start time of the newest complete import: licences seen at or after it are current. */
export async function latestCompleteImport(): Promise<{ startedAt: Date; sourceUrl: string } | null> {
  return prisma.sponsorRegisterImport.findFirst({
    where: { country: REGISTER_COUNTRY, status: 'complete' },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true, sourceUrl: true },
  })
}

type Fetch = typeof fetch

export async function runSponsorRegisterImport(opts: { force?: boolean; fetchImpl?: Fetch } = {}): Promise<ImportResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  let importId: string | null = null
  try {
    const sourceUrl = await fetchRegisterCsvUrl(fetchImpl)
    const previous = await latestCompleteImport()

    if (!opts.force && previous?.sourceUrl === sourceUrl) {
      const row = await prisma.sponsorRegisterImport.create({
        data: { sourceUrl, status: 'skipped', completedAt: new Date() },
        select: { id: true },
      })
      return { status: 'skipped', importId: row.id, sourceUrl }
    }

    const started = await prisma.sponsorRegisterImport.create({
      data: { sourceUrl, status: 'running' },
      select: { id: true, startedAt: true },
    })
    importId = started.id
    const seenAt = started.startedAt

    const rows = parseRegisterCsv(await fetchRegisterText(sourceUrl, fetchImpl))
    const companies = companiesFromRegister(rows)

    const { added, removed } = await prisma.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${IMPORT_LOCK_KEY}) AS locked`
        if (!locked) throw new Error('Another sponsor register import is running.')

        for (const batch of chunks(companies, BATCH_SIZE)) {
          await tx.$executeRaw`
            INSERT INTO "Company" ("id", "name", "normalizedName", "aliases", "fromRegister", "createdAt", "updatedAt")
            SELECT gen_random_uuid()::text, v.name, v.norm,
                   CASE WHEN v.aliases = '' THEN '{}'::text[] ELSE string_to_array(v.aliases, E'\\x1f') END,
                   true, now(), now()
            FROM unnest(
              ${batch.map((c) => c.name)}::text[],
              ${batch.map((c) => c.normalizedName)}::text[],
              ${batch.map((c) => c.aliases.join('\x1f'))}::text[]
            ) AS v(name, norm, aliases)
            ON CONFLICT ("normalizedName") DO UPDATE
              SET "aliases" = ARRAY(SELECT DISTINCT unnest("Company"."aliases" || EXCLUDED."aliases")),
                  -- A company first created from a job name takes the register's name.
                  "name" = CASE WHEN "Company"."fromRegister" THEN "Company"."name" ELSE EXCLUDED."name" END,
                  "fromRegister" = true,
                  "updatedAt" = now()
              WHERE NOT "Company"."fromRegister" OR NOT (EXCLUDED."aliases" <@ "Company"."aliases")`
        }

        let added = 0
        for (const batch of chunks(rows, BATCH_SIZE)) {
          const [{ inserted }] = await tx.$queryRaw<{ inserted: number }[]>`
            WITH v AS (
              SELECT * FROM unnest(
                ${batch.map((r) => r.orgName)}::text[],
                ${batch.map((r) => r.townCity)}::text[],
                ${batch.map((r) => r.county)}::text[],
                ${batch.map((r) => r.typeRating)}::text[],
                ${batch.map((r) => r.route)}::text[],
                ${batch.map((r) => parseCompanyName(r.orgName).normalizedName)}::text[]
              ) AS v(org, town, county, type, route, norm)
            ), upserted AS (
              INSERT INTO "SponsorLicence"
                ("id", "companyId", "country", "orgName", "townCity", "county", "typeRating", "route", "firstSeenAt", "lastSeenAt")
              SELECT gen_random_uuid()::text, c."id", ${REGISTER_COUNTRY}, v.org, v.town, v.county, v.type, v.route, ${seenAt}, ${seenAt}
              FROM v JOIN "Company" c ON c."normalizedName" = v.norm
              ON CONFLICT ("country", "orgName", "townCity", "route") DO UPDATE
                SET "lastSeenAt" = EXCLUDED."lastSeenAt",
                    "typeRating" = EXCLUDED."typeRating",
                    "county" = EXCLUDED."county",
                    "companyId" = EXCLUDED."companyId"
              RETURNING (xmax = 0) AS is_new
            )
            SELECT (COUNT(*) FILTER (WHERE is_new))::int AS inserted FROM upserted`
          added += inserted
        }

        // Lost since the previous complete import: listed then, not now.
        const removed = previous
          ? await tx.sponsorLicence.count({
              where: { country: REGISTER_COUNTRY, lastSeenAt: { gte: previous.startedAt, lt: seenAt } },
            })
          : 0
        return { added, removed }
      },
      { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 10_000 },
    )

    await prisma.sponsorRegisterImport.update({
      where: { id: importId },
      data: { status: 'complete', rows: rows.length, added, removed, completedAt: new Date() },
    })
    return { status: 'complete', importId, sourceUrl, rows: rows.length, added, removed }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    if (importId) {
      await prisma.sponsorRegisterImport
        .update({ where: { id: importId }, data: { status: 'failed', error: error.slice(0, 2000), completedAt: new Date() } })
        .catch(() => {})
    }
    return { status: 'failed', importId, error }
  }
}
