import { createHash } from "node:crypto"

export type DraftSection = { id: string; hash: string; text: string }

export type SectionOp =
  | { type: "replace"; sectionId: string; expectedHash: string; content: string }
  | {
      type: "insert"
      afterSectionId?: string
      position?: "start" | "end"
      content: string
    }
  | { type: "remove"; sectionId: string; expectedHash: string }

export type SectionOpResult =
  | { ok: true; markdown: string }
  | {
      ok: false
      reason: "section_not_found" | "hash_mismatch" | "invalid_op"
      sections: DraftSection[]
      current?: DraftSection
    }

export function hashSectionText(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 12)
}

function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return s || "section"
}

const FENCE = /^\s*(```|~~~)/
const DIRECTIVE_OPEN = /^:::([a-z0-9-]+)/
const DIRECTIVE_CLOSE = /^:::\s*$/
const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/

type RawSection = { id: string; lines: string[] }

/**
 * Split Markdown into addressable sections. Boundaries are top-level `:::name`
 * directive blocks and ATX headings at directive depth 0, both ignored inside
 * fenced code. Content after a closed directive and before the next boundary
 * becomes its own section with id `text`.
 */
export function splitSections(markdown: string): DraftSection[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  const raw: RawSection[] = []
  let current: RawSection = { id: "preamble", lines: [] }
  let inFence = false
  let depth = 0

  const start = (id: string) => {
    raw.push(current)
    current = { id, lines: [] }
  }

  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence
      current.lines.push(line)
      continue
    }
    if (inFence) {
      current.lines.push(line)
      continue
    }
    if (depth === 0) {
      const open = DIRECTIVE_OPEN.exec(line)
      if (open) {
        start(open[1])
        depth = 1
        current.lines.push(line)
        continue
      }
      const heading = HEADING.exec(line)
      if (heading) {
        start(slug(heading[1]))
        current.lines.push(line)
        continue
      }
      current.lines.push(line)
      continue
    }
    // inside a directive block
    current.lines.push(line)
    if (DIRECTIVE_CLOSE.test(line)) {
      depth--
      if (depth === 0) start("text")
    } else if (DIRECTIVE_OPEN.test(line)) {
      depth++
    }
  }
  raw.push(current)

  const seen = new Map<string, number>()
  const sections: DraftSection[] = []
  for (const r of raw) {
    const text = r.lines.join("\n").trim()
    if (!text) continue
    const n = (seen.get(r.id) ?? 0) + 1
    seen.set(r.id, n)
    sections.push({
      id: n === 1 ? r.id : `${r.id}-${n}`,
      hash: hashSectionText(text),
      text,
    })
  }
  return sections
}

export function joinSections(sections: Array<{ text: string }>): string {
  if (sections.length === 0) return ""
  return sections.map((s) => s.text.trim()).join("\n\n") + "\n"
}

export function applySectionOp(
  markdown: string,
  op: SectionOp,
): SectionOpResult {
  const sections = splitSections(markdown)
  const fail = (
    reason: "section_not_found" | "hash_mismatch" | "invalid_op",
    current?: DraftSection,
  ): SectionOpResult => ({ ok: false, reason, sections, current })

  if (op.type === "insert") {
    const hasAfter = op.afterSectionId !== undefined
    const hasPos = op.position !== undefined
    if (hasAfter === hasPos || !op.content.trim()) return fail("invalid_op")
    const incoming = { text: op.content }
    let index: number
    if (hasAfter) {
      const i = sections.findIndex((s) => s.id === op.afterSectionId)
      if (i === -1) return fail("section_not_found")
      index = i + 1
    } else if (op.position === "start") {
      index = 0
    } else if (op.position === "end") {
      index = sections.length
    } else {
      return fail("invalid_op")
    }
    const next: Array<{ text: string }> = [...sections]
    next.splice(index, 0, incoming)
    return { ok: true, markdown: joinSections(next) }
  }

  const index = sections.findIndex((s) => s.id === op.sectionId)
  if (index === -1) return fail("section_not_found")
  const target = sections[index]
  if (target.hash !== op.expectedHash) return fail("hash_mismatch", target)

  const next: Array<{ text: string }> = [...sections]
  if (op.type === "replace") {
    if (!op.content.trim()) return fail("invalid_op", target)
    next[index] = { text: op.content }
  } else if (op.type === "remove") {
    next.splice(index, 1)
  } else {
    return fail("invalid_op")
  }
  return { ok: true, markdown: joinSections(next) }
}
