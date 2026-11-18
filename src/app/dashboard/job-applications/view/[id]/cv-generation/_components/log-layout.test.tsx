import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@/modules/writing-desk/draft-actions", () => ({ discardDraftAction: vi.fn() }))

import { buildStageRows, concernRows, logSectionIds } from "@/app/dashboard/job-applications/_components/cv-generation-view"
import { StageLogEntrySchema } from "@/modules/cv-generation/schema"
import { GenerationLog } from "./generation-log"
import { ConcernsPanel } from "./concerns-panel"
import { ExpandAllButton, LogSection, LogSectionsProvider } from "./log-sections"
import { RunPanel } from "./run-panel"

const write = StageLogEntrySchema.parse({ stage: "write", model: "m", notes: ["a note"] })
const rows = buildStageRows({ status: "complete", log: [write], stageTimings: {} })
const concerns = concernRows({
  concerns: [{ kind: "gap", title: "Missing metric", why: "w", question: "q?", refs: [] }],
} as never)

function page(status: "writing" | "complete", ids: string[]) {
  return renderToStaticMarkup(
    <LogSectionsProvider status={status} ids={ids}>
      <ExpandAllButton />
      <LogSection id="brief" level={2} title="Brief"><p>brief body</p></LogSection>
      <LogSection id="assembled" level={2} title="Assembled CV"><p>cv body</p></LogSection>
      <GenerationLog rows={rows} />
    </LogSectionsProvider>,
  )
}

describe("collapsible log sections", () => {
  it("collapses everything while a run is active, but keeps the content in the DOM", () => {
    const html = page("writing", ["brief", "assembled", "stage:write"])
    expect(html).not.toMatch(/aria-expanded="true"/)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain("brief body")
    expect(html).toMatch(/<h2[^>]*><button[^>]*aria-controls="log-section-brief"/)
    expect(html).toContain("Expand all")
  })

  it("opens Assembled CV (not Brief) on a finished run and offers Collapse all only when all are open", () => {
    const html = page("complete", ["brief", "assembled"])
    expect(html).toMatch(/aria-expanded="true"[^>]*aria-controls="log-section-assembled"/)
    expect(html).toMatch(/aria-expanded="false"[^>]*aria-controls="log-section-brief"/)
    expect(html).toContain("Expand all")
  })

  it("keeps the Concerns heading, titles and 'Discuss all' visible, with the questions in the collapsible body", () => {
    const html = renderToStaticMarkup(
      <LogSectionsProvider status="complete" ids={["concerns"]}>
        <ConcernsPanel concerns={[...concerns, ...concerns]} job={{ title: "t" }} />
      </LogSectionsProvider>,
    )
    expect(html).toContain("2 concerns to discuss with the coach")
    expect(html).toContain("Discuss all with coach")
    expect(html).toMatch(/aria-expanded="true"/)
    expect(html).not.toContain("<details")
  })

  it("lists a section id per row with detail", () => {
    const ids = logSectionIds({ rows, hasConcerns: true, hasAssembled: true, hasBrief: true, hasSelection: false })
    expect(ids).toEqual(["concerns", "assembled", "brief", "stage:write"])
  })
})

describe("RunPanel controls", () => {
  const view = {
    status: "complete", createdAt: new Date("2026-11-18T10:00:00Z"),
    usage: { total: { requests: 3, inputTokens: 10, outputTokens: 5, failedRequests: 0, estimatedCostUsd: 0.5, estimateComplete: true } },
    log: [], stageTimings: {}, partial: false, brief: null, selection: null, assembled: null, review: null,
  } as never

  it("puts Generate again, the fresh variant and Copy log in the column after the facts", () => {
    const html = renderToStaticMarkup(<RunPanel view={view} jobId="j1" jobTitle="T" company="C" />)
    const facts = html.indexOf("Cost (estimate)")
    expect(facts).toBeGreaterThan(-1)
    for (const label of ["Generate again<", "Generate again with a fresh brief and selection", "Copy log"]) {
      expect(html.indexOf(label), label).toBeGreaterThan(facts)
    }
  })

  it("offers no generate button while a run is active, but still Copy log", () => {
    const html = renderToStaticMarkup(<RunPanel view={{ ...(view as object), status: "writing" } as never} jobId="j1" jobTitle="T" company="C" />)
    expect(html).not.toContain("Generate again")
    expect(html).toContain("Copy log")
  })

  it("keeps the POST body, 409 choice, double-click guard and writing-desk fallback in the button", async () => {
    const { readFileSync } = await import("node:fs")
    const src = readFileSync("src/app/dashboard/job-applications/view/[id]/cv-generation/_components/generate-cv-button.tsx", "utf8")
    expect(src).toContain("requestCvGeneration(jobId, { fresh })")
    expect(src).toContain("inFlight")
    expect(src).toContain("Open draft")
    expect(src).toContain("Discard draft and generate")
    expect(src).toContain("jobWritingDeskHref")
    expect(src).toContain("notifyAssessmentStarted")
  })
})
