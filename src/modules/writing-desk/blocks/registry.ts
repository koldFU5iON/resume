import type {
  BlockDefinition,
  BlockId,
  WritingDeskContent,
  WritingDeskDiagnostic,
} from "./types"
import { isFlattenableListBlock } from "./shape"

function nodeHasContent(node: WritingDeskContent): boolean {
  if ("value" in node && typeof node.value === "string") return node.value.trim().length > 0
  if ("children" in node) return node.children.some(nodeHasContent)
  return false
}

function hasContent(children: WritingDeskContent[]): boolean {
  return children.some(nodeHasContent)
}

function hasNodeType(children: WritingDeskContent[], type: string): boolean {
  return children.some(child => child.type === type)
}

function validateHeader(children: WritingDeskContent[]): WritingDeskDiagnostic[] {
  if (!hasContent(children)) {
    return [{ severity: "warning", message: "The header block is empty." }]
  }
  if (!hasNodeType(children, "heading")) {
    return [{ severity: "warning", message: "Consider starting the header block with a name heading." }]
  }
  return []
}

function validateList(children: WritingDeskContent[]): WritingDeskDiagnostic[] {
  if (!hasContent(children)) {
    return [{ severity: "warning", message: "This block is empty." }]
  }
  if (!hasNodeType(children, "list")) {
    return [{ severity: "warning", message: "This block expects a Markdown list. Its content will be preserved as text." }]
  }
  if (!isFlattenableListBlock(children)) {
    return [
      {
        severity: "warning",
        message:
          "This block can only lay out simple lists. Its content is preserved with ordinary Markdown formatting.",
      },
    ]
  }
  return []
}

export const BLOCK_REGISTRY: Record<BlockId, BlockDefinition> = {
  header: {
    id: "header",
    label: "Header",
    category: "semantic",
    description: "Candidate identity, positioning, and contact details.",
    accepts: "header",
    example: [
      ":::header",
      "# Morgan Ellis",
      "## Program Manager",
      "### Program & Operations Leader | Systems Thinker",
      "morganellis.dev | linkedin.com/in/morgan-ellis",
      ":::",
    ].join("\n"),
    preview: { renderer: "header" },
    pdf: {
      cv: { renderer: "header" },
      general: { renderer: "header" },
    },
    plainText: "content",
    ats: {
      safe: true,
      note: "Identity and contact details remain ordinary text and links.",
    },
    validate: validateHeader,
  },
  skills: {
    id: "skills",
    label: "Skills",
    category: "semantic",
    description: "A compact professional skills and competencies section.",
    accepts: "list",
    example: [
      ":::skills",
      "- JavaScript",
      "- React",
      "- Communications",
      ":::",
    ].join("\n"),
    preview: { renderer: "inline-list" },
    pdf: {
      cv: { renderer: "inline-list", note: "CVs default to compact inline formatting." },
      general: { renderer: "inline-list" },
    },
    plainText: "inline-list",
    ats: {
      safe: true,
      note: "Skills stay as readable text; middle-dot separators survive extraction.",
    },
    validate: validateList,
  },
  "inline-list": {
    id: "inline-list",
    label: "Inline List",
    category: "functional",
    description: "A list presented as compact text separated by middle dots.",
    accepts: "list",
    example: [
      ":::inline-list",
      "- JavaScript",
      "- React",
      "- Communications",
      ":::",
    ].join("\n"),
    preview: { renderer: "inline-list" },
    pdf: {
      cv: { renderer: "inline-list" },
      general: { renderer: "inline-list" },
    },
    plainText: "inline-list",
    ats: {
      safe: true,
      note: "Separators are literal text, so content stays machine-readable.",
    },
    validate: validateList,
  },
  "compact-list": {
    id: "compact-list",
    label: "Compact List",
    category: "functional",
    description: "Conventional bullets with tighter vertical spacing.",
    accepts: "list",
    example: [
      ":::compact-list",
      "- Led cross-functional delivery",
      "- Improved operating rhythm",
      "- Mentored senior managers",
      ":::",
    ].join("\n"),
    preview: { renderer: "compact-list" },
    pdf: {
      cv: { renderer: "compact-list" },
      general: { renderer: "compact-list" },
    },
    plainText: "compact-list",
    ats: {
      safe: true,
      note: "Bullets use explicit text markers so extraction retains list structure.",
    },
    validate: validateList,
  },
}

export const BLOCK_LIST = Object.values(BLOCK_REGISTRY)

export function getBlockDefinition(id: string): BlockDefinition | undefined {
  return BLOCK_REGISTRY[id as BlockId]
}
