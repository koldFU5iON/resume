import { prisma } from '@/lib/db'

export type CoverLetterListItem = {
  id: string
  jobTitle: string | null
  company: string | null
  jobApplicationId: string | null
  content: string
  status: string
  updatedAt: Date
  createdAt: Date
}

export type CoverLetterWithJob = {
  id: string
  content: string
  status: string
  jobTitle: string | null
  company: string | null
  jobApplicationId: string | null
  jobApplication: {
    id: string
    title: string
    company: string | null
    status: string
    jobAnalysis: unknown
    jobDescription: string | null
  } | null
}

export async function listCoverLetters(profileId: string): Promise<CoverLetterListItem[]> {
  return prisma.coverLetterDocument.findMany({
    where: { profileId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      jobTitle: true,
      company: true,
      jobApplicationId: true,
      content: true,
      status: true,
      updatedAt: true,
      createdAt: true,
    },
  })
}

export async function getCoverLetter(
  profileId: string,
  id: string
): Promise<CoverLetterWithJob | null> {
  return prisma.coverLetterDocument.findFirst({
    where: { id, profileId },
    select: {
      id: true,
      content: true,
      status: true,
      jobTitle: true,
      company: true,
      jobApplicationId: true,
      jobApplication: {
        select: {
          id: true,
          title: true,
          company: true,
          status: true,
          jobAnalysis: true,
          jobDescription: true,
        },
      },
    },
  })
}
