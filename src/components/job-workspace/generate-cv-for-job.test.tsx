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

  it("hints at profile readiness only when there are fix findings, linking to the panel", () => {
    expect(renderToStaticMarkup(<GenerateCvForJob jobId="job1" hasCvGeneration={false} />)).not.toContain("limit the CV")
    const html = renderToStaticMarkup(<GenerateCvForJob jobId="job1" hasCvGeneration={false} readinessFixCount={3} />)
    expect(html).toContain("3 things in your profile limit the CV.")
    expect(html).toContain('href="/dashboard/job-applications/view/job1/cv-generation#profile-readiness"')
    expect(renderToStaticMarkup(<GenerateCvForJob jobId="job1" hasCvGeneration={false} readinessFixCount={1} />)).toContain("1 thing in your profile limits the CV.")
  })

  it("adds 'View last generation' (to the progress page) when a run exists", () => {
    const html = renderToStaticMarkup(<GenerateCvForJob jobId="job1" hasCvGeneration />)
    expect(html).toContain("View last generation")
    expect(html).toContain('href="/dashboard/job-applications/view/job1/cv-generation"')
  })

  it("closes whatever hosts it (onStarted) before navigating, and guards against a double start", async () => {
    const { readFileSync } = await import("node:fs")
    const src = readFileSync("src/components/job-workspace/generate-cv-for-job.tsx", "utf8")
    expect(src).toContain("onStarted")
    expect(src).toContain("useRef")
    expect(src.indexOf("onStarted?.()")).toBeLessThan(src.indexOf("router.push(jobCvGenerationHref"))
    const dialog = readFileSync("src/components/job-workspace/new-document-dialog.tsx", "utf8")
    expect(dialog).toMatch(/onStarted=\{\(\) => onOpenChange\(false\)\}/)
  })

  it("offers the job's writing desk when a 409 carries no document id", async () => {
    const { readFileSync } = await import("node:fs")
    for (const f of ["src/components/job-workspace/generate-cv-for-job.tsx", "src/app/dashboard/job-applications/view/[id]/cv-generation/_components/generate-cv-button.tsx"]) {
      expect(readFileSync(f, "utf8"), f).toContain("jobWritingDeskHref")
    }
  })
})
