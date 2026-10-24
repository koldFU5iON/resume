import { getBlockDefinition, parseWritingDeskMarkdown } from "./markdown"
import type { WritingDeskBlockNode, WritingDeskContent } from "./markdown"
import { MAX_WRITING_DESK_CONTENT_LENGTH } from "./schema"
import type { StructureGuide } from "./structure-guide"

export type DraftIssue = { severity: "error" | "warning" | "info"; message: string; line?: number }
export type DraftValidation = { ok: boolean; issues: DraftIssue[] }

function walk(nodes: WritingDeskContent[], visit: (node: WritingDeskContent) => void) {
  for (const node of nodes) {
    visit(node)
    if ("children" in node) walk(node.children as WritingDeskContent[], visit)
  }
}

function plainText(node: WritingDeskContent): string {
  if ("value" in node && typeof node.value === "string") return node.value
  if ("children" in node) return (node.children as WritingDeskContent[]).map(plainText).join("")
  return ""
}

const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase()

function blockLine(block: WritingDeskBlockNode): number | undefined {
  return block.position?.start.line ?? block.diagnostics.find(d => d.line !== undefined)?.line
}

const OPENER = /^ {0,3}(:{3,})([A-Za-z][\w-]*)/
const CLOSER = /^ {0,3}(:{3,})[ \t]*$/
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})/

/** Reports container fences that are opened but never closed, ignoring code fences. */
function findUnclosedBlocks(markdown: string): DraftIssue[] {
  const stack: Array<{ name: string; line: number; colons: number }> = []
  let fence: { char: string; length: number } | null = null
  markdown.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1
    const code = CODE_FENCE.exec(text)
    if (fence) {
      if (code && code[1][0] === fence.char && code[1].length >= fence.length && text.trim() === code[1]) fence = null
      return
    }
    if (code) {
      fence = { char: code[1][0], length: code[1].length }
      return
    }
    const closer = CLOSER.exec(text)
    if (closer) {
      const top = stack[stack.length - 1]
      if (top && closer[1].length >= top.colons) stack.pop()
      return
    }
    const opener = OPENER.exec(text)
    if (opener) stack.push({ name: opener[2], line, colons: opener[1].length })
  })
  return stack.map(open => ({
    severity: "error" as const,
    message: `Block ':::${open.name}' opened at line ${open.line} is never closed with ':::'`,
    line: open.line,
  }))
}

export function validateDraftMarkdown(markdown: string, guide?: StructureGuide): DraftValidation {
  const issues: DraftIssue[] = []

  if (markdown.length > MAX_WRITING_DESK_CONTENT_LENGTH) {
    issues.push({
      severity: "error",
      message: `Content is ${markdown.length} characters, over the ${MAX_WRITING_DESK_CONTENT_LENGTH} limit.`,
    })
    return { ok: false, issues }
  }

  const tree = parseWritingDeskMarkdown(markdown)
  const headings = new Set<string>()
  let hasHeaderBlock = false

  walk(tree, node => {
    if (node.type === "heading") headings.add(normalize(plainText(node)))
    if (node.type !== "writingDeskBlock") return
    if (node.name === "header") hasHeaderBlock = true
    if (!getBlockDefinition(node.name)) {
      issues.push({
        severity: "error",
        message: `Unknown block ":::${node.name}". Use one of the registered blocks.`,
        line: blockLine(node),
      })
    }
    for (const diagnostic of node.diagnostics) {
      if (!getBlockDefinition(node.name) && diagnostic.message.startsWith("Unknown block")) continue
      issues.push({ severity: diagnostic.severity, message: diagnostic.message, line: diagnostic.line })
    }
  })

  issues.push(...findUnclosedBlocks(markdown))

  if (guide) {
    for (const section of guide.sections) {
      const present = headings.has(normalize(section.heading)) || (section.key === "header" && hasHeaderBlock)
      if (!present) issues.push({ severity: "info", message: `No ${section.heading} section` })
    }
  }

  return { ok: !issues.some(i => i.severity === "error"), issues }
}
