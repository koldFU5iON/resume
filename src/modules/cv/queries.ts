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
  const master = await prisma.cVDocument.findFirst({
    where: { profileId, jobApplicationId: null, careerVerticalId: { not: null } },
    select: { updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  })

  const docs = await prisma.cVDocument.findMany({
    where: { profileId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      status: true,
      jobTitle: true,
      company: true,
      jobApplicationId: true,
      careerVerticalId: true,
      masterCvUpdatedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  // A job CV is stale when it was tailored from a master CV that has since been
  // regenerated or edited. masterCvUpdatedAt is only set on master-derived docs.
  return docs.map(doc => ({
    ...doc,
    stale:
      doc.masterCvUpdatedAt !== null &&
      master !== null &&
      doc.masterCvUpdatedAt < master.updatedAt &&
      doc.jobApplicationId !== null,
  }))
}
