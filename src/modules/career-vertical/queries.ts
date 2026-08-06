import { prisma } from '@/lib/db'

export async function getCareerVertical(profileId: string) {
  return prisma.careerVertical.findUnique({ where: { profileId } })
}

// The master CVDocument tied to a career vertical, if one has been generated.
export async function getMasterCVForVertical(profileId: string, careerVerticalId: string) {
  return prisma.cVDocument.findFirst({
    where: { profileId, jobApplicationId: null, careerVerticalId },
    select: { id: true, status: true, updatedAt: true },
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
