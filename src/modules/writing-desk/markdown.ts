export type InlineNode =
  | { type: "text"; value: string }
  | { type: "emphasis"; value: string; strong: boolean }
  | { type: "link"; value: string; href: string }

export type MarkdownBlock =
  | { type: "heading"; level: number; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "table"; header: InlineNode[][]; rows: InlineNode[][][] }
  | { type: "code"; language?: string; value: string }
  | { type: "hr" }

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const ORDERED_LIST = /^\s*(\d+)\.\s+(.+)$/
const UNORDERED_LIST = /^\s*[-+*]\s+(.+)$/
const FENCE = /^\s*```\s*([^\s`]*)\s*$/
const HR = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/
const TABLE_SEPARATOR_CELL = /^:?-{3,}:?$/

function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href)
}

/** Converts inline Markdown to a safe, renderer-agnostic representation. */
export function parseInlineMarkdown(value: string): InlineNode[] {
  const nodes: InlineNode[] = []
  let text = ""

  const appendText = (part: string) => {
    text += part
  }
  const flushText = () => {
    if (text) nodes.push({ type: "text", value: text })
    text = ""
  }

  for (let index = 0; index < value.length;) {
    const link = value.slice(index).match(/^\[([^\]]+)]\(([^\s)]+)\)/)
    if (link) {
      const [source, label, href] = link
      if (isSafeHref(href)) {
        flushText()
        nodes.push({ type: "link", value: label, href })
      } else {
        appendText(source)
      }
      index += source.length
      continue
    }

    const strong = value.slice(index).match(/^\*\*(.+?)\*\*/)
    if (strong) {
      flushText()
      nodes.push({ type: "emphasis", value: strong[1], strong: true })
      index += strong[0].length
      continue
    }

    const emphasis = value.slice(index).match(/^(\*|_)([^\s].*?)\1/)
    if (emphasis) {
      flushText()
      nodes.push({ type: "emphasis", value: emphasis[2], strong: false })
      index += emphasis[0].length
      continue
    }

    appendText(value[index])
    index++
  }

  flushText()
  return nodes
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\||\|$/g, "")
  const cells: string[] = []
  let cell = ""
  let escaped = false

  for (const char of trimmed) {
    if (escaped) {
      cell += char
      escaped = false
    } else if (char === "\\") {
      escaped = true
    } else if (char === "|") {
      cells.push(cell.trim())
      cell = ""
    } else {
      cell += char
    }
  }
  cells.push(cell.trim())
  return cells
}

function isTableSeparator(line: string, columns: number): boolean {
  const cells = splitTableRow(line)
  return cells.length === columns && cells.every(cell => TABLE_SEPARATOR_CELL.test(cell))
}

function tableRow(line: string, columns: number): InlineNode[][] | null {
  if (!line.includes("|")) return null
  const cells = splitTableRow(line)
  if (cells.length !== columns) return null
  return cells.map(parseInlineMarkdown)
}

/**
 * Parses the subset of Markdown supported by Writing Desk's PDF export.
 * HTML is intentionally not interpreted; it remains literal text.
 */
export function parseWritingDeskMarkdown(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      index++
      continue
    }

    const fence = line.match(FENCE)
    if (fence) {
      const language = fence[1] || undefined
      const code: string[] = []
      index++
      while (index < lines.length && !FENCE.test(lines[index])) code.push(lines[index++])
      if (index < lines.length) index++
      blocks.push({ type: "code", language, value: code.join("\n") })
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, children: parseInlineMarkdown(heading[2]) })
      index++
      continue
    }

    if (HR.test(line)) {
      blocks.push({ type: "hr" })
      index++
      continue
    }

    const headerCells = line.includes("|") ? splitTableRow(line) : null
    if (headerCells && index + 1 < lines.length && isTableSeparator(lines[index + 1], headerCells.length)) {
      const header = headerCells.map(parseInlineMarkdown)
      const rows: InlineNode[][][] = []
      index += 2
      while (index < lines.length) {
        const row = tableRow(lines[index], header.length)
        if (!row) break
        rows.push(row)
        index++
      }
      blocks.push({ type: "table", header, rows })
      continue
    }

    const ordered = line.match(ORDERED_LIST)
    const unordered = line.match(UNORDERED_LIST)
    if (ordered || unordered) {
      const isOrdered = Boolean(ordered)
      const items: InlineNode[][] = []
      while (index < lines.length) {
        const item = lines[index].match(isOrdered ? ORDERED_LIST : UNORDERED_LIST)
        if (!item) break
        items.push(parseInlineMarkdown(item[isOrdered ? 2 : 1]))
        index++
      }
      blocks.push({ type: "list", ordered: isOrdered, items })
      continue
    }

    const paragraph = [line.trim()]
    index++
    while (index < lines.length && lines[index].trim()) {
      const next = lines[index]
      if (FENCE.test(next) || HEADING.test(next) || HR.test(next) || ORDERED_LIST.test(next) || UNORDERED_LIST.test(next)) break
      if (next.includes("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1], splitTableRow(next).length)) break
      paragraph.push(next.trim())
      index++
    }
    blocks.push({ type: "paragraph", children: parseInlineMarkdown(paragraph.join(" ")) })
  }

  return blocks
}

export function writingDeskMarkdownToText(markdown: string): string {
  const inlineText = (nodes: InlineNode[]) => nodes.map(node => node.value).join("")
  return parseWritingDeskMarkdown(markdown)
    .map(block => {
      switch (block.type) {
        case "heading":
        case "paragraph":
          return inlineText(block.children)
        case "hr":
          return ""
        case "code":
          return block.value
        case "list":
          return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : "-"} ${inlineText(item)}`).join("\n")
        case "table":
          return [block.header, ...block.rows].map(row => row.map(inlineText).join("\t")).join("\n")
      }
    })
    .filter(Boolean)
    .join("\n\n")
}
