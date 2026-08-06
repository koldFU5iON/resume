import { prisma } from '@/lib/db'
import { parseCVContent } from './schema'

export async function getCV(id: string, profileId: string) {
  const doc = await prisma.cVDocument.findFirst({
    where: { id, profileId },
    include: {
      profile: { select: { name: true } },
      jobApplication: {
        select: { id: true, title: true, company: true, jobDescription: true, jobFit: true },
      },
    },
  })
  if (!doc) return null
  return { ...doc, content: parseCVContent(doc.generatedContent) }
}

export async function listCVs(profileId: string) {
  return prisma.cVDocument.findMany({
    where: { profileId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      status: true,
      jobTitle: true,
      company: true,
      jobApplicationId: true,
      careerVerticalId: true,
      createdAt: true,
      updatedAt: true,
    },
  })
}
