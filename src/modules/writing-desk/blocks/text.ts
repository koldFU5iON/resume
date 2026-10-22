import type {
  Image,
  List,
  ListItem,
  PhrasingContent,
  RootContent,
  Table,
} from "mdast"
import { parseWritingDeskDocument } from "./parse"
import { getBlockDefinition } from "./registry"
import type { WritingDeskBlockNode, WritingDeskContent } from "./types"

function inlineText(nodes: PhrasingContent[]): string {
  return nodes.map(node => {
    switch (node.type) {
      case "text":
      case "inlineCode":
      case "html":
        return node.value
      case "break":
        return "\n"
      case "image":
        return (node as Image).alt ?? ""
      case "emphasis":
      case "strong":
      case "delete":
      case "link":
      case "linkReference":
        return inlineText(node.children)
      case "footnoteReference":
        return `[${node.label ?? node.identifier}]`
      default:
        return "children" in node ? inlineText(node.children as PhrasingContent[]) : ""
    }
  }).join("")
}

function listItemText(item: ListItem): string {
  return item.children.map(child => {
    if (child.type === "paragraph") return inlineText(child.children)
    return blockText(child)
  }).join(" ").trim()
}

function listText(list: List, marker: (index: number) => string): string {
  return list.children
    .map((item, index) => `${marker(index)} ${listItemText(item)}`)
    .join("\n")
}

function tableText(table: Table): string {
  const row = (cells: Table["children"][number]["children"]) =>
    cells.map(cell => inlineText(cell.children)).join("\t")
  return [row(table.children[0]?.children ?? []), ...table.children.slice(1).map(child => row(child.children))]
    .filter(Boolean)
    .join("\n")
}

function findList(children: WritingDeskContent[]): List | undefined {
  return children.find((child): child is List => child.type === "list")
}

function blockText(node: WritingDeskContent | WritingDeskBlockNode): string {
  if (node.type === "writingDeskBlock") {
    const definition = node.blockId ? getBlockDefinition(node.blockId) : undefined
    if (definition?.plainText === "inline-list") {
      const list = findList(node.children)
      if (list) return list.children.map(item => listItemText(item)).join(" · ")
      return node.children.map(blockText).join("\n")
    }
    if (definition?.plainText === "compact-list") {
      const list = findList(node.children)
      if (list) return listText(list, () => "-")
      return node.children.map(blockText).join("\n")
    }
    return node.children.map(blockText).join("\n")
  }

  switch (node.type) {
    case "heading":
    case "paragraph":
      return inlineText(node.children)
    case "list":
      return listText(node, index => node.ordered ? `${index + 1}.` : "-")
    case "table":
      return tableText(node)
    case "code":
      return node.value
    case "blockquote":
      return node.children.map(blockText).join("\n")
    case "thematicBreak":
      return ""
    case "html":
      return node.value
    case "text":
      return node.value
    case "image":
      return node.alt ?? ""
    case "definition":
    case "footnoteDefinition":
      return ""
    default:
      return "children" in node
        ? (node.children as RootContent[]).map(blockText).join("\n")
        : "value" in node && typeof node.value === "string"
          ? node.value
          : ""
  }
}

export function writingDeskDocumentToText(document: ReturnType<typeof parseWritingDeskDocument>): string {
  return document.children
    .map(blockText)
    .filter(Boolean)
    .join("\n\n")
}

export function writingDeskMarkdownToText(markdown: string): string {
  return writingDeskDocumentToText(parseWritingDeskDocument(markdown))
}
