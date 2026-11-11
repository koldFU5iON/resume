import { expect, test } from "vitest"
import { buildCommitPlan, type ExistingProfileState } from "./plan"
import { emptyExtractedProfile, type ExtractedProfile } from "./schema"

const emptyExisting: ExistingProfileState = {
  contact: { name: "", email: "", phone: "", location: "", website: "", linkedIn: "", github: "", headline: "" },
  summary: "",
  experienceKeys: new Set(),
  skillKeys: new Set(),
  educationKeys: new Set(),
  certificationKeys: new Set(),
}

function withExperience(over: Partial<ExtractedProfile["experiences"][number]> = {}): ExtractedProfile {
  return {
    ...emptyExtractedProfile,
    experiences: [{
      company: "Unity", role: "Snr Program Manager", startDate: "2024-07",
      location: "France", remote: false, summary: "intro",
      activities: [{ kind: "responsibility", description: "Lead delivery" }],
      ...over,
    }],
  }
}

test("fills only empty contact fields, never clobbers", () => {
  const extracted: ExtractedProfile = {
    ...emptyExtractedProfile,
    contact: { ...emptyExtractedProfile.contact, name: "Devon", email: "new@x.com", location: "Paris" },
  }
  const existing: ExistingProfileState = {
    ...emptyExisting,
    contact: { ...emptyExisting.contact, name: "Devon Stanton", email: "" },
  }
  const plan = buildCommitPlan(extracted, existing)
  expect(plan.contactUpdate.email).toBe("new@x.com")
  expect(plan.contactUpdate.location).toBe("Paris")
  expect(plan.contactUpdate.name).toBeUndefined() // already set — not overwritten
})

test("fills summary only when existing summary is empty", () => {
  const extracted: ExtractedProfile = { ...emptyExtractedProfile, summary: "New summary" }
  expect(buildCommitPlan(extracted, emptyExisting).contactUpdate.summary).toBe("New summary")
  const existing: ExistingProfileState = { ...emptyExisting, summary: "Existing" }
  expect(buildCommitPlan(extracted, existing).contactUpdate.summary).toBeUndefined()
})

test("converts experience dates and includes a valid experience", () => {
  const plan = buildCommitPlan(withExperience(), emptyExisting)
  expect(plan.experiences).toHaveLength(1)
  expect(plan.experiences[0].startDate.toISOString()).toBe("2024-07-01T00:00:00.000Z")
  expect(plan.experiences[0].endDate).toBeNull()
})

test("skips an experience that duplicates an existing company+role", () => {
  const existing: ExistingProfileState = { ...emptyExisting, experienceKeys: new Set(["unity|snr program manager"]) }
  const plan = buildCommitPlan(withExperience(), existing)
  expect(plan.experiences).toHaveLength(0)
  expect(plan.skipped).toContainEqual({ type: "experience", label: "Snr Program Manager — Unity", reason: "duplicate" })
})

test("skips an experience with no parseable start date", () => {
  const plan = buildCommitPlan(withExperience({ startDate: undefined }), emptyExisting)
  expect(plan.experiences).toHaveLength(0)
  expect(plan.skipped[0].reason).toBe("missing start date")
})

test("certifications keep optional issuer/date; skills get defaults", () => {
  const extracted: ExtractedProfile = {
    ...emptyExtractedProfile,
    certifications: [{ name: "Learn SQL Course" }],
    skills: [{ name: "AI Fluency" }],
  }
  const plan = buildCommitPlan(extracted, emptyExisting)
  expect(plan.certifications[0]).toEqual({ name: "Learn SQL Course", issuer: null, issueDate: null })
  expect(plan.skills[0]).toEqual({ name: "AI Fluency", category: "General", level: "intermediate" })
})

test("dedups skills against existing by normalized name", () => {
  const extracted: ExtractedProfile = { ...emptyExtractedProfile, skills: [{ name: "AI Fluency" }] }
  const existing: ExistingProfileState = { ...emptyExisting, skillKeys: new Set(["ai fluency"]) }
  const plan = buildCommitPlan(extracted, existing)
  expect(plan.skills).toHaveLength(0)
})

test("dedups education against existing and within the import", () => {
  const ed = { institution: "UCT", qualification: "BCom", startDate: "2005" }
  const extracted: ExtractedProfile = {
    ...emptyExtractedProfile,
    education: [ed, { ...ed, institution: "uct " }, { institution: "Wits", qualification: "BA", startDate: "2001" }],
  }
  const existing: ExistingProfileState = { ...emptyExisting, educationKeys: new Set(["wits|ba"]) }
  const plan = buildCommitPlan(extracted, existing)
  expect(plan.education.map((e) => e.institution)).toEqual(["UCT"])
  expect(plan.skipped.filter((s) => s.reason === "duplicate")).toHaveLength(2)
})

test("dedups certifications by name and issuer", () => {
  const extracted: ExtractedProfile = {
    ...emptyExtractedProfile,
    certifications: [
      { name: "PMP", issuer: "PMI" },
      { name: "pmp", issuer: "pmi" },
      { name: "PMP", issuer: "Other Body" },
      { name: "Scrum Master" },
    ],
  }
  const existing: ExistingProfileState = { ...emptyExisting, certificationKeys: new Set(["scrum master|"]) }
  const plan = buildCommitPlan(extracted, existing)
  expect(plan.certifications.map((c) => `${c.name}/${c.issuer}`)).toEqual(["PMP/PMI", "PMP/Other Body"])
  expect(plan.skipped.map((s) => s.type)).toEqual(["certification", "certification"])
})
