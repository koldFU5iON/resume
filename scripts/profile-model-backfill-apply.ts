// Applies the profile model backfill for one profile. WRITES to the database. Gives each project-only activity
// its project's role (the project stays as its label) and folds responsibilities into Overview notes.
// Nothing is deleted and no wording changes.
// Read the dry-run report first (npm run profile:backfill-report).
//
//   npm run profile:backfill-apply -- --profile <profileId|email> [--allow-remote]               dry run: prints the plan and a fingerprint
//   npm run profile:backfill-apply -- --profile <profileId|email> --apply --confirm <fingerprint> [--allow-remote]
//
// The fingerprint identifies exactly what would be written. --apply refuses to run unless the plan,
// rebuilt inside the transaction, still has that fingerprint, so anything edited since the dry run stops it.
// One transaction: a failed guard rolls everything back. Refuses a non-local DATABASE_URL unless --allow-remote.
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
      confirm: { type: 'string' },
      'allow-remote': { type: 'boolean', default: false },
    },
  })
  if (!values.profile) fail('Usage: npm run profile:backfill-apply -- --profile <profileId|email> [--apply --confirm <fingerprint>] [--allow-remote]')

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
  const { applyPlan, blockers, planFingerprint, summarisePlan } = await import('../src/modules/profile/model-backfill-apply')

  try {
    const who = values.profile!
    const matches = await prisma.profile.findMany({ where: { OR: [{ id: who }, { user: { email: who } }] }, select: { id: true }, take: 2 })
    if (matches.length === 0) fail('No profile found for that id or sign-in email.')
    if (matches.length > 1) fail('More than one profile matches. Use the profile id.')
    const profileId = matches[0].id

    const load = async (db: Pick<typeof prisma, 'experience' | 'project' | 'roleActivity'>) => {
      const [experiences, projects, rows] = await Promise.all([
        db.experience.findMany({ where: { profileId }, select: { id: true, company: true, role: true, type: true, summary: true, revision: true }, orderBy: { startDate: 'desc' } }),
        db.project.findMany({ where: { profileId }, select: { id: true, name: true, experienceId: true, notes: true, revision: true }, orderBy: { name: 'asc' } }),
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
    const fingerprint = planFingerprint(report, input)
    console.log(`This run would give ${plan.activitiesAssigned} activities their project's role and fold ${plan.responsibilitiesFolded} responsibilities into ${plan.notesFolded} notes. Fingerprint: ${fingerprint}`)
    if (!values.apply) {
      console.log(`DRY RUN: nothing changed. To apply: --apply --confirm ${fingerprint}`)
      return
    }
    if (!values.confirm) fail('--apply needs --confirm <fingerprint> from the dry run.')

    // The plan is rebuilt inside the transaction from the rows as they are then, and must match what was confirmed.
    const result = await prisma.$transaction(async (tx) => {
      const fresh = await load(tx)
      return applyPlan(tx, profileId, fresh, planBackfill(fresh), values.confirm!)
    }, { timeout: 60_000 })
    console.log(`APPLIED: gave ${result.activitiesAssigned} activities their project's role and folded ${result.responsibilitiesFolded} responsibilities into ${result.notesFolded} notes.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
