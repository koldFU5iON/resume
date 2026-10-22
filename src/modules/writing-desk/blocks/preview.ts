import type { List, ListItem, Paragraph, PhrasingContent, Root } from "mdast"
import { visit } from "unist-util-visit"
import { getBlockDefinition } from "./registry"
import type { WritingDeskContent, WritingDeskDiagnostic } from "./types"

type DirectiveNode = {
  type: "containerDirective"
  name: string
  children: WritingDeskContent[]
  data?: Record<string, unknown>
}

function itemPhrasing(item: ListItem): PhrasingContent[] {
  const first = item.children[0]
  if (first?.type === "paragraph") return first.children
  return [{ type: "text", value: plainText(item) }]
}

function plainText(node: unknown): string {
  if (!node || typeof node !== "object") return ""
  if ("value" in node && typeof node.value === "string") return node.value
  if ("children" in node && Array.isArray(node.children)) {
    return node.children.map(plainText).join("")
  }
  return ""
}

function listToInlineParagraph(list: List): Paragraph {
  const children: PhrasingContent[] = []
  list.children.forEach((item, index) => {
    if (index > 0) children.push({ type: "text", value: " · " })
    children.push(...itemPhrasing(item))
  })
  return { type: "paragraph", children }
}

function firstDiagnostic(children: WritingDeskContent[], definition: ReturnType<typeof getBlockDefinition>): WritingDeskDiagnostic | undefined {
  return definition?.validate(children)[0]
}

export function remarkWritingDeskPreview() {
  return (tree: Root) => {
    visit(tree, node => {
      if ((node as { type: string }).type !== "containerDirective") return
      const directive = node as unknown as DirectiveNode
      const definition = getBlockDefinition(directive.name)
      const diagnostic = firstDiagnostic(directive.children, definition)

      if (!definition) {
        directive.data = {
          ...directive.data,
          hName: "div",
          hProperties: {
            "data-wd-block": "unknown",
            "data-wd-name": directive.name,
            "data-wd-valid": "false",
            "data-wd-message": `Unknown block ":::${directive.name}". Its content is preserved.`,
          },
        }
        return
      }

      const onlyLists =
        directive.children.length > 0 && directive.children.every(child => child.type === "list")
      if (definition.preview.renderer === "inline-list" && onlyLists) {
        directive.children = directive.children.map(child => listToInlineParagraph(child as List))
      }

      directive.data = {
        ...directive.data,
        hName: "div",
        hProperties: {
          "data-wd-block": definition.id,
          "data-wd-valid": diagnostic ? "false" : "true",
          ...(diagnostic ? { "data-wd-message": diagnostic.message } : {}),
        },
      }
    })
  }
}
