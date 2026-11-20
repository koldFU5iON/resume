// Checks the role/project writes against a REAL local Postgres (the unit tests mock Prisma, so they cannot
// catch wrong SQL, cascades or constraints). Creates a disposable user and profile in the local database,
// asserts what each write does to every row shape, and deletes everything it made.
// Refuses any database that is not local.
//
//   npm run profile:roles-check
import assert from 'node:assert/strict'

async function main() {
  if (!process.env.DATABASE_URL) try { process.loadEnvFile('.env.local') } catch { /* env may come from the shell */ }
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const { isLocalDatabaseUrl } = await import('../src/modules/job-assessment/local-db-guard')
  if (!isLocalDatabaseUrl(url)) throw new Error('Refusing to run: this writes test rows, and the database is not local.')

  const { prisma } = await import('../src/lib/db')
  const { activityFieldsFor, deleteExperienceRow, deleteProjectRow, experienceDeleteImpact, withActivityOwnership } = await import('../src/modules/profile/activity-roles')
  const { ensureIndependentExperience } = await import('../src/modules/profile/independent-experience')
  const { saveProjectProperties } = await import('../src/modules/profile/properties')
  const { isEmployment } = await import('../src/modules/profile/experience-type')
  const { mergeProjects } = await import('../src/modules/profile/project-merge')

  const TAG = `ZZ-roles-check-${crypto.randomUUID()}`
  const user = await prisma.user.create({ data: { id: TAG, name: TAG, email: `${TAG}@example.test` } })
  let profileId = ''
  const experiences: string[] = []
  const projects: string[] = []
  const experience = async (n: number) => {
    const e = await prisma.experience.create({ data: { profileId, company: `${TAG} ${n}`, role: 'R', startDate: new Date('2020-01-01'), summary: '', tags: '[]' } })
    experiences.push(e.id)
    return e
  }
  const project = async (name: string, experienceId: string) => {
    const p = await prisma.project.create({ data: { profileId, experienceId, name: `${TAG} ${name}`, description: 'd', tags: '[]', highlights: '[]' } })
    projects.push(p.id)
    return p
  }
  const activity = (description: string, experienceId: string, projectId: string | null) =>
    prisma.roleActivity.create({ data: { description: `${TAG} ${description}`, kind: 'achievement', experienceId, projectId, tags: '[]', order: 0 } })
  const row = (id: string) => prisma.roleActivity.findUnique({ where: { id }, select: { experienceId: true, projectId: true } })
  const props = (name: string, experienceId: string | null) => ({ name: `${TAG} ${name}`, description: 'd', url: null, repoUrl: null, startDate: null, endDate: null, experienceId })

  /** Role e1 with project p1 holding: own role-only row, a consistent project-labelled row and another role's (e2) row. */
  const world = async () => {
    const e1 = await experience(1)
    const e2 = await experience(2)
    const p1 = await project('P1', e1.id)
    return { e1, e2, p1, own: await activity('own', e1.id, null), both: await activity('both', e1.id, p1.id), other: await activity('other-role', e2.id, p1.id) }
  }
  const clean = async () => {
    await prisma.roleActivity.deleteMany({ where: { OR: [{ experience: { profileId } }, { project: { profileId } }] } })
    await prisma.project.deleteMany({ where: { id: { in: projects } } })
    await prisma.experience.deleteMany({ where: { id: { in: experiences } } })
    experiences.length = 0
    projects.length = 0
  }

  try {
    profileId = (await prisma.profile.create({ data: { name: TAG, userId: user.id } })).id
    const empty = await experience(0)
    await deleteExperienceRow(profileId, empty.id, 'keep')
    assert.equal(await prisma.experience.count({ where: { profileId, type: 'independent' } }), 0, 'deleting a role without projects creates no home')
    assert.equal(await prisma.experience.count({ where: { profileId } }), 0, 'fresh profiles start without a home')
    let w = await world()
    const sqlState = (code: string) => new RegExp(`Code: \`${code}\``)
    await assert.rejects(prisma.$executeRaw`UPDATE "Project" SET "experienceId" = NULL WHERE id = ${w.p1.id}`, sqlState('23502'))
    await assert.rejects(prisma.$executeRaw`UPDATE "RoleActivity" SET "experienceId" = NULL WHERE id = ${w.both.id}`, sqlState('23502'))
    await assert.rejects(prisma.$executeRaw`UPDATE "Project" SET "experienceId" = ${TAG} WHERE id = ${w.p1.id}`, sqlState('23503'))
    await assert.rejects(prisma.$executeRaw`UPDATE "RoleActivity" SET "experienceId" = ${TAG} WHERE id = ${w.both.id}`, sqlState('23503'))
    await assert.rejects(prisma.$executeRaw`DELETE FROM "Experience" WHERE id = ${w.e1.id}`, sqlState('23503'))
    await withActivityOwnership(profileId, async tx => {
      assert.deepEqual(await activityFieldsFor(tx, profileId, { experienceId: w.e1.id, projectId: w.p1.id }), { experienceId: w.e1.id, projectId: w.p1.id })
      assert.deepEqual(await activityFieldsFor(tx, profileId, { experienceId: w.e1.id }), { experienceId: w.e1.id, projectId: null })
      await assert.rejects(activityFieldsFor(tx, profileId, { experienceId: w.e2.id, projectId: w.p1.id }), /another role/)
    })

    // What deleting the role counts and does.
    assert.deepEqual(await experienceDeleteImpact(profileId, w.e1.id), { evidence: 1, projects: 1, projectEvidence: 1 })
    const capability = await prisma.skill.create({ data: { profileId, name: TAG } })
    const result = { measure: 'release cycle', value: '2 weeks', baseline: '6 weeks' }
    await prisma.roleActivity.update({
      where: { id: w.both.id },
      data: {
        impact: 'Four weeks faster', result, order: 4,
        skills: { create: { skillId: capability.id, status: 'confirmed', source: 'manual' } },
      },
    })
    const keptContent = () => prisma.roleActivity.findUniqueOrThrow({
      where: { id: w.both.id },
      select: { description: true, impact: true, result: true, order: true, skills: true },
    })
    const original = await keptContent()
    await deleteExperienceRow(profileId, w.e1.id, 'keep')
    const home = (await prisma.experience.findFirstOrThrow({ where: { profileId, type: 'independent' }, orderBy: { createdAt: 'asc' } }))
    experiences.push(home.id)
    assert.deepEqual({ type: home.type, company: home.company, role: home.role }, { type: 'independent', company: 'Independent projects', role: 'Independent projects' })
    assert.equal(isEmployment(home), false)
    assert.equal(home.startDate.toISOString(), '1970-01-01T00:00:00.000Z')
    assert.equal(await row(w.own.id), null, 'role-only evidence goes with its role')
    assert.deepEqual(await row(w.both.id), { experienceId: home.id, projectId: w.p1.id }, 'kept project keeps its evidence, now under Independent projects')
    assert.deepEqual(await keptContent(), original, 'keeping the project preserves wording, result, order and capability links')
    assert.deepEqual(await row(w.other.id), { experienceId: w.e2.id, projectId: w.p1.id }, "another role's evidence is untouched when the projects are kept")
    assert.equal((await prisma.project.findUnique({ where: { id: w.p1.id } }))?.experienceId, home.id, 'the project moved to Independent projects')
    await assert.rejects(deleteExperienceRow(profileId, home.id, 'keep'), /Independent projects/, 'its own kept projects have nowhere to go')
    assert.ok(await prisma.experience.findUnique({ where: { id: home.id } }), 'and nothing was deleted')

    // Concurrent first use never makes two homes.
    const soloTag = `${TAG}-solo`
    const soloUser = await prisma.user.create({ data: { id: soloTag, name: TAG, email: `${soloTag}@example.test` } })
    try {
      const solo = await prisma.profile.create({ data: { name: `${TAG} solo`, userId: soloUser.id }, select: { id: true } })
      const ids = await Promise.all(Array.from({ length: 6 }, () => prisma.$transaction((tx) => ensureIndependentExperience(tx, solo.id))))
      assert.equal(new Set(ids).size, 1, 'six concurrent callers get one experience')
      assert.equal(await prisma.experience.count({ where: { profileId: solo.id, type: 'independent' } }), 1)
      const foreign = await prisma.project.create({ data: { profileId: solo.id, experienceId: ids[0], name: TAG, description: '' } })
      await withActivityOwnership(profileId, async tx => {
        await assert.rejects(activityFieldsFor(tx, profileId, { experienceId: ids[0] }), /Experience not found/)
        await assert.rejects(activityFieldsFor(tx, profileId, { experienceId: w.e2.id, projectId: foreign.id }), /Project not found/)
      })
      await assert.rejects(saveProjectProperties(profileId, w.p1.id, props('P1', ids[0])), /Experience not found/)
      await assert.rejects(mergeProjects(profileId, { keepId: w.p1.id, removeId: foreign.id, body: 'keep' }), /Project not found/)
      await deleteProjectRow(profileId, foreign.id)
      assert.ok(await prisma.project.findUnique({ where: { id: foreign.id } }))
    } finally {
      // A whole-profile/user deletion can still cascade through both the role and its projects.
      await prisma.user.delete({ where: { id: soloUser.id } })
    }
    await clean()

    w = await world()
    await deleteExperienceRow(profileId, w.e1.id, 'delete')
    assert.equal(await prisma.project.findUnique({ where: { id: w.p1.id } }), null)
    for (const a of [w.own, w.both]) assert.equal(await row(a.id), null)
    assert.deepEqual(await row(w.other.id), { experienceId: w.e2.id, projectId: null }, "another role's evidence survives, loses only the label")
    await clean()

    w = await world()
    await deleteProjectRow(profileId, w.p1.id)
    assert.equal(await row(w.both.id), null)
    assert.deepEqual(await row(w.other.id), { experienceId: w.e2.id, projectId: null })
    assert.deepEqual(await row(w.own.id), { experienceId: w.e1.id, projectId: null })
    await clean()

    // Force operations to overlap through a real row lock.
    async function queueBehindProjectLock(projectId: string, first: () => Promise<void>, second: () => Promise<void>) {
      let release!: () => void
      let locked!: (pid: number) => void
      const ready = new Promise<number>((resolve) => { locked = resolve })
      const unblock = new Promise<void>((resolve) => { release = resolve })
      const blocker = prisma.$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`
        locked(pid)
        await unblock
      }, { timeout: 15000 })
      const blockerPid = await ready
      const waitForBlocked = async (count: number) => {
        for (let attempt = 0; attempt < 150; attempt++) {
          const [{ waiting }] = await prisma.$queryRaw<{ waiting: bigint }[]>`
            WITH RECURSIVE blocked AS (
              SELECT pid FROM pg_stat_activity WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))
              UNION
              SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))
            ) SELECT count(*) AS waiting FROM blocked
          `
          if (Number(waiting) >= count) return
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        throw new Error(`Expected ${count} transactions waiting on the project lock`)
      }
      const pending: Promise<unknown>[] = [blocker]
      try {
        pending.push(first())
        await waitForBlocked(1)
        pending.push(second())
        await waitForBlocked(2)
      } finally {
        release()
        await Promise.all(pending)
      }
    }

    // Keep-delete rechecks the project after a move commits.
    w = await world()
    await queueBehindProjectLock(w.p1.id,
      () => saveProjectProperties(profileId, w.p1.id, props('P1', w.e2.id)),
      () => deleteExperienceRow(profileId, w.e1.id, 'keep'),
    )
    assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: w.p1.id } })).experienceId, w.e2.id)
    assert.deepEqual(await row(w.both.id), { experienceId: w.e2.id, projectId: w.p1.id })
    assert.equal(await prisma.experience.count({ where: { profileId, type: 'independent' } }), 0, 'a project moved away needs no independent home')
    await clean()

    // Moving a project between roles, then to Independent projects.
    w = await world()
    await saveProjectProperties(profileId, w.p1.id, props('P1', w.e2.id))
    assert.deepEqual(await row(w.both.id), { experienceId: w.e2.id, projectId: w.p1.id }, 'evidence that carried the old role follows')
    assert.deepEqual(await row(w.own.id), { experienceId: w.e1.id, projectId: null }, "the role's own evidence stays")
    await saveProjectProperties(profileId, w.p1.id, props('P1', null))
    const personal = await prisma.experience.findFirstOrThrow({ where: { profileId, type: 'independent' } })
    experiences.push(personal.id)
    await saveProjectProperties(profileId, w.p1.id, props('P1', null))
    assert.deepEqual(await row(w.both.id), { experienceId: personal.id, projectId: w.p1.id })
    assert.equal(await prisma.experience.count({ where: { profileId, type: 'independent' } }), 1)
    await clean()

    // Merging: same wording under different roles is never merged away; another role's evidence never ends up disagreeing.
    w = await world()
    const p2 = await project('P2', w.e1.id)
    const kept = await activity('kept twin', w.e1.id, p2.id)
    const sameWordingOtherRole = await activity('kept twin', w.e2.id, w.p1.id)   // role e2's evidence under p1, same wording as p2's own item
    const sameWordingOwn = await activity('kept twin', w.e1.id, w.p1.id)         // p1's own item, a true duplicate of p2's
    await mergeProjects(profileId, { keepId: p2.id, removeId: w.p1.id, body: 'keep' })
    assert.equal(await prisma.project.findUnique({ where: { id: w.p1.id } }), null, 'merged-away project is gone')
    assert.deepEqual(await row(sameWordingOtherRole.id), { experienceId: w.e2.id, projectId: null }, "another role's evidence survives with its role")
    assert.equal(await row(sameWordingOwn.id), null, 'a true duplicate is merged into the kept item')
    assert.deepEqual(await row(kept.id), { experienceId: w.e1.id, projectId: p2.id })
    assert.deepEqual(await row(w.both.id), { experienceId: w.e1.id, projectId: p2.id }, 'the project\'s own evidence moved')
    assert.deepEqual(await row(w.other.id), { experienceId: w.e2.id, projectId: null }, 'role e2 differs from the kept project\'s role e1: label removed, role kept')
    await clean()

    // Merge uses the kept project's owner after a concurrent Properties move.
    w = await world()
    const target = await project('Merge target', w.e1.id)
    await queueBehindProjectLock(target.id,
      () => saveProjectProperties(profileId, target.id, props('Merge target', w.e2.id)),
      () => mergeProjects(profileId, { keepId: target.id, removeId: w.p1.id, body: 'keep' }),
    )
    assert.deepEqual(await row(w.both.id), { experienceId: w.e2.id, projectId: target.id })
    console.log('ALL OK')
  } finally {
    if (profileId) {
      await clean()
      await prisma.profile.delete({ where: { id: profileId } })
    }
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
