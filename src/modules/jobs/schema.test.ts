import { describe, it, expect } from "vitest"
import { JobFitSchema, SalaryEstimateSchema } from "./schema"

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
    const { reasoning, ...noReasoning } = estimated
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
