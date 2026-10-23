import { describe, expect, it } from "vitest"
import type { Root } from "mdast"
import { unified } from "unified"
import remarkDirective from "remark-directive"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import { remarkWritingDeskPreview } from "./preview"
import { remarkPreserveDirectives } from "./remark-preserve-directives"

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkDirective)
  .use(remarkPreserveDirectives)
  .use(remarkWritingDeskPreview)

function run(markdown: string): Root {
  return processor.runSync(processor.parse(markdown), { value: markdown }) as Root
}

function allText(node: unknown, acc: string[] = []): string[] {
  if (!node || typeof node !== "object") return acc
  const record = node as { value?: unknown; children?: unknown[] }
  if (typeof record.value === "string") acc.push(record.value)
  if (Array.isArray(record.children)) record.children.forEach(child => allText(child, acc))
  return acc
}

describe("remarkWritingDeskPreview", () => {
  it("preserves inline directive text through the preview pipeline", () => {
    const text = allText(run("Meeting at 10:30, ratio 3:1")).join("")
    expect(text).toContain("10:30")
    expect(text).toContain("3:1")
  })

  it("preserves a standalone leaf directive through the preview pipeline", () => {
    const text = allText(run("Contact\n\n::note")).join("")
    expect(text).toContain("::note")
  })

  it("drops directive labels instead of rendering them as body text", () => {
    const text = allText(run(":::header[Hidden label]\n# Morgan Ellis\n:::")).join("")
    expect(text).toContain("Morgan Ellis")
    expect(text).not.toContain("Hidden label")
  })

  it("flattens a simple inline-list into a single paragraph", () => {
    const tree = run(":::inline-list\n- JavaScript\n- React\n:::")
    const text = allText(tree).join("")
    expect(text).toContain("JavaScript · React")
  })

  it("flattens the list while keeping a heading inside an inline-list block", () => {
    const tree = run(":::inline-list\n## Core Competencies\n\n- Product Operations\n- Operating Model Design\n:::")
    const text = allText(tree).join("")
    expect(text).toContain("Core Competencies")
    expect(text).toContain("Product Operations · Operating Model Design")
    const directive = tree.children[0] as { data?: { hProperties?: Record<string, string> } }
    expect(directive.data?.hProperties?.["data-wd-valid"]).toBe("true")
  })

  it("falls back to Markdown for nested list items without dropping content", () => {
    const tree = run(":::inline-list\n- Languages\n  - TypeScript\n  - Go\n- Leadership\n:::")
    const text = allText(tree).join(" ")
    expect(text).toContain("Languages")
    expect(text).toContain("TypeScript")
    expect(text).toContain("Go")
    expect(text).toContain("Leadership")
  })

  it("follows the parser decision and marks nested blocks as unsupported", () => {
    const tree = run(":::header\n# A\n:::contact\nB\n:::")
    const serialized = JSON.stringify(tree)
    // The outer block keeps its styling; the inner block must not be styled as
    // a supported block (blockId null in the parser => no data-wd-block here).
    const inner = JSON.stringify((tree.children[0] as { children?: unknown[] }).children)
    expect(serialized).toContain("data-wd-block")
    expect(inner.includes("data-wd-block")).toBe(false)
  })
})
