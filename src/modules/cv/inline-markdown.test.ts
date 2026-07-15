import { describe, expect, it } from "vitest"
import { parseInlineMarkdown } from "./inline-markdown"

describe("parseInlineMarkdown", () => {
  it("returns a single text token for plain text", () => {
    expect(parseInlineMarkdown("Hello world")).toEqual([
      { type: "text", value: "Hello world" },
    ])
  })

  it("parses bold runs", () => {
    expect(parseInlineMarkdown("**Kelly Ekins** | Senior Director")).toEqual([
      { type: "bold", value: "Kelly Ekins" },
      { type: "text", value: " | Senior Director" },
    ])
  })

  it("parses italic runs without consuming bold markers", () => {
    expect(parseInlineMarkdown("*All referees are notified.*")).toEqual([
      { type: "italic", value: "All referees are notified." },
    ])
  })

  it("does not mistake bold delimiters for italics", () => {
    expect(parseInlineMarkdown("**bold** then *italic*")).toEqual([
      { type: "bold", value: "bold" },
      { type: "text", value: " then " },
      { type: "italic", value: "italic" },
    ])
  })

  it("autolinks email addresses as mailto links", () => {
    expect(parseInlineMarkdown("kelly@fractional.llc")).toEqual([
      { type: "link", value: "kelly@fractional.llc", href: "mailto:kelly@fractional.llc" },
    ])
  })

  it("autolinks http(s) urls", () => {
    expect(parseInlineMarkdown("see https://example.com/page for info")).toEqual([
      { type: "text", value: "see " },
      { type: "link", value: "https://example.com/page", href: "https://example.com/page" },
      { type: "text", value: " for info" },
    ])
  })

  it("preserves newlines within surrounding text tokens", () => {
    expect(parseInlineMarkdown("**Kelly Ekins**\nkelly@fractional.llc")).toEqual([
      { type: "bold", value: "Kelly Ekins" },
      { type: "text", value: "\n" },
      { type: "link", value: "kelly@fractional.llc", href: "mailto:kelly@fractional.llc" },
    ])
  })

  it("handles a full multi-line references block", () => {
    const input =
      "**Guy Cunis** | VP Communications\nguycunis@gmail.com | +33 6 21 59 17 50"
    expect(parseInlineMarkdown(input)).toEqual([
      { type: "bold", value: "Guy Cunis" },
      { type: "text", value: " | VP Communications\n" },
      { type: "link", value: "guycunis@gmail.com", href: "mailto:guycunis@gmail.com" },
      { type: "text", value: " | +33 6 21 59 17 50" },
    ])
  })

  it("returns an empty array for empty input", () => {
    expect(parseInlineMarkdown("")).toEqual([])
  })
})
