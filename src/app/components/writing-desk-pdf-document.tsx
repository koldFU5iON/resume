import { Document, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import type { ReactNode } from "react"
import type { List, ListItem, PhrasingContent, RootContent, Table } from "mdast"
import { parseWritingDeskDocument } from "@/modules/writing-desk/blocks/parse"
import {
  profileForDocumentType,
  type WritingDeskBlockNode,
  type WritingDeskContent,
  type WritingDeskDocumentProfile,
} from "@/modules/writing-desk/blocks/types"
import type { WritingDeskDocumentType } from "@/modules/writing-desk/schema"

const INK = "#2D2D2D"
const MUTED = "#4A4A4A"
const ACCENT = "#B8862E"

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", color: INK },
  cvPage: {
    fontSize: 10.5,
    lineHeight: 1.42,
    paddingTop: "15mm",
    paddingBottom: "15mm",
    paddingLeft: "16mm",
    paddingRight: "16mm",
  },
  generalPage: {
    fontSize: 10.5,
    lineHeight: 1.45,
    paddingTop: "16mm",
    paddingBottom: "16mm",
    paddingLeft: "16mm",
    paddingRight: "16mm",
  },
  header: {
    borderBottomWidth: 1.2,
    borderBottomColor: ACCENT,
    paddingBottom: 7,
    marginBottom: 12,
  },
  generalHeader: {
    borderBottomWidth: 1,
    borderBottomColor: "#C8C3B8",
    paddingBottom: 7,
    marginBottom: 12,
  },
  name: { fontFamily: "Helvetica-Bold", fontSize: 20, lineHeight: 1.1 },
  role: { fontSize: 11.5, marginTop: 2 },
  tagline: { fontFamily: "Helvetica-Bold", fontSize: 10.5, marginTop: 1 },
  contact: { fontSize: 9.5, color: MUTED, marginTop: 4 },
  heading1: { fontFamily: "Helvetica-Bold", fontSize: 20, lineHeight: 1.15, marginBottom: 8 },
  heading2: { fontFamily: "Helvetica-Bold", fontSize: 16, lineHeight: 1.2, marginTop: 8, marginBottom: 6 },
  heading3: { fontFamily: "Helvetica-Bold", fontSize: 12.5, marginTop: 6, marginBottom: 4 },
  headingSmall: { fontFamily: "Helvetica-Bold", fontSize: 11, marginTop: 5, marginBottom: 3 },
  sectionHeadingWrap: {
    borderBottomWidth: 1,
    borderBottomColor: ACCENT,
    paddingBottom: 2,
    marginTop: 9,
    marginBottom: 5,
  },
  sectionHeadingText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9.5,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  cvRole: { fontFamily: "Helvetica-Bold", fontSize: 11, marginTop: 5, marginBottom: 2 },
  paragraph: { marginBottom: 6 },
  compactParagraph: { marginBottom: 2 },
  list: { marginBottom: 6 },
  compactList: { marginBottom: 3 },
  listItem: { flexDirection: "row", marginBottom: 2.5 },
  compactListItem: { flexDirection: "row", marginBottom: 1 },
  marker: { width: 12, color: "#333333" },
  listText: { flex: 1 },
  bold: { fontFamily: "Helvetica-Bold" },
  italic: { fontFamily: "Helvetica-Oblique" },
  strike: { textDecoration: "line-through" },
  inlineCode: { fontFamily: "Courier", fontSize: 9 },
  link: { color: ACCENT, textDecoration: "none" },
  hr: { borderBottomWidth: 1, borderBottomColor: ACCENT, marginVertical: 8 },
  code: {
    fontFamily: "Courier",
    fontSize: 8.5,
    lineHeight: 1.35,
    backgroundColor: "#F3F1ED",
    padding: 7,
    marginBottom: 8,
  },
  blockquote: { borderLeftWidth: 2, borderLeftColor: "#C8C3B8", paddingLeft: 8, marginBottom: 6 },
  table: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: "#C8C3B8", marginBottom: 8 },
  tableRow: { flexDirection: "row" },
  tableHeader: { backgroundColor: "#F3F1ED" },
  tableCell: { flex: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#C8C3B8", padding: 4 },
  tableHeaderText: { fontFamily: "Helvetica-Bold" },
})

function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href)
}

function Inline({ nodes }: { nodes: PhrasingContent[] }) {
  return <>{nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.value
      case "emphasis":
        return <Text key={index} style={styles.italic}><Inline nodes={node.children} /></Text>
      case "strong":
        return <Text key={index} style={styles.bold}><Inline nodes={node.children} /></Text>
      case "delete":
        return <Text key={index} style={styles.strike}><Inline nodes={node.children} /></Text>
      case "inlineCode":
        return <Text key={index} style={styles.inlineCode}>{node.value}</Text>
      case "link":
        return isSafeHref(node.url)
          ? <Link key={index} src={node.url} style={styles.link}><Inline nodes={node.children} /></Link>
          : <Inline key={index} nodes={node.children} />
      case "break":
        return "\n"
      case "image":
        return node.alt ?? ""
      case "html":
        return node.value
      case "footnoteReference":
        return `[${node.label ?? node.identifier}]`
      default:
        return "children" in node
          ? <Inline key={index} nodes={node.children as PhrasingContent[]} />
          : null
    }
  })}</>
}

function plainText(node: unknown): string {
  if (!node || typeof node !== "object") return ""
  if ("value" in node && typeof node.value === "string") return node.value
  if ("children" in node && Array.isArray(node.children)) {
    return node.children.map(plainText).join("")
  }
  return ""
}

function listItemInline(item: ListItem): ReactNode {
  return item.children.map((child, index) => {
    if (child.type === "paragraph") return <Inline key={index} nodes={child.children} />
    return plainText(child)
  })
}

function listItemsFrom(children: WritingDeskContent[]): List | undefined {
  return children.find((child): child is List => child.type === "list")
}

function InlineList({ list }: { list: List }) {
  return <Text style={styles.paragraph}>{list.children.map((item, index) => (
    <Text key={index}>
      {index > 0 ? " · " : ""}
      {listItemInline(item)}
    </Text>
  ))}</Text>
}

function CompactList({ list }: { list: List }) {
  return <View style={styles.compactList}>{list.children.map((item, index) => (
    <View key={index} style={styles.compactListItem} wrap={false}>
      <Text style={styles.marker}>•</Text>
      <Text style={styles.listText}>{listItemInline(item)}</Text>
    </View>
  ))}</View>
}

function RegularList({ list }: { list: List }) {
  return <View style={styles.list}>{list.children.map((item, index) => (
    <View key={index} style={styles.listItem} wrap={false}>
      <Text style={styles.marker}>{list.ordered ? `${index + 1}.` : "•"}</Text>
      <Text style={styles.listText}>{listItemInline(item)}</Text>
    </View>
  ))}</View>
}

function TableBlock({ table }: { table: Table }) {
  const rows = table.children
  return (
    <View style={styles.table}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={rowIndex === 0 ? [styles.tableRow, styles.tableHeader] : styles.tableRow}>
          {row.children.map((cell, cellIndex) => (
            <Text key={cellIndex} style={rowIndex === 0 ? [styles.tableCell, styles.tableHeaderText] : styles.tableCell}>
              <Inline nodes={cell.children} />
            </Text>
          ))}
        </View>
      ))}
    </View>
  )
}

function HeaderBlock({
  block,
  profile,
}: {
  block: WritingDeskBlockNode
  profile: WritingDeskDocumentProfile
}) {
  return (
    <View style={profile === "cv" ? styles.header : styles.generalHeader} wrap={false}>
      {block.children.map((child, index) => {
        if (child.type === "heading") {
          const style = child.depth === 1
            ? styles.name
            : child.depth === 2
              ? styles.role
              : styles.tagline
          return <Text key={index} style={style}><Inline nodes={child.children} /></Text>
        }
        if (child.type === "paragraph") {
          return <Text key={index} style={styles.contact}><Inline nodes={child.children} /></Text>
        }
        return <View key={index}>{renderNode(child, profile)}</View>
      })}
    </View>
  )
}

function renderHeading(node: Extract<RootContent, { type: "heading" }>, profile: WritingDeskDocumentProfile) {
  if (profile === "cv") {
    if (node.depth === 1) return <Text style={styles.heading1}><Inline nodes={node.children} /></Text>
    if (node.depth === 2) {
      return (
        <View style={styles.sectionHeadingWrap} wrap={false} minPresenceAhead={40}>
          <Text style={styles.sectionHeadingText}><Inline nodes={node.children} /></Text>
        </View>
      )
    }
    if (node.depth === 3) {
      return (
        <View wrap={false} minPresenceAhead={24}>
          <Text style={styles.cvRole}><Inline nodes={node.children} /></Text>
        </View>
      )
    }
    return <Text style={styles.headingSmall}><Inline nodes={node.children} /></Text>
  }

  const style = node.depth === 1
    ? styles.heading1
    : node.depth === 2
      ? styles.heading2
      : node.depth === 3
        ? styles.heading3
        : styles.headingSmall
  return <Text style={style}><Inline nodes={node.children} /></Text>
}

function hasOnlyLists(children: WritingDeskContent[]): boolean {
  return children.length > 0 && children.every(child => child.type === "list")
}

function renderSemanticBlock(block: WritingDeskBlockNode, profile: WritingDeskDocumentProfile): ReactNode {
  if (block.blockId === "header") return <HeaderBlock block={block} profile={profile} />
  if (block.blockId === "skills" || block.blockId === "inline-list") {
    if (hasOnlyLists(block.children)) {
      const lists = block.children as List[]
      return <>{lists.map((list, index) => <InlineList key={index} list={list} />)}</>
    }
    if (block.children.length === 0) return null
    return <>{block.children.map((child, index) => <View key={index}>{renderNode(child, profile)}</View>)}</>
  }
  if (block.blockId === "compact-list") {
    if (hasOnlyLists(block.children)) {
      const lists = block.children as List[]
      return <>{lists.map((list, index) => <CompactList key={index} list={list} />)}</>
    }
    if (block.children.length === 0) return null
    return <>{block.children.map((child, index) => <View key={index}>{renderNode(child, profile)}</View>)}</>
  }
  return <>{block.children.map((child, index) => <View key={index}>{renderNode(child, profile)}</View>)}</>
}

function renderNode(node: WritingDeskContent, profile: WritingDeskDocumentProfile): ReactNode {
  if (node.type === "writingDeskBlock") return renderSemanticBlock(node, profile)

  switch (node.type) {
    case "heading":
      return renderHeading(node, profile)
    case "paragraph":
      return <Text style={styles.paragraph}><Inline nodes={node.children} /></Text>
    case "list":
      return <RegularList list={node} />
    case "table":
      return <TableBlock table={node} />
    case "code":
      return <Text style={styles.code}>{node.value}</Text>
    case "thematicBreak":
      return <View style={styles.hr} />
    case "blockquote":
      return <View style={styles.blockquote}>{node.children.map((child, index) => <View key={index}>{renderNode(child, profile)}</View>)}</View>
    case "html":
      return <Text style={styles.paragraph}>{node.value}</Text>
    case "image":
      return <Text style={styles.paragraph}>{node.alt ?? ""}</Text>
    case "text":
      return <Text style={styles.paragraph}>{node.value}</Text>
    case "definition":
    case "footnoteDefinition":
      return null
    default:
      return "children" in node
        ? <>{node.children.map((child, index) => <View key={index}>{renderNode(child as WritingDeskContent, profile)}</View>)}</>
        : null
  }
}

function renderBlocks(nodes: WritingDeskContent[], profile: WritingDeskDocumentProfile): ReactNode[] {
  const rendered: ReactNode[] = []
  let index = 0

  while (index < nodes.length) {
    const node = nodes[index]
    if (
      profile === "cv" &&
      node.type === "heading" &&
      node.depth === 3 &&
      nodes[index + 1]?.type === "paragraph"
    ) {
      const next = nodes[index + 1] as Extract<RootContent, { type: "paragraph" }>
      rendered.push(
        <View key={index} wrap={false} minPresenceAhead={24}>
          <Text style={styles.cvRole}><Inline nodes={node.children} /></Text>
          <Text style={styles.compactParagraph}><Inline nodes={next.children} /></Text>
        </View>,
      )
      index += 2
      continue
    }

    rendered.push(<View key={index}>{renderNode(node, profile)}</View>)
    index++
  }

  return rendered
}

export function WritingDeskPDFDocument({
  markdown,
  title,
  documentType,
}: {
  markdown: string
  title?: string
  documentType?: WritingDeskDocumentType | null
}) {
  const document = parseWritingDeskDocument(markdown)
  const profile = profileForDocumentType(documentType ?? null)

  return (
    <Document title={title}>
      <Page size="A4" style={[styles.page, profile === "cv" ? styles.cvPage : styles.generalPage]}>
        {renderBlocks(document.children, profile)}
      </Page>
    </Document>
  )
}
