import { describe, expect, it } from "vitest"
import { matchSourceLabel, sourceOptionValue } from "./source-search"

const vercel = sourceOptionValue("Senior PM — Vercel", "cv_linear123")
const linear = sourceOptionValue("Product Lead — Linear", "cv_vercel456")

describe("matchSourceLabel", () => {
  it("needs every word, in any order, ignoring case", () => {
    expect(matchSourceLabel(vercel, "vercel senior")).toBe(1)
    expect(matchSourceLabel(vercel, "VERCEL")).toBe(1)
    expect(matchSourceLabel(vercel, "vercel lead")).toBe(0)
  })
  it("doesn't match unrelated CVs or text only in the id", () => {
    expect(matchSourceLabel(linear, "vercel")).toBe(0)
    expect(matchSourceLabel(vercel, "linear123")).toBe(0)
  })
  it("matches everything for an empty or blank search", () => {
    expect(matchSourceLabel(linear, "")).toBe(1)
    expect(matchSourceLabel(linear, "   ")).toBe(1)
  })
})
