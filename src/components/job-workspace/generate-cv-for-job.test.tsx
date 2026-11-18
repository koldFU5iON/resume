import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@/modules/writing-desk/draft-actions", () => ({ discardDraftAction: vi.fn() }))

import { GenerateCvForJob } from "./generate-cv-for-job"

describe("GenerateCvForJob (writing desk entry point)", () => {
  it("offers 'Generate CV for this job' and the Fresh option, unchecked by default", () => {
    const html = renderToStaticMarkup(<GenerateCvForJob jobId="job1" hasCvGeneration={false} />)
    expect(html).toContain("Generate CV for this job")
    expect(html).toContain("Fresh (re-select evidence)")
    expect(html).not.toMatch(/checked/)
    expect(html).not.toContain("View last generation")
  })

  it("adds 'View last generation' (to the progress page) when a run exists", () => {
    const html = renderToStaticMarkup(<GenerateCvForJob jobId="job1" hasCvGeneration />)
    expect(html).toContain("View last generation")
    expect(html).toContain('href="/dashboard/job-applications/view/job1/cv-generation"')
  })
})
