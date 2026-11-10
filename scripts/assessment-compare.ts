// Read-only side-by-side of JobFit (Claude) and the latest complete early
// assessment (Jev), per job, for one profile. Logic lives in
// src/modules/job-assessment/compare.ts.
//
//   npm run assess:compare -- --profile <profileId|email> [--csv tmp/compare.csv] [--version early-v1] [--allow-remote]
//
// Refuses a non-local DATABASE_URL unless --allow-remote. Only reads; makes no
// LLM or Jev calls.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, isAbsolute } from 'node:path'
import { parseArgs } from 'node:util'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function main() {
  const { values } = parseArgs({
    options: {
      profile: { type: 'string' },
      csv: { type: 'string' },
      version: { type: 'string' },
      'allow-remote': { type: 'boolean', default: false },
    },
  })
  if (!values.profile) fail('Usage: npm run assess:compare -- --profile <profileId|email> [--csv tmp/<file>.csv] [--version <pipelineVersion>] [--allow-remote]')

  try { process.loadEnvFile('.env.local') } catch { /* env may come from the shell */ }
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set.')

  const host = new URL(process.env.DATABASE_URL).hostname
  const local = host === 'localhost' || host === '127.0.0.1'
  if (!local) {
    if (!values['allow-remote']) fail(`Refusing to run: DATABASE_URL host is not localhost/127.0.0.1. Pass --allow-remote to read from a remote database.`)
    console.warn('WARNING: running against a REMOTE database. This script is read-only (select queries only).\n')
  }

  let csvPath: string | undefined
  if (values.csv) {
    csvPath = resolve(values.csv)
    const rel = relative(resolve('tmp'), csvPath)
    if (rel.startsWith('..') || isAbsolute(rel)) fail('--csv must be a path under tmp/ (gitignored).')
  }

  const { prisma } = await import('../src/lib/db')
  const { compareAll, toCsv } = await import('../src/modules/job-assessment/compare')
  const { PIPELINE_VERSION } = await import('../src/modules/job-assessment/schema')
  const version = values.version ?? PIPELINE_VERSION

  try {
    const who = values.profile!
    const profile = await prisma.profile.findFirst({
      where: { OR: [{ id: who }, { email: who }, { user: { email: who } }] },
      select: { id: true },
    })
    if (!profile) fail('No profile found for that id or email.')

    const [jobs, runs] = await Promise.all([
      prisma.jobApplication.findMany({
        where: { profileId: profile.id },
        select: { id: true, title: true, company: true, jobFit: true },
      }),
      prisma.jobAssessment.findMany({
        where: { profileId: profile.id, status: 'complete', pipelineVersion: version, score: { not: null }, level: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { jobApplicationId: true, score: true, level: true, blocked: true },
      }),
    ])

    // Newest first, so the first run seen per job is the latest.
    const latest = new Map<string, (typeof runs)[number]>()
    for (const r of runs) if (!latest.has(r.jobApplicationId)) latest.set(r.jobApplicationId, r)

    const { rows, summary } = compareAll(
      jobs
        .map((j) => {
          const r = latest.get(j.id)
          return {
            id: j.id,
            title: j.title,
            company: j.company,
            jobFit: j.jobFit,
            assessment: r ? { score: r.score!, level: r.level as 'weak' | 'consider' | 'pursue' | 'priority', blocked: r.blocked } : null,
          }
        })
        // Only jobs that have at least one side.
        .filter((j) => j.assessment || (j.jobFit && typeof j.jobFit === 'object')),
    )

    console.log(`Pipeline version: ${version}   Jobs compared: ${summary.jobs}   With both: ${summary.paired}\n`)
    if (rows.length === 0) {
      console.log('No jobs with a JobFit or an early assessment for this profile.')
    } else {
      console.table(
        rows.map((r) => ({
          '!': r.disagreement ? '!' : '',
          job: `${r.title}${r.company ? ` @ ${r.company}` : ''}`.slice(0, 48),
          fit: r.fitRating === null ? '-' : `${r.fitRating} ${r.fitLabel ?? ''}`.trim(),
          fitBucket: r.fitBucket ?? '-',
          early: r.earlyScore ?? '-',
          level: r.earlyLevel ?? '-',
          blocked: r.earlyLevel ? (r.earlyBlocked ? 'yes' : 'no') : '-',
          why: r.reasons.join('; '),
        })),
      )
    }

    const fmt = (n: number | null) => (n === null ? 'n/a' : n.toFixed(2))
    console.log('\nSummary')
    console.log(`  JobFit levels:  ${JSON.stringify(summary.fitLevels)}`)
    console.log(`  Early levels:   ${JSON.stringify(summary.earlyLevels)}  (blocked: ${summary.earlyBlocked})`)
    console.log(`  Mean |score difference|: ${fmt(summary.meanAbsScoreDiff)}`)
    console.log(`  Spearman rank correlation: ${fmt(summary.spearman)}`)
    console.log(`  Disagreements: ${summary.disagreements}`)

    if (csvPath) {
      mkdirSync(dirname(csvPath), { recursive: true })
      writeFileSync(csvPath, toCsv(rows))
      console.log(`\nCSV written to ${relative(process.cwd(), csvPath)}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().then(() => process.exit(0), (err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
