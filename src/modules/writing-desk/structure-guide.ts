import type { CVDocumentContent } from "@/modules/cv/schema"

export type StructureGuide = {
  source: "master-cv" | "default"
  sections: Array<{ key: string; heading: string }>
}

export const DEFAULT_CV_STRUCTURE: StructureGuide["sections"] = [
  { key: "header", heading: "Header" },
  { key: "profile", heading: "Professional Profile" },
  { key: "competencies", heading: "Core Competencies" },
  { key: "experience", heading: "Professional Experience" },
  { key: "tools", heading: "Tools" },
  { key: "skills", heading: "Skills" },
  { key: "certification", heading: "Certifications" },
  { key: "education", heading: "Education" },
  { key: "languages", heading: "Languages" },
]

const TYPE_HEADINGS: Record<string, string> = {
  header: "Header",
  profile: "Professional Profile",
  competencies: "Core Competencies",
  capabilities: "Capabilities",
  experience: "Professional Experience",
  education: "Education",
  certification: "Certifications",
  skills: "Skills",
  tools: "Tools",
  languages: "Languages",
}

export function buildStructureGuide(master: CVDocumentContent | null): StructureGuide {
  const sections: StructureGuide["sections"] = []
  for (const section of master?.sections ?? []) {
    if (!section.visible) continue
    const heading = section.type === "custom" ? section.data.heading : TYPE_HEADINGS[section.type]
    if (heading) sections.push({ key: section.type, heading })
  }
  if (sections.length === 0) return { source: "default", sections: DEFAULT_CV_STRUCTURE }
  return { source: "master-cv", sections }
}

const HEADING_KEYS: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_HEADINGS).map(([key, heading]) => [heading.toLowerCase(), key]),
)

const BLOCK_OPENER = /^ {0,3}:{3,}[A-Za-z][\w-]*/
const BLOCK_CLOSER = /^ {0,3}:{3,}[ \t]*$/
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})/

function headingKey(heading: string): string {
  return HEADING_KEYS[heading.toLowerCase()] ?? (heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section")
}

/**
 * The structure of a Writing Desk Markdown master CV (#469): the header when
 * it has a :::header block, then each top-level "## " heading in order (lines
 * inside blocks and code fences are skipped, so a header's "## headline" is
 * not a section). The default structure when there is no master or it has
 * no sections.
 */
export function buildStructureGuideFromMarkdown(markdown: string | null): StructureGuide {
  const sections: StructureGuide["sections"] = []
  let depth = 0
  let fenced = false
  for (const line of (markdown ?? "").split(/\r?\n/)) {
    if (CODE_FENCE.test(line)) { fenced = !fenced; continue }
    if (fenced) continue
    if (BLOCK_CLOSER.test(line)) { depth = Math.max(0, depth - 1); continue }
    if (BLOCK_OPENER.test(line)) {
      if (depth === 0 && /^ {0,3}:{3,}header\b/.test(line) && !sections.some(s => s.key === "header")) {
        sections.push({ key: "header", heading: "Header" })
      }
      depth++
      continue
    }
    if (depth > 0) continue
    const match = /^##[ \t]+(.+?)[ \t#]*$/.exec(line)
    if (match) sections.push({ key: headingKey(match[1].trim()), heading: match[1].trim() })
  }
  if (sections.length === 0) return { source: "default", sections: DEFAULT_CV_STRUCTURE }
  return { source: "master-cv", sections }
}
