import { describe, expect, it } from "vitest"
import { renderToBuffer } from "@react-pdf/renderer"
import { extractLinks, extractText, extractTextItems, getDocumentProxy } from "unpdf"
import { WritingDeskPDFDocument } from "./writing-desk-pdf-document"
import type { WritingDeskDocumentType } from "@/modules/writing-desk/schema"

const CV_MARKDOWN = [
  ":::header",
  "# Devon Stanton",
  "## Program Manager",
  "### Program & Operations Leader | Systems Thinker",
  "[devonstanton.com](https://devonstanton.com) | [linkedin.com/in/devonstanton](https://linkedin.com/in/devonstanton)",
  ":::",
  "",
  "## Professional Profile",
  "",
  "Program and operations leader with experience building delivery systems.",
  "",
  "## Core Competencies",
  "",
  ":::skills",
  "- Delivery leadership",
  "- Operating models",
  "- Stakeholder management",
  ":::",
  "",
  "## Professional Experience",
  "",
  "### Acme Ltd",
  "Program Manager · 2021 - Present",
  "",
  ":::compact-list",
  "- Led a cross-functional delivery programme",
  "- Improved operating rhythm across three teams",
  ":::",
].join("\n")

async function render(markdown: string, documentType: WritingDeskDocumentType) {
  const buffer = await renderToBuffer(<WritingDeskPDFDocument markdown={markdown} documentType={documentType} title="fixture" />)
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  return { pdf, buffer }
}

describe("WritingDeskPDFDocument", () => {
  it("renders the CV profile as extractable single-column text", async () => {
    const { pdf } = await render(CV_MARKDOWN, "cv")
    const { text, totalPages } = await extractText(pdf, { mergePages: true })

    expect(totalPages).toBeGreaterThanOrEqual(1)
    expect(text).toContain("Devon Stanton")
    expect(text).toContain("Program Manager")
    expect(text).toContain("Delivery leadership · Operating models · Stakeholder management")
    expect(text).toContain("•")
    expect(text).not.toContain(":::header")
    expect(text).not.toContain(":::skills")

    const normalized = text.toUpperCase()
    expect(normalized.indexOf("DEVON STANTON")).toBeLessThan(normalized.indexOf("PROFESSIONAL PROFILE"))
    expect(normalized.indexOf("PROFESSIONAL PROFILE")).toBeLessThan(normalized.indexOf("PROFESSIONAL EXPERIENCE"))
  })

  it("preserves links and avoids overlapping text", async () => {
    const { pdf } = await render(CV_MARKDOWN, "cv")
    const links = await extractLinks(pdf)
    expect(links.links.some(link => link.startsWith("https://devonstanton.com"))).toBe(true)

    const items = await extractTextItems(pdf)
    for (const page of items.items) {
      const positioned = page.filter(item => item.str.trim())
      for (let i = 0; i < positioned.length; i++) {
        for (let j = i + 1; j < positioned.length; j++) {
          const a = positioned[i]
          const b = positioned[j]
          const overlaps = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
          expect(overlaps).toBe(false)
        }
      }
    }
  })

  it("renders general documents without CV section assumptions", async () => {
    const markdown = "# Dear Hiring Manager\n\nI am writing to apply for the role.\n\n:::inline-list\n- React\n- TypeScript\n:::"
    const { pdf } = await render(markdown, "cover-letter")
    const { text } = await extractText(pdf, { mergePages: true })
    expect(text).toContain("Dear Hiring Manager")
    expect(text).toContain("React · TypeScript")
  })

  it("does not impose a two-page limit on long CVs", async () => {
    const sections = Array.from({ length: 16 }, (_, index) => [
      `### Employer ${index + 1}`,
      `Program Manager · 20${String(index).padStart(2, "0")} - 20${String(index + 1).padStart(2, "0")}`,
      "",
      "Delivered a complex programme across multiple teams.",
      "",
      ":::compact-list",
      "- Delivered measurable outcomes",
      "- Improved operating cadence",
      "- Mentored senior managers",
      ":::",
      "",
    ].join("\n")).join("\n")
    const { pdf } = await render(`${CV_MARKDOWN}\n\n${sections}`, "cv")
    const { totalPages, text } = await extractText(pdf, { mergePages: true })
    expect(totalPages).toBeGreaterThan(2)
    expect(text).toContain("Employer 16")
  })
})
