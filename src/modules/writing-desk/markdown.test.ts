import { describe, expect, it } from "vitest"
import { parseInlineMarkdown, parseWritingDeskMarkdown } from "./markdown"

describe("parseInlineMarkdown", () => {
  it("preserves plain text and interprets emphasis without HTML", () => {
    expect(parseInlineMarkdown("<b>Safe</b> **strong** and _emphasis_")).toEqual([
      { type: "text", value: "<b>Safe</b> " },
      { type: "emphasis", value: "strong", strong: true },
      { type: "text", value: " and " },
      { type: "emphasis", value: "emphasis", strong: false },
    ])
  })

  it("only emits safe http(s) and mailto links", () => {
    expect(parseInlineMarkdown("[Docs](https://example.com) [bad](javascript:alert(1))")).toEqual([
      { type: "link", value: "Docs", href: "https://example.com" },
      { type: "text", value: " [bad](javascript:alert(1))" },
    ])
  })
})

describe("parseWritingDeskMarkdown", () => {
  it("parses headings, paragraphs, rules, and plain text", () => {
    expect(parseWritingDeskMarkdown("# Title\n\nFirst line\nsecond line\n\n---\n\nJust text")).toEqual([
      { type: "heading", level: 1, children: [{ type: "text", value: "Title" }] },
      { type: "paragraph", children: [{ type: "text", value: "First line second line" }] },
      { type: "hr" },
      { type: "paragraph", children: [{ type: "text", value: "Just text" }] },
    ])
  })

  it("parses ordered and unordered lists independently", () => {
    expect(parseWritingDeskMarkdown("- One\n- Two\n\n1. First\n2. Second")).toEqual([
      { type: "list", ordered: false, items: [[{ type: "text", value: "One" }], [{ type: "text", value: "Two" }]] },
      { type: "list", ordered: true, items: [[{ type: "text", value: "First" }], [{ type: "text", value: "Second" }]] },
    ])
  })

  it("parses GFM-style tables including escaped pipes", () => {
    expect(parseWritingDeskMarkdown("| Name | Notes |\n| --- | :---: |\n| Ada | A \\| B |")[0]).toEqual({
      type: "table",
      header: [[{ type: "text", value: "Name" }], [{ type: "text", value: "Notes" }]],
      rows: [[[{ type: "text", value: "Ada" }], [{ type: "text", value: "A | B" }]]],
    })
  })

  it("parses fenced code literally and does not parse its contents", () => {
    expect(parseWritingDeskMarkdown("```ts\nconst title = '# literal'\n```")).toEqual([
      { type: "code", language: "ts", value: "const title = '# literal'" },
    ])
  })

  it("handles CRLF input and empty documents", () => {
    expect(parseWritingDeskMarkdown("## Hello\r\n\r\nWorld")).toHaveLength(2)
    expect(parseWritingDeskMarkdown("")).toEqual([])
  })
})
