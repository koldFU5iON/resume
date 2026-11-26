import { prisma } from '@/lib/db'

export async function getCareerVertical(profileId: string) {
  return prisma.careerVertical.findUnique({ where: { profileId } })
}

// The master CV for the career vertical page (#469): the Writing Desk
// master's last update and whether a generated draft waits for review, or
// the old CV Builder master's last update while there is no desk one yet.
export async function getMasterCvSummary(profileId: string): Promise<{ updatedAt: Date; hasDraft: boolean } | null> {
  const desk = await prisma.writingDeskDocument.findUnique({
    where: { masterOfProfileId: profileId },
    select: { profileId: true, updatedAt: true, draftContent: true },
  })
  if (desk && desk.profileId === profileId) return { updatedAt: desk.updatedAt, hasDraft: desk.draftContent !== null }
  const legacy = await getLatestMasterCV(profileId)
  return legacy ? { updatedAt: legacy.updatedAt, hasDraft: false } : null
}

// The most recently updated OLD (CV Builder) master CVDocument, if any. The
// master CV now lives in the writing desk; this is read only for the fallback
// above and the old editor's stale banner.
export async function getLatestMasterCV(profileId: string) {
  return prisma.cVDocument.findFirst({
    where: { profileId, jobApplicationId: null, careerVerticalId: { not: null } },
    select: { id: true, status: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  })
}

// Jobs that can seed a career vertical analysis — only those with a description.
export async function listVerticalCandidateJobs(profileId: string) {
  return prisma.jobApplication.findMany({
    where: { profileId },
    select: {
      id: true,
      title: true,
      company: true,
      jobDescription: true,
      status: true,
      lastUpdated: true,
    },
    orderBy: { lastUpdated: 'desc' },
  })
}
