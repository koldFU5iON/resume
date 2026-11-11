"use server"

import { prisma } from "@/lib/db"
import { requireProfile } from "@/lib/session"
import { normalize } from "@/modules/profile/duplicate-detect"
import { revalidatePath } from "next/cache"
import { buildCommitPlan, certificationKey, educationKey, type ExistingProfileState, type SkippedItem } from "./plan"
import { ExtractedProfileSchema, type ExtractedProfile } from "./schema"
import { buildImportSummary } from "./summary-builder"

export type CommitResult = {
  created: { experiences: number; education: number; certifications: number; skills: number; contactFields: number }
  skipped: SkippedItem[]
}

export async function commitImportedProfile(payload: ExtractedProfile): Promise<CommitResult> {
  const { profile } = await requireProfile()
  // This is a directly callable server action: never trust the client copy of
  // the extraction. Re-parse it with the same schema the extractor used.
  const parsed = ExtractedProfileSchema.safeParse(payload)
  if (!parsed.success) throw new Error("Invalid import payload")
  const extracted = parsed.data

  const row = await prisma.profile.findUniqueOrThrow({
    where: { id: profile.id },
    select: {
      name: true, email: true, phone: true, location: true, website: true,
      linkedIn: true, github: true, headline: true, summary: true,
      experiences: { select: { company: true, role: true } },
      skills: { select: { name: true } },
      educations: { select: { institution: true, qualification: true } },
      certifications: { select: { name: true, issuer: true } },
    },
  })

  const existing: ExistingProfileState = {
    contact: {
      name: row.name ?? "", email: row.email ?? "", phone: row.phone ?? "",
      location: row.location ?? "", website: row.website ?? "", linkedIn: row.linkedIn ?? "",
      github: row.github ?? "", headline: row.headline ?? "",
    },
    summary: row.summary ?? "",
    experienceKeys: new Set(row.experiences.map((e) => `${normalize(e.company)}|${normalize(e.role)}`)),
    skillKeys: new Set(row.skills.map((s) => normalize(s.name))),
    educationKeys: new Set(row.educations.map((e) => educationKey(e.institution, e.qualification))),
    certificationKeys: new Set(row.certifications.map((c) => certificationKey(c.name, c.issuer))),
  }

  const plan = buildCommitPlan(extracted, existing)

  await prisma.$transaction([
    prisma.profile.update({ where: { id: profile.id }, data: plan.contactUpdate }),
    ...plan.experiences.map((e) =>
      prisma.experience.create({
        data: {
          profileId: profile.id,
          company: e.company,
          role: e.role,
          startDate: e.startDate,
          endDate: e.endDate ?? undefined,
          location: e.location ?? undefined,
          remote: e.remote,
          summary: e.summary || buildImportSummary({ activities: e.activities }),
          tags: "[]",
          activities: {
            create: e.activities.map((a, i) => ({
              kind: a.kind,
              description: a.description,
              impact: a.impact ?? undefined,
              tags: "[]",
              order: i,
            })),
          },
        },
      }),
    ),
    ...plan.education.map((ed) =>
      prisma.education.create({
        data: {
          profileId: profile.id,
          institution: ed.institution,
          qualification: ed.qualification,
          field: ed.field ?? undefined,
          startDate: ed.startDate,
          endDate: ed.endDate ?? undefined,
          tags: "[]",
        },
      }),
    ),
    ...plan.certifications.map((c) =>
      prisma.certification.create({
        data: {
          profileId: profile.id,
          name: c.name,
          issuer: c.issuer ?? undefined,
          issueDate: c.issueDate ?? undefined,
          tags: "[]",
        },
      }),
    ),
    ...plan.skills.map((s) =>
      prisma.skill.create({
        data: { profileId: profile.id, name: s.name, category: s.category, level: s.level, tags: "[]" },
      }),
    ),
  ])

  revalidatePath("/dashboard/profile")

  return {
    created: {
      experiences: plan.experiences.length,
      education: plan.education.length,
      certifications: plan.certifications.length,
      skills: plan.skills.length,
      contactFields: Object.keys(plan.contactUpdate).length,
    },
    skipped: plan.skipped,
  }
}
