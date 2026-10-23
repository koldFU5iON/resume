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

  it("preserves mixed paragraph and list content inside a block", async () => {
    const markdown = [
      ":::skills",
      "Tools & technologies I use daily.",
      "",
      "- JavaScript",
      "- TypeScript",
      ":::",
    ].join("\n")
    const { pdf } = await render(markdown, "cv")
    const { text } = await extractText(pdf, { mergePages: true })
    expect(text).toContain("Tools & technologies I use daily.")
    expect(text).toContain("JavaScript")
    expect(text).toContain("TypeScript")
  })

  it("renders nested bullets as separate, ordered items in an ordinary list", async () => {
    const markdown = [
      "- Led delivery",
      "  - Shipped 3 titles",
      "  - Cut cycle time 20%",
      "- Second item",
    ].join("\n")
    const { pdf } = await render(markdown, "cv")
    const { text } = await extractText(pdf, { mergePages: true })

    const bullets = text.match(/•/g) ?? []
    expect(bullets.length).toBe(4)
    expect(text).not.toContain("Led deliveryShipped")
    const leadIdx = text.indexOf("Led delivery")
    const shippedIdx = text.indexOf("Shipped 3 titles")
    const cutIdx = text.indexOf("Cut cycle time 20%")
    const secondIdx = text.indexOf("Second item")
    expect(leadIdx).toBeLessThan(shippedIdx)
    expect(shippedIdx).toBeLessThan(cutIdx)
    expect(cutIdx).toBeLessThan(secondIdx)
  })

  it("renders multi-paragraph items as separate lines", async () => {
    const markdown = [
      "- First para",
      "",
      "  Second para",
      "- Another",
    ].join("\n")
    const { pdf } = await render(markdown, "cv")
    const { text } = await extractText(pdf, { mergePages: true })
    expect(text).toContain("First para")
    expect(text).toContain("Second para")
    expect(text).not.toContain("First paraSecond para")
    expect(text.indexOf("First para")).toBeLessThan(text.indexOf("Second para"))
  })

  it("renders nested bullets through a skills block fallback", async () => {
    const markdown = [
      ":::skills",
      "- Languages",
      "  - TypeScript",
      "  - Go",
      "- Leadership",
      ":::",
    ].join("\n")
    const { pdf } = await render(markdown, "cv")
    const { text } = await extractText(pdf, { mergePages: true })
    expect(text).not.toContain("LanguagesTypeScript")
    expect(text).toContain("Languages")
    expect(text).toContain("TypeScript")
    expect(text).toContain("Go")
    expect(text).toContain("Leadership")
  })

  it("preserves inline and leaf directive text in the PDF", async () => {
    const markdown = [
      "Meeting at 10:30, ratio 3:1.",
      "",
      "Contact",
      "",
      "::note",
    ].join("\n")
    const { pdf } = await render(markdown, "cover-letter")
    const { text } = await extractText(pdf, { mergePages: true })
    expect(text).toContain("10:30")
    expect(text).toContain("3:1")
    expect(text).toContain("::note")
  })

  it("preserves nested list items in a block via Markdown fallback", async () => {
    const markdown = [
      ":::inline-list",
      "- Languages",
      "  - TypeScript",
      "  - Go",
      "- Leadership",
      ":::",
    ].join("\n")
    const { pdf } = await render(markdown, "cv")
    const { text } = await extractText(pdf, { mergePages: true })
    expect(text).toContain("Languages")
    expect(text).toContain("TypeScript")
    expect(text).toContain("Go")
    expect(text).toContain("Leadership")
  })

  it("does not render a directive label as body text", async () => {
    const markdown = ":::header[Hidden label]\n# Morgan Ellis\n## Program Manager\n:::"
    const { pdf } = await render(markdown, "cv")
    const { text } = await extractText(pdf, { mergePages: true })
    expect(text).toContain("Morgan Ellis")
    expect(text).not.toContain("Hidden label")
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
