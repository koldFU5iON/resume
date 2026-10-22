import { Document, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import { parseWritingDeskMarkdown, type InlineNode } from "@/modules/writing-desk/markdown"

const INK = "#202124"
const ACCENT = "#B8862E"

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 10.5, color: INK, padding: "16mm", lineHeight: 1.45 },
  heading1: { fontFamily: "Helvetica-Bold", fontSize: 22, lineHeight: 1.15, marginBottom: 9 },
  heading2: { fontFamily: "Helvetica-Bold", fontSize: 16, lineHeight: 1.2, marginTop: 8, marginBottom: 6 },
  heading3: { fontFamily: "Helvetica-Bold", fontSize: 12.5, marginTop: 6, marginBottom: 4 },
  headingSmall: { fontFamily: "Helvetica-Bold", fontSize: 11, marginTop: 5, marginBottom: 3 },
  paragraph: { marginBottom: 7 },
  bold: { fontFamily: "Helvetica-Bold" },
  italic: { fontFamily: "Helvetica-Oblique" },
  link: { color: ACCENT },
  hr: { borderBottomColor: ACCENT, borderBottomWidth: 1, marginVertical: 8 },
  listItem: { flexDirection: "row", marginBottom: 3 },
  marker: { width: 18 },
  listText: { flex: 1 },
  code: { fontFamily: "Courier", fontSize: 8.5, lineHeight: 1.35, backgroundColor: "#F3F1ED", padding: 7, marginBottom: 8 },
  table: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: "#C8C3B8", marginBottom: 8 },
  tableRow: { flexDirection: "row" },
  tableHeader: { backgroundColor: "#F3F1ED" },
  tableCell: { flex: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: "#C8C3B8", padding: 4 },
  tableHeaderText: { fontFamily: "Helvetica-Bold" },
})

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return <>{nodes.map((node, index) => {
    if (node.type === "emphasis") return <Text key={index} style={node.strong ? styles.bold : styles.italic}>{node.value}</Text>
    if (node.type === "link") return <Link key={index} src={node.href} style={styles.link}>{node.value}</Link>
    return node.value
  })}</>
}

export function WritingDeskPDFDocument({ markdown, title }: { markdown: string; title?: string }) {
  const blocks = parseWritingDeskMarkdown(markdown)
  const headingStyle = (level: number) => level === 1 ? styles.heading1 : level === 2 ? styles.heading2 : level === 3 ? styles.heading3 : styles.headingSmall

  return (
    <Document title={title}>
      <Page size="A4" style={styles.page}>
        {blocks.map((block, index) => {
          switch (block.type) {
            case "heading": return <Text key={index} style={headingStyle(block.level)}><Inline nodes={block.children} /></Text>
            case "paragraph": return <Text key={index} style={styles.paragraph}><Inline nodes={block.children} /></Text>
            case "hr": return <View key={index} style={styles.hr} />
            case "code": return <Text key={index} style={styles.code}>{block.value}</Text>
            case "list": return <View key={index} style={styles.paragraph}>{block.items.map((item, itemIndex) => <View key={itemIndex} style={styles.listItem}><Text style={styles.marker}>{block.ordered ? `${itemIndex + 1}.` : "•"}</Text><Text style={styles.listText}><Inline nodes={item} /></Text></View>)}</View>
            case "table": return <View key={index} style={styles.table}>{[block.header, ...block.rows].map((row, rowIndex) => <View key={rowIndex} style={rowIndex === 0 ? [styles.tableRow, styles.tableHeader] : styles.tableRow}>{row.map((cell, cellIndex) => <Text key={cellIndex} style={rowIndex === 0 ? [styles.tableCell, styles.tableHeaderText] : styles.tableCell}><Inline nodes={cell} /></Text>)}</View>)}</View>
          }
        })}
      </Page>
    </Document>
  )
}
