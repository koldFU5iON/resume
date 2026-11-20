import { cache } from "react"
import { ACTIVITY_ORDER } from "./activity-order"
import { projectEvidenceOf, roleOwnEvidence } from "./ownership"
import { prisma } from "@/lib/db"
import { requireProfile } from "@/lib/session"
import { parseJsonField } from "@/lib/utils"
import type {
  FullProfile,
  RoleActivityKindType,
  CompetencyOriginType,
} from "@/app/types/profile"

// Loads the signed-in user's whole profile context store as domain types:
// JSON `tags` columns are parsed; String enum columns are narrowed.
export const getFullProfile = cache(async (): Promise<FullProfile> => {
  const { profile } = await requireProfile()

  const row = await prisma.profile.findUniqueOrThrow({
    where: { id: profile.id },
    include: {
      experiences: {
        orderBy: { startDate: "desc" },
        include: { activities: { orderBy: ACTIVITY_ORDER } },
      },
      // Skills, tools and competencies, told apart by kind.
      skills: { orderBy: [{ order: "asc" }, { name: "asc" }] },
      educations: { orderBy: { startDate: "desc" } },
      certifications: { orderBy: { issueDate: "desc" } },
      languages: { orderBy: { order: "asc" } },
      projects: {
        orderBy: { startDate: "desc" },
        include: { activities: { orderBy: ACTIVITY_ORDER } },
      },
    },
  })

  const projectRoles = new Map(row.projects.map((p) => [p.id, p.experienceId] as const))
  const ofKind = (kind: string) => row.skills.filter((s) => s.kind === kind)
  const capabilityBase = (s: (typeof row.skills)[number]) => ({
    id: s.id, profileId: s.profileId, name: s.name, order: s.order, createdAt: s.createdAt, updatedAt: s.updatedAt,
  })

  return {
    ...row,
    experiences: row.experiences.map((exp) => ({
      ...exp,
      tags: parseJsonField<string[]>(exp.tags, []),
      // An activity labelled with a project is listed under that project, not twice.
      activities: roleOwnEvidence(exp.activities, projectRoles).map((act) => ({
        ...act,
        kind: act.kind as RoleActivityKindType,
        tags: parseJsonField<string[]>(act.tags, []),
      })),
    })),
    skills: ofKind("skill")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ ...s, tags: parseJsonField<string[]>(s.tags, []) })),
    educations: row.educations.map((e) => ({ ...e, tags: parseJsonField<string[]>(e.tags, []) })),
    certifications: row.certifications.map((c) => ({
      ...c,
      tags: parseJsonField<string[]>(c.tags, []),
    })),
    competencies: ofKind("competency").map((c) => ({
      ...capabilityBase(c),
      origin: (c.origin ?? "manual") as CompetencyOriginType,
    })),
    languages: row.languages,
    tools: ofKind("tool").map((t) => ({ ...capabilityBase(t), category: t.category })),
    projects: row.projects.map(p => ({
      ...p,
      highlights: parseJsonField<string[]>(p.highlights, []),
      tags: parseJsonField<string[]>(p.tags, []),
      activities: projectEvidenceOf(p.activities, p.experienceId).map((act) => ({
        ...act,
        kind: act.kind as RoleActivityKindType,
        tags: parseJsonField<string[]>(act.tags, []),
      })),
    })),
  }
})
