// The Prisma query shape the vault is built from. Kept apart from load.ts
// (which imports the db client) so build.ts and its tests stay pure.

import type { Prisma } from '@prisma/client'

export const VAULT_INCLUDE = {
  experiences: {
    orderBy: { startDate: 'desc' },
    include: {
      activities: {
        orderBy: [{ highlighted: 'desc' }, { order: 'asc' }],
        include: { skills: { select: { skillId: true } } },
      },
      skills: { select: { skillId: true } },
    },
  },
  projects: {
    orderBy: [{ startDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    include: { skills: { select: { skillId: true } } },
  },
  // Skills, tools and competencies (Skill.kind).
  skills: { orderBy: [{ order: 'asc' }, { category: 'asc' }, { name: 'asc' }] },
  educations: { orderBy: { startDate: 'desc' } },
  certifications: {
    orderBy: { issueDate: { sort: 'desc', nulls: 'last' } },
    include: { skills: { select: { skillId: true } } },
  },
  languages: { orderBy: [{ order: 'asc' }, { name: 'asc' }] },
  settings: { select: { searchProfile: true, updatedAt: true } },
} satisfies Prisma.ProfileInclude

export type VaultSource = Prisma.ProfileGetPayload<{ include: typeof VAULT_INCLUDE }>
