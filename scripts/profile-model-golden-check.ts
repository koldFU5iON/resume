// Read-only check that the role-owns switch is invisible to every reader, for one profile.
// Prints a fingerprint of what the vault, the CV candidates, the readiness findings, the profile map
// and the LLM snapshot produce from the profile as it is, and from the profile with every
// project-only activity given its project's role in memory. Equal means the assignment step changes
// nothing a reader sees. Run it before and after the assignment step: the "current" fingerprint must not change.
//
//   npm run profile:golden-check -- --profile <profileId|email> [--now 2026-11-20] [--allow-remote]
//
// Only select queries; the session is set read-only. Refuses a non-local database unless --allow-remote.
import { parseArgs } from 'node:util'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function main() {
  const { values } = parseArgs({ options: { profile: { type: 'string' }, now: { type: 'string' }, 'allow-remote': { type: 'boolean', default: false } } })
  if (!values.profile) fail('Usage: npm run profile:golden-check -- --profile <profileId|email> [--now YYYY-MM-DD] [--allow-remote]')

  try { process.loadEnvFile('.env.local') } catch { /* env may come from the shell */ }
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set.')
  const { isLocalDatabaseUrl, READ_ONLY_PG_OPTIONS } = await import('../src/modules/job-assessment/local-db-guard')
  if (!isLocalDatabaseUrl(process.env.DATABASE_URL)) {
    if (!values['allow-remote']) fail('Refusing to run: the database host is not local. Pass --allow-remote to read from a remote database.')
    console.warn('WARNING: running against a REMOTE database. Read-only.\n')
  }

  const { PrismaClient } = await import('@prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { Pool } = await import('pg')
  const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL, options: READ_ONLY_PG_OPTIONS })) })
  const { VAULT_INCLUDE } = await import('../src/modules/profile-map/source')
  const { readerFingerprint, sameFingerprint, simulateAssignment } = await import('../src/modules/cv-generation/role-owns-check')

  try {
    const who = values.profile!
    const matches = await prisma.profile.findMany({ where: { OR: [{ id: who }, { user: { email: who } }] }, select: { id: true }, take: 2 })
    if (matches.length === 0) fail('No profile found for that id or sign-in email.')
    if (matches.length > 1) fail('More than one profile matches. Use the profile id.')
    const source = await prisma.profile.findUniqueOrThrow({ where: { id: matches[0].id }, include: VAULT_INCLUDE })
    const now = new Date(`${values.now ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`)

    const current = readerFingerprint(source, now)
    const assigned = readerFingerprint(simulateAssignment(source), now)
    const projectOnly = source.projects.reduce((n, p) => n + p.activities.filter((a) => !a.experienceId).length, 0)
    const bothSet = source.projects.reduce((n, p) => n + p.activities.filter((a) => a.experienceId).length, 0)
    console.log(`as of ${now.toISOString().slice(0, 10)}; ${projectOnly} project-only activities; ${bothSet} activities that already have both a role and a project`)
    console.log('current  ', JSON.stringify(current))
    console.log('assigned ', JSON.stringify(assigned))
    console.log(sameFingerprint(current, assigned) ? 'SAME: no reader can tell the difference.' : 'DIFFERENT: a reader would notice the assignment. Do not assign yet.')
    if (!sameFingerprint(current, assigned)) process.exitCode = 2
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
