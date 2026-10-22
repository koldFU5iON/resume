import type { List, ListItem, Paragraph, PhrasingContent, Root } from "mdast"
import { visitParents } from "unist-util-visit-parents"
import { getBlockDefinition } from "./registry"
import { isFlattenableListBlock, simpleListItemInline } from "./shape"
import type { WritingDeskContent, WritingDeskDiagnostic } from "./types"

type DirectiveNode = {
  type: "containerDirective"
  name: string
  children: WritingDeskContent[]
  data?: Record<string, unknown>
}

function itemPhrasing(item: ListItem): PhrasingContent[] {
  const inline = simpleListItemInline(item)
  if (inline) return inline
  return [{ type: "text", value: plainText(item) }]
}

function plainText(node: unknown): string {
  if (!node || typeof node !== "object") return ""
  if ("value" in node && typeof node.value === "string") return node.value
  if ("children" in node && Array.isArray(node.children)) {
    return node.children.map(plainText).join(" ")
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
    visitParents(tree, (node, ancestors) => {
      if ((node as { type: string }).type !== "containerDirective") return
      const directive = node as unknown as DirectiveNode

      // Nested blocks are unsupported: the parser nulls their blockId and falls
      // back to ordinary Markdown. Mirror that here so preview and PDF agree —
      // no block styling and no label/flattening for a nested directive.
      const nested = ancestors.some(
        ancestor => (ancestor as { type: string }).type === "containerDirective",
      )
      if (nested) {
        directive.data = {
          ...directive.data,
          hName: "div",
          hProperties: {},
        }
        return
      }

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

      // Drop directive labels such as `:::header[Hidden label]`.
      directive.children = directive.children.filter(
        child => !(child as { data?: { directiveLabel?: boolean } }).data?.directiveLabel,
      )

      if (definition.preview.renderer === "inline-list" && isFlattenableListBlock(directive.children)) {
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
