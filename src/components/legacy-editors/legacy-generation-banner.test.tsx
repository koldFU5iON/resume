import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { renderToStaticMarkup } from "react-dom/server"

const createCoverLetter = vi.fn()
const createAndGenerateCV = vi.fn()
vi.mock("@/modules/cover-letters/actions", () => ({ createCoverLetter }))
vi.mock("@/modules/cv/actions", () => ({ createAndGenerateCV }))
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams("jobId=job1"),
}))

describe("retired generation pages spend nothing until the click", () => {
  it("cover letter page: shows the banner and creates nothing on load", async () => {
    const { default: Page } = await import("@/app/dashboard/cover-letters/new/page")
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ jobId: "job1" }) }))
    expect(html).toContain("being retired")
    expect(html).toContain("/dashboard/job-applications/view/job1/writing")
    expect(createCoverLetter).not.toHaveBeenCalled()
  })

  it("CV page: shows the banner and does not generate on load; the call sits behind `started`", async () => {
    const { default: Page } = await import("@/app/dashboard/cv-builder/new/page")
    const html = renderToStaticMarkup(<Page />)
    expect(html).toContain("being retired")
    expect(createAndGenerateCV).not.toHaveBeenCalled()
    const src = readFileSync("src/app/dashboard/cv-builder/new/page.tsx", "utf8")
    expect(src.indexOf("if (!started) return")).toBeGreaterThan(-1)
    expect(src.indexOf("if (!started) return")).toBeLessThan(src.indexOf("createAndGenerateCV({"))
  })
})
