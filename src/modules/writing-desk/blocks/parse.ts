import type { Root, RootContent } from "mdast"
import type { Position } from "unist"
import { unified } from "unified"
import remarkDirective from "remark-directive"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import { getBlockDefinition } from "./registry"
import { remarkPreserveDirectives } from "./remark-preserve-directives"
import type {
  WritingDeskBlockNode,
  WritingDeskContent,
  WritingDeskDiagnostic,
  WritingDeskDocument,
} from "./types"

type DirectiveNode = {
  type: "containerDirective"
  name: string
  children: RootContent[]
  position?: Position
}

function isDirectiveNode(node: RootContent): node is RootContent & DirectiveNode {
  return (node as { type: string }).type === "containerDirective"
}

function transformNode(node: RootContent): WritingDeskContent {
  if (isDirectiveNode(node)) {
    const definition = getBlockDefinition(node.name)
    const diagnostics: WritingDeskDiagnostic[] = []

    if (!definition) {
      diagnostics.push({
        severity: "warning",
        message: `Unknown block ":::${node.name}". Its content is preserved as ordinary Markdown.`,
        line: node.position?.start.line,
        column: node.position?.start.column,
      })
    }

    const children = node.children
      .filter(child => !(child as { data?: { directiveLabel?: boolean } }).data?.directiveLabel)
      .map(transformNode)
    const nested = children.some(child => child.type === "writingDeskBlock")
    if (nested) {
      diagnostics.push({
        severity: "warning",
        message: "Nested blocks are not supported. Their content is preserved and rendered as fallback.",
        line: node.position?.start.line,
        column: node.position?.start.column,
      })
    }

    if (definition) {
      for (const issue of definition.validate(children)) {
        diagnostics.push({
          ...issue,
          blockId: definition.id,
          line: issue.line ?? node.position?.start.line,
          column: issue.column ?? node.position?.start.column,
        })
      }
    }

    const block: WritingDeskBlockNode = {
      type: "writingDeskBlock",
      name: node.name,
      blockId: definition && !nested ? definition.id : null,
      children,
      diagnostics,
    }
    return block
  }

  const parent = node as RootContent & { children?: RootContent[] }
  if (Array.isArray(parent.children)) {
    return {
      ...parent,
      children: parent.children.map(transformNode),
    } as unknown as WritingDeskContent
  }
  return node
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkDirective)
  .use(remarkPreserveDirectives)

export function parseWritingDeskDocument(markdown: string): WritingDeskDocument {
  const parsed = processor.parse(markdown) as Root
  const tree = processor.runSync(parsed, { value: markdown }) as Root
  const children = (tree.children as RootContent[]).map(transformNode)
  const diagnostics = children.flatMap(child => child.type === "writingDeskBlock" ? child.diagnostics : [])
  return { type: "writingDeskDocument", children, diagnostics }
}

export function parseWritingDeskMarkdown(markdown: string): WritingDeskContent[] {
  return parseWritingDeskDocument(markdown).children
}
