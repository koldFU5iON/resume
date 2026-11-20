// The Prisma query shape the vault is built from. Kept apart from load.ts
// (which imports the db client) so build.ts and its tests stay pure.

import type { Prisma } from '@prisma/client'
import { ACTIVITY_ORDER } from '@/modules/profile/activity-order'

// Evidence owned by a role or a project. Stored link decisions: confirmed,
// suggested (ignored here) or rejected.
const ACTIVITIES_INCLUDE = {
  orderBy: ACTIVITY_ORDER,
  include: { skills: { select: { skillId: true, status: true } } },
} satisfies Prisma.Experience$activitiesArgs

export const VAULT_INCLUDE = {
  experiences: {
    orderBy: { startDate: 'desc' },
    include: {
      activities: ACTIVITIES_INCLUDE,
      skills: { select: { skillId: true } },
    },
  },
  projects: {
    orderBy: [{ startDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    include: { skills: { select: { skillId: true } }, activities: ACTIVITIES_INCLUDE },
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

type LoadedProfile = Prisma.ProfileGetPayload<{ include: typeof VAULT_INCLUDE }>
type LegacyActivity = Omit<LoadedProfile['experiences'][number]['activities'][number], 'experienceId'> & { experienceId: string | null }

// Historical snapshots and reader fixtures can still have project-only evidence and standalone projects.
export type VaultSource = Omit<LoadedProfile, 'experiences' | 'projects'> & {
  experiences: (Omit<LoadedProfile['experiences'][number], 'activities'> & { activities: LegacyActivity[] })[]
  projects: (Omit<LoadedProfile['projects'][number], 'activities' | 'experienceId'> & {
    activities: LegacyActivity[]
    experienceId: string | null
  })[]
}
