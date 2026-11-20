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
      type: true,
      location: true,
      remote: true,
      startDate: true,
      endDate: true,
      summary: true,
      revision: true,
      activities: {
        select: { id: true, description: true, kind: true, projectId: true, experienceId: true },
        orderBy: ACTIVITY_ORDER,
      },
    },
  })
  if (!experience) return null

  // Only the role's own evidence is offered for matching and replacing: an activity labelled with a project is
  // that project's, and a suggestion from the role's note must not overwrite it.
  const projects = await prisma.project.findMany({ where: { profileId }, select: { id: true, experienceId: true } })
  const projectRoles = new Map(projects.map((p) => [p.id, p.experienceId] as const))
  const own = roleOwnEvidence(experience.activities, projectRoles).map(({ id, description, kind }) => ({ id, description, kind }))

  const skills = await prisma.skill.findMany({
    where: { profileId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  return { experience: { ...experience, activities: own }, skills }
}

// Same, for a project: its description and notes, its role (for context) and
// its own evidence.
export async function getProjectWithSuggestionContext(projectId: string, profileId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, profileId },
    select: {
      id: true,
      name: true,
      description: true,
      notes: true,
      experienceId: true,
      experience: { select: { role: true, company: true, type: true } },
      activities: {
        select: { id: true, description: true, kind: true, experienceId: true },
        orderBy: ACTIVITY_ORDER,
      },
    },
  })
  if (!project) return null
  // The project's own evidence: not another role's evidence that happens to carry its label.
  const own = projectEvidenceOf(project.activities, project.experienceId).map(({ id, description, kind }) => ({ id, description, kind }))

  const skills = await prisma.skill.findMany({
    where: { profileId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  return { project: { ...project, activities: own }, skills }
}

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
