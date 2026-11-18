import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { buildStageRows } from "@/app/dashboard/job-applications/_components/cv-generation-view"
import { StageLogEntrySchema, parseAssembled } from "@/modules/cv-generation/schema"
import { GenerationLog } from "./generation-log"

const write = StageLogEntrySchema.parse({
  stage: "write",
  sections: [
    { id: "experience:unity", label: "Experience: Snr. Program Manager — Unity", notes: ["Bullet combines figures from 2 activities: A / B"] },
    { id: "earlier-experience", label: "Earlier experience", notes: ["1 employer listed without bullets."] },
  ],
})
const rows = buildStageRows({ status: "complete", log: [write], stageTimings: {} })
const assembled = parseAssembled({
  markdown: "# x",
  sections: [{
    id: "experience:unity", kind: "experience", markdown: "m",
    bullets: [
      { text: "Cut asset collection from 4 weeks to 1 week.", sources: [{ id: "a1", kind: "activity", snippet: "Cut asset collection from 4 weeks to 1 week for the Unity Awards" }] },
      { text: "Kept the release calendar.", sources: [] },
    ],
  }],
})

describe("GenerationLog: where each bullet came from", () => {
  const html = renderToStaticMarkup(<GenerationLog rows={rows} assembled={assembled} />)

  it("shows a collapsible 'Where each bullet came from' under the experience row, with each bullet and its source", () => {
    expect(html).toContain("<details")
    expect(html).toContain("Where each bullet came from")
    expect(html).toContain("Cut asset collection from 4 weeks to 1 week.")
    expect(html).toContain("from: Cut asset collection from 4 weeks to 1 week for the Unity Awards (activity)")
    expect(html).toContain("from: no source cited")
  })

  it("shows the mixed-source note on the row, and the disclosure only under the experience row", () => {
    expect(html).toContain("Bullet combines figures from 2 activities: A / B")
    expect(html.match(/Where each bullet came from/g)).toHaveLength(1)
    expect(html.indexOf("Where each bullet came from")).toBeLessThan(html.indexOf("Earlier experience"))
  })

  it("renders a run stored before provenance with no disclosure", () => {
    const old = renderToStaticMarkup(<GenerationLog rows={rows} assembled={parseAssembled({ markdown: "# x", sections: [{ id: "experience:unity", kind: "experience", markdown: "m" }] })} />)
    expect(old).not.toContain("Where each bullet came from")
    expect(renderToStaticMarkup(<GenerationLog rows={rows} />)).not.toContain("Where each bullet came from")
  })
})
