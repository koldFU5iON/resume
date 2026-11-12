import { describe, expect, it } from "vitest"
import { canOfferMarkApplied, jobApplyHref } from "./apply"

describe("jobApplyHref", () => {
  it("keeps http(s) links", () => {
    expect(jobApplyHref("https://jobs.example.com/123?ref=x")).toBe("https://jobs.example.com/123?ref=x")
    expect(jobApplyHref(" http://example.com/job ")).toBe("http://example.com/job")
  })

  it("adds https to a bare host", () => {
    expect(jobApplyHref("example.com/careers/42")).toBe("https://example.com/careers/42")
    expect(jobApplyHref("jobs.example.com:8080/x")).toBe("https://jobs.example.com:8080/x")
  })

  it("returns null when there is no usable link", () => {
    expect(jobApplyHref(null)).toBeNull()
    expect(jobApplyHref(undefined)).toBeNull()
    expect(jobApplyHref("   ")).toBeNull()
    expect(jobApplyHref("not a url")).toBeNull()
    expect(jobApplyHref("localhost")).toBeNull()
  })

  it("refuses non-web schemes", () => {
    expect(jobApplyHref("javascript:alert(1)")).toBeNull()
    expect(jobApplyHref("JavaScript:alert(1)")).toBeNull()
    expect(jobApplyHref("mailto:jobs@example.com")).toBeNull()
    expect(jobApplyHref("data:text/html,hi")).toBeNull()
  })
})

describe("canOfferMarkApplied", () => {
  it("offers it before the job is applied", () => {
    expect(canOfferMarkApplied("not started")).toBe(true)
    expect(canOfferMarkApplied("in-progress")).toBe(true)
  })

  it("never offers it once applied, later, or closed", () => {
    expect(canOfferMarkApplied("applied")).toBe(false)
    expect(canOfferMarkApplied("interviewing")).toBe(false)
    expect(canOfferMarkApplied("accepted")).toBe(false)
    expect(canOfferMarkApplied("rejected")).toBe(false)
  })
})
