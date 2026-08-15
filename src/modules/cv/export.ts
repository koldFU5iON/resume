import type { CVDocumentContent, CVSection } from "./schema"

export function toMarkdown(doc: CVDocumentContent): string {
  return doc.sections
    .filter(s => s.visible)
    .map(sectionToMarkdown)
    .filter(Boolean)
    .join("\n\n")
}

export function toText(doc: CVDocumentContent): string {
  return toMarkdown(doc).replace(/[*_`#]/g, "")
}

export function sectionToPlainText(section: CVSection): string {
  return sectionToMarkdown(section).replace(/[*_`#]/g, "")
}

function sectionToMarkdown(section: CVSection): string {
  switch (section.type) {
    case "header": {
      const { name, headline, subHeadline, location, contact } = section.data
      const contactLine = [contact.email, contact.phone, contact.linkedin, contact.website]
        .filter(Boolean).join(" · ")
      return [
        `# ${name}`,
        headline,
        subHeadline,
        location,
        contactLine,
      ].filter(Boolean).join("\n")
    }
    case "profile":
      return `## Professional Profile\n\n${section.data.content}`
    case "competencies":
      return `## Core Competencies\n\n${section.data.items.map(i => `- ${i}`).join("\n")}`
    case "capabilities":
      return `## Capabilities\n\n${section.data.items.map(i => `- ${i}`).join("\n")}`
    case "experience": {
      const { company, titles, subtitle, location, duration, description, outcomes } = section.data
      const lines = [
        `### ${company}`,
        `_${titles.join(" → ")}_`,
        ...(subtitle ? [`_${subtitle}_`] : []),
        `${location} · ${duration}`,
        "",
        description,
      ]
      if (outcomes.length > 0) {
        lines.push("", ...outcomes.map(o => `→ ${o}`))
      }
      return lines.join("\n")
    }
    case "education": {
      const { institution, qualification, field, duration, grade } = section.data
      return [
        `### ${institution}`,
        `${qualification}${field ? ` · ${field}` : ""}`,
        `${duration}${grade ? ` · ${grade}` : ""}`,
      ].join("\n")
    }
    case "certification": {
      const { name, issuer, date } = section.data
      return `- **${name}**${issuer ? ` — ${issuer}` : ""}${date ? ` (${date})` : ""}`
    }
    case "skills":
      return `## Skills\n\n${section.data.items.join(", ")}`
    case "tools":
      return `## Tools\n\n${section.data.items.join(", ")}`
    case "languages":
      return `## Languages\n\n${section.data.items.map(l => l.proficiency ? `${l.name} (${l.proficiency})` : l.name).join(", ")}`
    case "custom": {
      const { heading, subtype, content, items } = section.data
      if (subtype === 'list' && items && items.length > 0) {
        return `## ${heading}\n\n${items.map(i => `- ${i}`).join("\n")}`
      }
      return `## ${heading}\n\n${content ?? ''}`
    }
  }
}
