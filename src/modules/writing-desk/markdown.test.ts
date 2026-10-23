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

describe("inline and leaf directive preservation", () => {
  const cases: Array<[string, string, string]> = [
    ["times", "Meeting at 10:30", "Meeting at 10:30"],
    ["ratios", "ratio 3:1", "ratio 3:1"],
    ["word:word", "Skills:JavaScript and Tools:Figma", "Skills:JavaScript and Tools:Figma"],
    ["mailto", "mailto:devon@example.com or devon:hello", "mailto:devon@example.com or devon:hello"],
    ["inline leaf", "before ::leaf after", "before ::leaf after"],
  ]

  it.each(cases)("keeps %s text intact in plain text", (_label, markdown, expected) => {
    expect(writingDeskMarkdownToText(markdown)).toBe(expected)
  })

  it("does not treat colon text as a directive node", () => {
    const children = parseWritingDeskMarkdown("Meeting at 10:30, ratio 3:1")
    expect(children[0]).toMatchObject({ type: "paragraph" })
    expect(JSON.stringify(children)).not.toContain("Directive")
  })

  it("preserves a standalone leaf directive line verbatim", () => {
    expect(writingDeskMarkdownToText("Contact\n\n::note")).toBe("Contact\n\n::note")
  })
})

describe("list item content fidelity", () => {
  it("preserves nested list items via Markdown fallback", () => {
    const markdown = ":::inline-list\n- Languages\n  - TypeScript\n  - Go\n- Leadership\n:::"
    const result = writingDeskMarkdownToText(markdown)
    expect(result).toContain("Languages")
    expect(result).toContain("TypeScript")
    expect(result).toContain("Go")
    expect(result).toContain("Leadership")
  })

  it("preserves a second paragraph inside an item", () => {
    const markdown = ":::skills\n- JavaScript\n\n  Deep experience\n- React\n:::"
    const result = writingDeskMarkdownToText(markdown)
    expect(result).toContain("JavaScript")
    expect(result).toContain("Deep experience")
    expect(result).toContain("React")
  })

  it("warns when a list block cannot be flattened", () => {
    const document = parseWritingDeskDocument(":::inline-list\n- Languages\n  - TypeScript\n- Leadership\n:::")
    expect(document.diagnostics.some(issue => issue.message.includes("simple lists"))).toBe(true)
  })

  it("allows a heading alongside a list and keeps the heading above the inline list", () => {
    const markdown = ":::inline-list\n## Core Competencies\n\n- Product Operations\n- Operating Model Design\n:::"
    const document = parseWritingDeskDocument(markdown)
    expect(document.diagnostics).toHaveLength(0)
    expect(writingDeskMarkdownToText(markdown)).toBe(
      "Core Competencies\nProduct Operations · Operating Model Design",
    )
  })

  it("warns when unsupported content is mixed with a list", () => {
    const document = parseWritingDeskDocument(":::inline-list\nA paragraph\n\n- Product Operations\n:::")
    expect(document.diagnostics[0]?.message).toContain("mixes other content")
  })
})

describe("directive labels", () => {
  it("does not render a directive label as body text", () => {
    expect(writingDeskMarkdownToText(":::header[Hidden label]\n# Morgan Ellis\n:::")).toBe("Morgan Ellis")
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
