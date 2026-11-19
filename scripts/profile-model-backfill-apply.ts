// Applies the profile model backfill for one profile. WRITES to the database.
// Read the dry-run report first (npm run profile:backfill-report).
//
//   npm run profile:backfill-apply -- --profile <profileId|email> [--apply] [--allow-remote]
//
// Without --apply it only prints what it would do (the same as the report) and
// changes nothing. With --apply it makes the changes in one transaction: a
// failed guard rolls everything back. Refuses a non-local DATABASE_URL unless
// --allow-remote. It never deletes anything and never changes wording.
import { parseArgs } from 'node:util'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function main() {
  const { values } = parseArgs({
    options: {
      profile: { type: 'string' },
      apply: { type: 'boolean', default: false },
      'allow-remote': { type: 'boolean', default: false },
    },
  })
  if (!values.profile) fail('Usage: npm run profile:backfill-apply -- --profile <profileId|email> [--apply] [--allow-remote]')

  try { process.loadEnvFile('.env.local') } catch { /* env may come from the shell */ }
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set.')

  const { isLocalDatabaseUrl } = await import('../src/modules/job-assessment/local-db-guard')
  const remote = !isLocalDatabaseUrl(process.env.DATABASE_URL)
  if (remote && !values['allow-remote']) fail('Refusing to run: the database host is not local. Pass --allow-remote to use a remote database.')
  if (remote) console.warn('WARNING: this is a REMOTE database.\n')

  const { PrismaClient } = await import('@prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { Pool } = await import('pg')
  const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) })
  const { planBackfill, formatReport } = await import('../src/modules/profile/model-backfill')
  const { applyBackfill, blockers, summarisePlan } = await import('../src/modules/profile/model-backfill-apply')

  try {
    const who = values.profile!
    const matches = await prisma.profile.findMany({ where: { OR: [{ id: who }, { user: { email: who } }] }, select: { id: true }, take: 2 })
    if (matches.length === 0) fail('No profile found for that id or sign-in email.')
    if (matches.length > 1) fail('More than one profile matches. Use the profile id.')
    const profileId = matches[0].id

    const load = async (db: Pick<typeof prisma, 'experience' | 'project' | 'roleActivity'>) => {
      const [experiences, projects, rows] = await Promise.all([
        db.experience.findMany({ where: { profileId }, select: { id: true, company: true, role: true, type: true, summary: true, revision: true }, orderBy: { startDate: 'desc' } }),
        db.project.findMany({ where: { profileId }, select: { id: true, name: true, experienceId: true }, orderBy: { name: 'asc' } }),
        db.roleActivity.findMany({
          where: { OR: [{ experience: { profileId } }, { project: { profileId } }] },
          select: {
            id: true, kind: true, description: true, experienceId: true, projectId: true,
            experience: { select: { profileId: true } }, project: { select: { profileId: true } },
          },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        }),
      ])
      const activities = rows
        .filter((a) => !(a.experience && a.project && a.experience.profileId !== a.project.profileId))
        .map(({ id, kind, description, experienceId, projectId }) => ({ id, kind, description, experienceId, projectId }))
      return { experiences, projects, activities }
    }

    const input = await load(prisma)
    const report = planBackfill(input)
    console.log(formatReport(report))
    console.log('')
    const blocked = blockers(report)
    if (blocked) fail(blocked)
    const plan = summarisePlan(report)
    if (!values.apply) {
      console.log(`DRY RUN: would assign ${plan.activitiesAssigned} activities and fold ${plan.notesFolded} notes. Pass --apply to do it.`)
      return
    }

    // The plan is rebuilt inside the transaction from the rows as they are then, so what is applied is what is checked.
    const result = await prisma.$transaction(async (tx) => {
      const fresh = await load(tx)
      return applyBackfill(tx, profileId, fresh, planBackfill(fresh))
    }, { timeout: 60_000 })
    console.log(`APPLIED: assigned ${result.activitiesAssigned} activities, folded ${result.notesFolded} notes.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
