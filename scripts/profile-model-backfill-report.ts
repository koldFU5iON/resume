// Read-only dry run of the profile model backfill for one profile. Prints what a
// later migration would do and what only you can decide. Changes nothing: only
// select queries, and the database session is set read-only. Logic lives in
// src/modules/profile/model-backfill.ts.
//
//   npm run profile:backfill-report -- --profile <profileId|email> [--json] [--allow-remote]
//
// Refuses a non-local DATABASE_URL unless --allow-remote.
import { parseArgs } from 'node:util'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function main() {
  const { values } = parseArgs({
    options: {
      profile: { type: 'string' },
      json: { type: 'boolean', default: false },
      'allow-remote': { type: 'boolean', default: false },
    },
  })
  if (!values.profile) fail('Usage: npm run profile:backfill-report -- --profile <profileId|email> [--json] [--allow-remote]')

  try { process.loadEnvFile('.env.local') } catch { /* env may come from the shell */ }
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set.')

  const { isLocalDatabaseUrl, READ_ONLY_PG_OPTIONS } = await import('../src/modules/job-assessment/local-db-guard')
  if (!isLocalDatabaseUrl(process.env.DATABASE_URL)) {
    if (!values['allow-remote']) fail('Refusing to run: the database host is not local (localhost, 127.0.0.1, ::1 or a socket path). Pass --allow-remote to read from a remote database.')
    console.warn('WARNING: running against a REMOTE database. This script is read-only (select queries only; the session is also set read-only).\n')
  }

  // Own client (not src/lib/db.ts): every connection is read-only at the Postgres session level.
  const { PrismaClient } = await import('@prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { Pool } = await import('pg')
  const prisma = new PrismaClient({
    adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL, options: READ_ONLY_PG_OPTIONS })),
  })
  const { planBackfill, formatReport } = await import('../src/modules/profile/model-backfill')

  try {
    const who = values.profile!
    const profile = await prisma.profile.findFirst({
      where: { OR: [{ id: who }, { email: who }, { user: { email: who } }] },
      select: { id: true },
    })
    if (!profile) fail('No profile found for that id or email.')

    const [experiences, projects, activities] = await Promise.all([
      prisma.experience.findMany({
        where: { profileId: profile.id },
        select: { id: true, company: true, role: true, type: true, summary: true },
        orderBy: { startDate: 'desc' },
      }),
      prisma.project.findMany({
        where: { profileId: profile.id },
        select: { id: true, name: true, experienceId: true },
        orderBy: { name: 'asc' },
      }),
      // Activities belong to the profile through their role or their project.
      prisma.roleActivity.findMany({
        where: { OR: [{ experience: { profileId: profile.id } }, { project: { profileId: profile.id } }] },
        select: { id: true, kind: true, description: true, experienceId: true, projectId: true },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      }),
    ])

    const report = planBackfill({ experiences, projects, activities })
    console.log(values.json ? JSON.stringify(report, null, 2) : formatReport(report))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
