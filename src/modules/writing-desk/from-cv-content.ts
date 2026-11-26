// Converts a legacy structured CV (CVDocument.generatedContent, the CV
// Builder's JSON sections) into Writing Desk Markdown, in the same block
// shapes the CV generator writes: a :::header block with the {{contact}}
// placeholder, "## Section" headings, :::skills / :::inline-list /
// :::compact-list blocks. Used for the master CV moving into the writing
// desk (#469) and for any later "copy to writing desk".
//
// By default contact details are not copied: the header gets {{contact}},
// which the app fills in when the owner accepts a draft (the master CV
// copy-in, generated masters). `contact: "keep"` keeps the CV's own contact
// line instead, for the owner's own copy or view of their CV. Hidden
// sections are left out.
// Pure: no DB, no network.

import { CONTACT_PLACEHOLDER } from "@/modules/profile-map/contact"
import type { CVDocumentContent, CVSection } from "@/modules/cv/schema"

const oneLine = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim()

function listBlock(block: "skills" | "inline-list" | "compact-list", items: readonly string[]): string {
  const lines = items.map(oneLine).filter(Boolean).map(item => `- ${item}`)
  return lines.length > 0 ? `:::${block}\n${lines.join("\n")}\n:::` : ""
}

export type CvToDeskOptions = {
  /** "placeholder" (default): {{contact}}. "keep": the CV's own contact line, for the owner's copy or view. */
  contact?: "placeholder" | "keep"
}

function headerBlock(data: Extract<CVSection, { type: "header" }>["data"], options: CvToDeskOptions): string {
  const location = oneLine(data.location)
  const { email, phone, linkedin, website } = data.contact
  const contactLine = options.contact === "keep"
    ? [email, phone, linkedin, website].map(oneLine).filter(Boolean).join(" | ")
    : CONTACT_PLACEHOLDER
  return [
    ":::header",
    `# ${oneLine(data.name) || "Curriculum Vitae"}`,
    ...(oneLine(data.headline) ? [`## ${oneLine(data.headline)}`] : []),
    ...(oneLine(data.subHeadline) ? [`### ${oneLine(data.subHeadline)}`] : []),
    ...(location && contactLine ? [location, ""] : location ? [location] : []),
    ...(contactLine ? [contactLine] : []),
    ":::",
  ].join("\n")
}

function experienceEntry(data: Extract<CVSection, { type: "experience" }>["data"]): string {
  const titles = data.titles.map(oneLine).filter(Boolean).join(" → ")
  const meta = [oneLine(data.location), oneLine(data.duration)].filter(Boolean).join(" · ")
  const line = [titles ? `**${titles}**` : "", meta].filter(Boolean).join(" · ")
  const parts = [`### ${oneLine(data.company) || "Experience"}`]
  if (line) parts.push(line)
  if (oneLine(data.subtitle)) parts.push("", `_${oneLine(data.subtitle)}_`)
  if (data.description.trim()) parts.push("", data.description.trim())
  const outcomes = listBlock("compact-list", data.outcomes)
  if (outcomes) parts.push("", outcomes)
  return parts.join("\n")
}

function educationEntry(data: Extract<CVSection, { type: "education" }>["data"]): string {
  const qualification = [oneLine(data.qualification), oneLine(data.field)].filter(Boolean).join(", ")
  const meta = [oneLine(data.duration), oneLine(data.grade)].filter(Boolean).join(" · ")
  const line = [qualification ? `**${qualification}**` : "", meta].filter(Boolean).join(" · ")
  return [`### ${oneLine(data.institution) || "Education"}`, ...(line ? [line] : [])].join("\n")
}

function certificationItem(data: Extract<CVSection, { type: "certification" }>["data"]): string {
  const name = oneLine(data.name)
  if (!name) return ""
  return `**${name}**${oneLine(data.issuer) ? ` — ${oneLine(data.issuer)}` : ""}${oneLine(data.date) ? ` (${oneLine(data.date)})` : ""}`
}

/** Section types that repeat (one section per entry) and share one heading. */
const GROUPED_HEADING: Partial<Record<CVSection["type"], string>> = {
  experience: "Professional Experience",
  education: "Education",
  certification: "Certifications",
}

function singleSection(section: CVSection, options: CvToDeskOptions): string {
  switch (section.type) {
    case "header":
      return headerBlock(section.data, options)
    case "profile":
      return section.data.content.trim() ? `## Professional Profile\n\n${section.data.content.trim()}` : ""
    case "competencies": {
      const block = listBlock("skills", section.data.items)
      return block ? `## Core Competencies\n\n${block}` : ""
    }
    case "capabilities": {
      const block = listBlock("skills", section.data.items)
      return block ? `## Capabilities\n\n${block}` : ""
    }
    case "skills": {
      const block = listBlock("skills", section.data.items)
      return block ? `## Skills\n\n${block}` : ""
    }
    case "tools": {
      const block = listBlock("inline-list", section.data.items)
      return block ? `## Tools\n\n${block}` : ""
    }
    case "languages": {
      const items = section.data.items.map(l => (oneLine(l.proficiency) ? `${oneLine(l.name)} (${oneLine(l.proficiency)})` : oneLine(l.name)))
      const block = listBlock("inline-list", items)
      return block ? `## Languages\n\n${block}` : ""
    }
    case "custom": {
      const heading = oneLine(section.data.heading) || "Additional Information"
      if (section.data.subtype === "list") {
        const items = (section.data.items ?? []).map(oneLine).filter(Boolean)
        return items.length > 0 ? `## ${heading}\n\n${items.map(item => `- ${item}`).join("\n")}` : ""
      }
      const text = (section.data.content ?? "").trim()
      return text ? `## ${heading}\n\n${text}` : ""
    }
    default:
      return ""
  }
}

/** The CV as Writing Desk Markdown, in its own section order. Empty string when nothing visible has content. */
export function cvContentToDeskMarkdown(content: CVDocumentContent, options: CvToDeskOptions = {}): string {
  const visible = content.sections.filter(s => s.visible)
  const pieces: string[] = []
  for (let i = 0; i < visible.length; i++) {
    const section = visible[i]
    const heading = GROUPED_HEADING[section.type]
    if (!heading) {
      const piece = singleSection(section, options)
      if (piece) pieces.push(piece)
      continue
    }
    // A run of the same repeating type becomes one section under one heading.
    const run: CVSection[] = [section]
    while (i + 1 < visible.length && visible[i + 1].type === section.type) run.push(visible[++i])
    if (section.type === "certification") {
      const items = run.map(s => (s.type === "certification" ? certificationItem(s.data) : "")).filter(Boolean)
      const block = listBlock("compact-list", items)
      if (block) pieces.push(`## ${heading}\n\n${block}`)
      continue
    }
    const entries = run
      .map(s => (s.type === "experience" ? experienceEntry(s.data) : s.type === "education" ? educationEntry(s.data) : ""))
      .filter(Boolean)
    if (entries.length > 0) pieces.push([`## ${heading}`, ...entries].join("\n\n"))
  }
  return pieces.join("\n\n").trim()
}
