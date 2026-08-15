import { prisma } from "@/lib/db"
import { requireProfile } from "@/lib/session"
import { parseJsonField } from "@/lib/utils"
import type {
  FullProfile,
  RoleActivityKindType,
  CompetencyOriginType,
} from "@/app/types/profile"

// Loads experience + its activities + the profile's skills — everything
// needed for extraction and duplicate detection in one query, no N+1.
export async function getExperienceWithSuggestionContext(
  experienceId: string,
  profileId: string,
) {
  const experience = await prisma.experience.findFirst({
    where: { id: experienceId, profileId },
    select: {
      id: true,
      company: true,
      role: true,
      location: true,
      remote: true,
      startDate: true,
      endDate: true,
      summary: true,
      activities: {
        select: { id: true, description: true, kind: true },
        orderBy: { order: 'asc' },
      },
    },
  })
  if (!experience) return null

  const skills = await prisma.skill.findMany({
    where: { profileId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  return { experience, skills }
}

// Loads the signed-in user's whole profile context store as domain types:
// JSON `tags` columns are parsed; String enum columns are narrowed.
export async function getFullProfile(): Promise<FullProfile> {
  const { profile } = await requireProfile()

  const row = await prisma.profile.findUniqueOrThrow({
    where: { id: profile.id },
    include: {
      experiences: {
        orderBy: { startDate: "desc" },
        include: { activities: { orderBy: { order: "asc" } } },
      },
      skills: { orderBy: { name: "asc" } },
      educations: { orderBy: { startDate: "desc" } },
      certifications: { orderBy: { issueDate: "desc" } },
      competencies: { orderBy: { order: "asc" } },
      languages: { orderBy: { order: "asc" } },
      tools: { orderBy: { order: "asc" } },
      projects: { orderBy: { startDate: "desc" } },
    },
  })

  return {
    ...row,
    experiences: row.experiences.map((exp) => ({
      ...exp,
      tags: parseJsonField<string[]>(exp.tags, []),
      activities: exp.activities.map((act) => ({
        ...act,
        kind: act.kind as RoleActivityKindType,
        tags: parseJsonField<string[]>(act.tags, []),
      })),
    })),
    skills: row.skills.map((s) => ({ ...s, tags: parseJsonField<string[]>(s.tags, []) })),
    educations: row.educations.map((e) => ({ ...e, tags: parseJsonField<string[]>(e.tags, []) })),
    certifications: row.certifications.map((c) => ({
      ...c,
      tags: parseJsonField<string[]>(c.tags, []),
    })),
    competencies: row.competencies.map((c) => ({
      ...c,
      origin: c.origin as CompetencyOriginType,
    })),
    languages: row.languages,
    tools: row.tools,
    projects: row.projects.map(p => ({
      ...p,
      highlights: parseJsonField<string[]>(p.highlights, []),
      tags: parseJsonField<string[]>(p.tags, []),
    })),
  }
}
