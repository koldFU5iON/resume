// The "Independent projects" experience: the timeless home for personal projects (design doc §12, §13 3d-2).
// Created on demand, one per profile. It is never a job (see experience-type.ts): its dates are a sentinel no
// reader may show or compare. The name is fixed for now; making it configurable is a later setting.

import { Prisma } from '@prisma/client'
import { INDEPENDENT_EXPERIENCE_TYPE } from './experience-type'

export const INDEPENDENT_EXPERIENCE_NAME = 'Independent projects'
/** Required by the column, meaningless for this type: every date reader skips independent experiences. */
export const INDEPENDENT_SENTINEL_DATE = new Date(Date.UTC(1970, 0, 1))

type Tx = Pick<Prisma.TransactionClient, '$executeRaw' | 'experience'>

/**
 * Returns the profile's independent experience, creating it when there is none. Call inside a transaction: a
 * per-profile advisory lock makes two concurrent first calls create one row, not two. Always lock-then-find,
 * so the second caller sees the first one's row.
 */
export async function ensureIndependentExperience(tx: Tx, profileId: string): Promise<string> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`independent-experience:${profileId}`}))`)
  const existing = await tx.experience.findFirst({
    where: { profileId, type: INDEPENDENT_EXPERIENCE_TYPE },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  if (existing) return existing.id
  const created = await tx.experience.create({
    data: {
      profileId,
      type: INDEPENDENT_EXPERIENCE_TYPE,
      company: INDEPENDENT_EXPERIENCE_NAME,
      role: INDEPENDENT_EXPERIENCE_NAME,
      startDate: INDEPENDENT_SENTINEL_DATE,
      summary: '',
    },
    select: { id: true },
  })
  return created.id
}
