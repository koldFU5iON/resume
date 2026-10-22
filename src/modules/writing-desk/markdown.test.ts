import { describe, expect, it } from "vitest"
import { parseWritingDeskDocument, parseWritingDeskMarkdown } from "./blocks/parse"
import { writingDeskMarkdownToText } from "./blocks/text"

function types(markdown: string): string[] {
  return parseWritingDeskMarkdown(markdown).map(node => node.type)
}

describe("parseWritingDeskDocument", () => {
  it("keeps standard Markdown working", () => {
    const children = parseWritingDeskMarkdown("# Title\n\nFirst line\nsecond line\n\n---\n\n- One\n- Two")
    expect(children.map(node => node.type)).toEqual(["heading", "paragraph", "thematicBreak", "list"])
    expect(children[0]).toMatchObject({ type: "heading", depth: 1 })
    expect(children[1]).toMatchObject({ type: "paragraph" })
    expect(children[3]).toMatchObject({ type: "list", ordered: false })
  })

  it("parses GFM tables and keeps code fences literal", () => {
    const table = parseWritingDeskMarkdown("| Name | Notes |\n| --- | :---: |\n| Ada | A \\| B |")[0]
    expect(table).toMatchObject({ type: "table" })

    const code = parseWritingDeskMarkdown("```md\n:::header\n# literal\n:::\n```")
    expect(code).toEqual([
      expect.objectContaining({ type: "code", value: ":::header\n# literal\n:::" }),
    ])
  })

  it("recognises the canonical semantic and functional blocks", () => {
    const children = parseWritingDeskMarkdown([
      ":::header",
      "# Morgan Ellis",
      "## Program Manager",
      ":::",
      "",
      ":::skills",
      "- JavaScript",
      "- React",
      ":::",
      "",
      ":::inline-list",
      "- One",
      "- Two",
      ":::",
      "",
      ":::compact-list",
      "- First",
      "- Second",
      ":::",
    ].join("\n"))

    expect(children.map(node => node.type === "writingDeskBlock" ? node.blockId : node.type)).toEqual([
      "header",
      "skills",
      "inline-list",
      "compact-list",
    ])
  })

  it("preserves unknown block content and reports a diagnostic", () => {
    const document = parseWritingDeskDocument(":::callout\nKeep **this** content.\n:::")
    expect(document.children[0]).toMatchObject({
      type: "writingDeskBlock",
      name: "callout",
      blockId: null,
    })
    expect(document.diagnostics[0]).toMatchObject({ severity: "warning" })
    expect(writingDeskMarkdownToText(":::callout\nKeep **this** content.\n:::")).toBe("Keep this content.")
  })

  it("preserves malformed and unclosed blocks", () => {
    expect(types(":::header\n# A\ncontent")).toEqual(["writingDeskBlock"])
    expect(writingDeskMarkdownToText(":::header\n# A\ncontent")).toBe("A\ncontent")
    expect(types(":::header\n# A\n:::")).toEqual(["writingDeskBlock"])
  })

  it("treats escaped directives as ordinary text", () => {
    const children = parseWritingDeskMarkdown("\\:::header\n# A\n:::")
    expect(children[0]).toMatchObject({ type: "paragraph" })
    expect(writingDeskMarkdownToText("\\:::header\n# A\n:::")).toContain(":::header")
  })

  it("reports nested blocks without losing content", () => {
    const document = parseWritingDeskDocument(":::header\n# A\n:::contact\nB\n:::")
    expect(document.diagnostics.some(issue => issue.message.includes("Nested blocks"))).toBe(true)
    expect(writingDeskMarkdownToText(":::header\n# A\n:::contact\nB\n:::")).toBe("A\nB")
  })

  it("warns when a functional block does not contain a list", () => {
    const document = parseWritingDeskDocument(":::inline-list\nA paragraph\n:::")
    expect(document.diagnostics[0]).toMatchObject({ blockId: "inline-list", severity: "warning" })
    expect(writingDeskMarkdownToText(":::inline-list\nA paragraph\n:::")).toBe("A paragraph")
  })

  it("preserves mixed content in blocks via fallback", () => {
    const markdown = ":::skills\nIntro text\n\n- JavaScript\n- React\n:::"
    const document = parseWritingDeskDocument(markdown)
    expect(document.children[0]).toMatchObject({ type: "writingDeskBlock" })
    expect(writingDeskMarkdownToText(markdown)).toBe("Intro text\n- JavaScript\n- React")
  })

  it("handles CRLF and empty documents", () => {
    expect(parseWritingDeskMarkdown("## Hello\r\n\r\nWorld")).toHaveLength(2)
    expect(parseWritingDeskMarkdown("")).toEqual([])
  })
})

describe("writingDeskMarkdownToText", () => {
  it("renders inline lists with dot separators", () => {
    expect(writingDeskMarkdownToText(":::inline-list\n- JavaScript\n- React\n- Communications\n:::")).toBe(
      "JavaScript · React · Communications",
    )
  })

  it("renders skills and compact lists predictably", () => {
    expect(writingDeskMarkdownToText(":::skills\n- JavaScript\n- React\n:::")).toBe("JavaScript · React")
    expect(writingDeskMarkdownToText(":::compact-list\n- One\n- Two\n:::")).toBe("- One\n- Two")
  })

  it("keeps links and standard Markdown readable", () => {
    expect(writingDeskMarkdownToText("[Docs](https://example.com) and **bold**")).toBe("Docs and bold")
  })
})
