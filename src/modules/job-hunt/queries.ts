// src/modules/job-hunt/queries.ts
import { prisma } from '@/lib/db'
import { requireProfile } from '@/lib/session'

export async function getScanSummary() {
  const { profile } = await requireProfile()
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const [companiesScanned, companiesFailed, boardsScanned, boardsFailed, jobsToday] =
    await prisma.$transaction([
      prisma.companyWatch.count({ where: { profileId: profile.id, lastScannedAt: { not: null } } }),
      prisma.companyWatch.count({ where: { profileId: profile.id, lastScanError: { not: null } } }),
      prisma.jobBoardSource.count({ where: { profileId: profile.id, lastScannedAt: { not: null } } }),
      prisma.jobBoardSource.count({ where: { profileId: profile.id, lastScanError: { not: null } } }),
      prisma.discoveredJob.count({ where: { profileId: profile.id, createdAt: { gte: startOfToday } } }),
    ])

  return { companiesScanned, companiesFailed, boardsScanned, boardsFailed, jobsToday }
}

export async function getWatchlist() {
  const { profile } = await requireProfile()
  return prisma.companyWatch.findMany({
    where: { profileId: profile.id, status: { not: 'paused' } },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getDiscoveredJobs(filters?: {
  watchIds?: string[]
  boardSourceIds?: string[]
  statuses?: string[]
  sourceType?: 'company' | 'board' | 'scout'
}) {
  const { profile } = await requireProfile()

  return prisma.discoveredJob.findMany({
    where: {
      profileId: profile.id,
      status: filters?.statuses ? { in: filters.statuses } : { notIn: ['ignored'] },
       ...(filters?.sourceType === 'company'
         ? { source: 'COMPANY' }
         : filters?.sourceType === 'board'
           ? { source: 'BOARD' }
           : filters?.sourceType === 'scout'
             ? { source: 'SCOUT' }
           : {}),
      ...(filters?.watchIds?.length ? { watchId: { in: filters.watchIds } } : {}),
      ...(filters?.boardSourceIds?.length
        ? { boardSourceId: { in: filters.boardSourceIds } }
        : {}),
    },
    include: {
      watch: { select: { name: true, atsProvider: true, status: true } },
      boardSource: { select: { provider: true } },
    },
    orderBy: [{ postedAt: 'desc' }, { createdAt: 'desc' }],
  })
}

export async function getDiscoveredJob(id: string) {
  const { profile } = await requireProfile()
  return prisma.discoveredJob.findFirst({
    where: { id, profileId: profile.id },
  })
}
