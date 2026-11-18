import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { buildStageRows } from "@/app/dashboard/job-applications/_components/cv-generation-view"
import { StageLogEntrySchema, parseAssembled } from "@/modules/cv-generation/schema"
import { GenerationLog } from "./generation-log"
import { ConcernsPanel } from "./concerns-panel"
import { concernRows } from "@/app/dashboard/job-applications/_components/cv-generation-view"

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

describe("ConcernsPanel (phase 4a)", () => {
  const html = renderToStaticMarkup(
    <ConcernsPanel concerns={concernRows({ concerns: [
      { kind: "metric_conflict", title: "Two figures", why: "They differ.", question: "Which is right?", refs: [{ label: "S1", snippet: "Cut asset collection from 4 weeks to 1 week" }] },
      { kind: "claimed_in_bullet", title: "Tableau in a bullet", why: "Listed without evidence.", question: "Have you used it?", refs: [] },
    ] })} job={{ title: "Senior PMM", company: "Canonical" }} />,
  )

  it("shows each concern as a kind badge, a title, why and the question, under a heading that counts them", () => {
    expect(html).toContain("2 concerns to discuss with the coach")
    expect(html).toContain("Conflicting figures")
    expect(html).toContain("Unevidenced tool in a bullet")
    expect(html).toContain("Two figures")
    expect(html).toContain("They differ.")
    expect(html).toContain("Which is right?")
    expect(html).toContain("Cut asset collection from 4 weeks to 1 week")
  })

  it("says the draft does not wait on them (it is never a gate)", () => {
    expect(html).toContain("does not wait on them")
  })

  it("is singular for one concern", () => {
    const one = renderToStaticMarkup(<ConcernsPanel concerns={concernRows({ concerns: [{ kind: "other", title: "T", why: "", question: "Q?", refs: [] }] })} job={{ title: "T" }} />)
    expect(one).toContain("1 concern to discuss")
  })
})

describe("ConcernsPanel (phase 4b): a previewable panel with a coach handoff", () => {
  const concerns = concernRows({ concerns: [
    { kind: "metric_conflict", title: "Two figures", why: "They differ.", question: "Which is right?", refs: [{ label: "S1", snippet: "4 weeks to 1 week" }] },
    { kind: "weak_proof", title: "Thin proof for launch", why: "Title only.", question: "What was the result?", refs: [] },
  ] })
  const html = renderToStaticMarkup(<ConcernsPanel concerns={concerns} job={{ title: "Senior PMM", company: "Canonical" }} />)

  it("is collapsed by default (a details element without open) and previews the count and every title", () => {
    expect(html).toMatch(/<details(?![^>]*\sopen)/)
    const summary = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"))
    expect(summary).toContain("2 concerns to discuss with the coach")
    expect(summary).toContain("Two figures")
    expect(summary).toContain("Thin proof for launch")
    expect(summary).not.toContain("Which is right?")
  })

  it("expands to kind, why, the question and evidence snippets", () => {
    const body = html.slice(html.indexOf("</summary>"))
    for (const t of ["Conflicting figures", "They differ.", "Which is right?", "4 weeks to 1 week", "What was the result?"]) expect(body).toContain(t)
  })

  it("has a Discuss with coach button per concern and one for all, and says the draft does not wait", () => {
    expect(html.match(/Discuss with coach/g)).toHaveLength(2)
    expect(html).toContain("Discuss all with coach")
    expect(html).toContain("the draft does not wait on them")
  })
})
