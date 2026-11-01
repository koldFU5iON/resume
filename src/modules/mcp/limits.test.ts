import { describe, expect, it } from "vitest"
import { capText, MAX_TOOL_RESPONSE_CHARS } from "./limits"

describe("capText", () => {
  it("uses a 60,000 character default cap", () => {
    expect(MAX_TOOL_RESPONSE_CHARS).toBe(60_000)
  })

  it("returns text under the cap unchanged", () => {
    expect(capText("hello", 10)).toBe("hello")
  })

  it("returns text exactly at the cap unchanged", () => {
    expect(capText("a".repeat(10), 10)).toBe("a".repeat(10))
  })

  it("cuts text over the cap and appends a marker naming the omitted count", () => {
    expect(capText("a".repeat(15), 10)).toBe(
      "a".repeat(10) + "\n[truncated: 5 characters omitted]",
    )
  })

  it("applies MAX_TOOL_RESPONSE_CHARS when no max is given", () => {
    const result = capText("x".repeat(MAX_TOOL_RESPONSE_CHARS + 7))
    expect(result.startsWith("x".repeat(MAX_TOOL_RESPONSE_CHARS) + "\n")).toBe(true)
    expect(result.endsWith("\n[truncated: 7 characters omitted]")).toBe(true)
  })
})
