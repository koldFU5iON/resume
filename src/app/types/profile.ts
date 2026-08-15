import type {
  Profile as ProfileRow,
  Experience as ExperienceRow,
  RoleActivity as RoleActivityRow,
  Skill as SkillRow,
  Education as EducationRow,
  Certification as CertificationRow,
  Competency as CompetencyRow,
  Language as LanguageRow,
  Tool as ToolRow,
  Project as ProjectRow,
} from "@prisma/client"

// --- enums: String column + const, matching the ApplicationStatus pattern ---

export const RoleActivityKind = {
  Responsibility: "responsibility",
  Achievement: "achievement",
} as const
export type RoleActivityKindType = typeof RoleActivityKind[keyof typeof RoleActivityKind]

export const CompetencyOrigin = {
  Manual: "manual",
  Derived: "derived",
} as const
export type CompetencyOriginType = typeof CompetencyOrigin[keyof typeof CompetencyOrigin]

// --- domain types: narrow the String/JSON columns to real types ---

export type RoleActivity = Omit<RoleActivityRow, "kind" | "tags"> & {
  kind: RoleActivityKindType
  tags: string[]
}
export type Competency = Omit<CompetencyRow, "origin"> & { origin: CompetencyOriginType }
export type Language = LanguageRow
export type Experience = Omit<ExperienceRow, "tags"> & { tags: string[] }
export type Skill = Omit<SkillRow, "tags"> & { tags: string[] }
export type Education = Omit<EducationRow, "tags"> & { tags: string[] }
export type Certification = Omit<CertificationRow, "tags"> & { tags: string[] }
export type Profile = ProfileRow
export type Tool = ToolRow
export type Project = Omit<ProjectRow, "highlights" | "tags"> & {
  highlights: string[]
  tags: string[]
}

// --- composites: the loaded shapes the UI consumes ---

export type ExperienceWithActivities = Experience & { activities: RoleActivity[] }

export type FullProfile = Profile & {
  experiences: ExperienceWithActivities[]
  skills: Skill[]
  educations: Education[]
  certifications: Certification[]
  competencies: Competency[]
  languages: Language[]
  tools: Tool[]
  projects: Project[]
}
