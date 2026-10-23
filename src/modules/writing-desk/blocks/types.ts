import type { RootContent } from "mdast"
import type { Position } from "unist"
import type { WritingDeskDocumentType } from "../schema"

export type BlockCategory = "semantic" | "functional"

export type WritingDeskDocumentProfile = "cv" | "general"

export type BlockId = "header" | "skills" | "inline-list" | "compact-list"

export type BlockContentKind = "header" | "list" | "blocks"

export type PreviewRenderer = "header" | "inline-list" | "compact-list" | "fallback"

export type PdfRenderer = "header" | "inline-list" | "compact-list" | "markdown"

export type PlainTextRenderer = "content" | "inline-list" | "compact-list"

export type WritingDeskDiagnostic = {
  blockId?: string
  severity: "warning" | "error"
  message: string
  line?: number
  column?: number
}

export type BlockDefinition = {
  id: BlockId
  label: string
  category: BlockCategory
  description: string
  accepts: BlockContentKind
  example: string
  preview: {
    renderer: PreviewRenderer
    className?: string
  }
  pdf: Record<WritingDeskDocumentProfile, {
    renderer: PdfRenderer
    fallback?: PdfRenderer
    note?: string
  }>
  plainText: PlainTextRenderer
  ats: {
    safe: boolean
    note?: string
  }
  validate: (children: WritingDeskContent[]) => WritingDeskDiagnostic[]
}

export type WritingDeskBlockNode = {
  type: "writingDeskBlock"
  name: string
  blockId: BlockId | null
  children: WritingDeskContent[]
  diagnostics: WritingDeskDiagnostic[]
  position?: Position
}

export type WritingDeskContent = RootContent | WritingDeskBlockNode

export type WritingDeskDocument = {
  type: "writingDeskDocument"
  children: WritingDeskContent[]
  diagnostics: WritingDeskDiagnostic[]
}

export function profileForDocumentType(
  documentType: WritingDeskDocumentType | null,
): WritingDeskDocumentProfile {
  return documentType === "cv" ? "cv" : "general"
}
