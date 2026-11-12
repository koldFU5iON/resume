import { describe, expect, it } from "vitest"
import { interceptableHref } from "./navigation-guard"

const location = {
  href: "https://app.test/dashboard/job-applications/view/job1/writing/deskA",
  origin: "https://app.test",
  pathname: "/dashboard/job-applications/view/job1/writing/deskA",
  search: "",
}
const click = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }

function anchor(attrs: Record<string, string>) {
  return {
    getAttribute: (name: string) => attrs[name] ?? null,
    hasAttribute: (name: string) => name in attrs,
  }
}

describe("interceptableHref", () => {
  it("holds a plain click to another page of the app", () => {
    expect(interceptableHref(anchor({ href: "/dashboard/job-applications/view/job1/writing/deskB" }), click, location))
      .toBe("/dashboard/job-applications/view/job1/writing/deskB")
    expect(interceptableHref(anchor({ href: "https://app.test/dashboard?x=1#top" }), click, location)).toBe("/dashboard?x=1#top")
  })

  it("lets new-tab, modified, external, download and in-page clicks through", () => {
    const other = "/dashboard"
    expect(interceptableHref(anchor({ href: other, target: "_blank" }), click, location)).toBeNull()
    expect(interceptableHref(anchor({ href: other, download: "" }), click, location)).toBeNull()
    expect(interceptableHref(anchor({ href: other }), { ...click, metaKey: true }, location)).toBeNull()
    expect(interceptableHref(anchor({ href: other }), { ...click, ctrlKey: true }, location)).toBeNull()
    expect(interceptableHref(anchor({ href: other }), { ...click, button: 1 }, location)).toBeNull()
    expect(interceptableHref(anchor({ href: other }), { ...click, defaultPrevented: true }, location)).toBeNull()
    expect(interceptableHref(anchor({ href: "https://example.com/" }), click, location)).toBeNull()
    expect(interceptableHref(anchor({ href: "#section" }), click, location)).toBeNull()
    expect(interceptableHref(anchor({ href: location.pathname }), click, location)).toBeNull()
  })
})
