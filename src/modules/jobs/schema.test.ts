import { describe, it, expect } from "vitest"
import { JobFitSchema, SalaryEstimateSchema, createJobSchema, updateJobSchema } from "./schema"

const base = { rating: 7, justification: "Strong match." }

describe("JobFitSchema label", () => {
  it.each(["reach", "possible", "stretch", "solid", "standout"])(
    "accepts '%s'",
    (label) => {
      expect(JobFitSchema.safeParse({ ...base, label }).success).toBe(true)
    },
  )

  it.each(["unlikely", "weak", "good", "excellent", "poor", "ok"])(
    "rejects old/invalid label '%s'",
    (label) => {
      expect(JobFitSchema.safeParse({ ...base, label }).success).toBe(false)
    },
  )
})

describe("SalaryEstimateSchema", () => {
  const extracted = {
    min: 70000,
    max: 90000,
    currency: "GBP",
    source: "extracted",
  }

  const estimated = {
    min: 60000,
    max: 80000,
    currency: "USD",
    source: "estimated",
    confidence: "medium",
    reasoning: "Based on the seniority level and London market rates.",
  }

  it("accepts a fully stated extracted range", () => {
    expect(SalaryEstimateSchema.safeParse(extracted).success).toBe(true)
  })

  it("accepts null min (only ceiling stated)", () => {
    expect(
      SalaryEstimateSchema.safeParse({ ...extracted, min: null }).success
    ).toBe(true)
  })

  it("accepts null max (only floor stated)", () => {
    expect(
      SalaryEstimateSchema.safeParse({ ...extracted, max: null }).success
    ).toBe(true)
  })

  it("accepts a full estimated range with reasoning", () => {
    expect(SalaryEstimateSchema.safeParse(estimated).success).toBe(true)
  })

  it("accepts estimated without reasoning (optional)", () => {
    const { reasoning: _reasoning, ...noReasoning } = estimated
    expect(SalaryEstimateSchema.safeParse(noReasoning).success).toBe(true)
  })

  it("rejects unknown source values", () => {
    expect(
      SalaryEstimateSchema.safeParse({ ...extracted, source: "guessed" }).success
    ).toBe(false)
  })

  it("rejects unknown confidence values", () => {
    expect(
      SalaryEstimateSchema.safeParse({ ...estimated, confidence: "very-high" }).success
    ).toBe(false)
  })
})

describe("createJobSchema", () => {
  const ok = { title: "PM", company: "Acme", applicationSource: "cold" as const }
  const issues = (input: unknown) =>
    createJobSchema.safeParse(input).error?.issues.map(i => i.path.join(".")) ?? []

  it("rejects a whitespace-only title", () => {
    expect(issues({ ...ok, title: "   " })).toEqual(["title"])
  })

  it("trims text fields but not the description", () => {
    const res = createJobSchema.parse({
      ...ok, title: " PM ", company: " Acme ", url: " https://x.com/j ", location: " UK ",
      jobNumber: " J1 ", salaryBand: " £1 ", recruiterName: " Hays ", jobDescription: "  JD  ",
    })
    expect(res).toMatchObject({
      title: "PM", company: "Acme", url: "https://x.com/j", location: "UK",
      jobNumber: "J1", salaryBand: "£1", recruiterName: "Hays", jobDescription: "  JD  ",
    })
  })

  it("requires company unless via an agency, on the company field", () => {
    expect(issues({ ...ok, company: "  " })).toEqual(["company"])
    expect(issues({ ...ok, company: undefined, isRecruitmentAgency: true })).toEqual([])
  })

  it("reports the company and title errors together", () => {
    expect(issues({ ...ok, title: "", company: "" }).sort()).toEqual(["company", "title"])
  })

  it.each(["", "http://intranet/jobs/1", "https://boards.greenhouse.io/x/jobs/1"])(
    "accepts URL %j",
    (url) => { expect(issues({ ...ok, url })).toEqual([]) },
  )

  it.each(["javascript:alert(1)", "data:text/html,hi", "ftp://x.com", "not a url", "//x.com"])(
    "rejects URL %j",
    (url) => { expect(issues({ ...ok, url })).toEqual(["url"]) },
  )
})

describe("updateJobSchema", () => {
  it("accepts an empty or single-field patch", () => {
    expect(updateJobSchema.safeParse({}).success).toBe(true)
    expect(updateJobSchema.safeParse({ salaryBand: "£1" }).success).toBe(true)
  })

  it("keeps the URL scheme rule, so a legacy URL must be fixed or cleared", () => {
    expect(updateJobSchema.safeParse({ url: "javascript:alert(1)" }).success).toBe(false)
    expect(updateJobSchema.safeParse({ url: "" }).success).toBe(true)
  })

  it("does not require company", () => {
    expect(updateJobSchema.safeParse({ company: "" }).success).toBe(true)
  })
})
