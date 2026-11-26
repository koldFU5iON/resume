import { describe, expect, it } from "vitest"
import type { CVDocumentContent } from "@/modules/cv/schema"
import { cvContentToDeskMarkdown } from "./from-cv-content"
import { validateDraftMarkdown } from "./validate"
import { buildStructureGuideFromMarkdown } from "./structure-guide"

const FULL: CVDocumentContent = {
  version: 1,
  sections: [
    { id: "h", type: "header", visible: true, data: { name: "Jane Doe", headline: "Operations Lead", subHeadline: "Fintech | Scale-ups", location: "London, UK", contact: { email: "jane@example.test", phone: "+44 7700 900123", linkedin: "linkedin.com/in/jane" } } },
    { id: "p", type: "profile", visible: true, data: { content: "Scales operations across teams." } },
    { id: "c", type: "competencies", visible: true, data: { items: ["Programme Management", " Process  Design "] } },
    { id: "e1", type: "experience", visible: true, data: { company: "Acme", titles: ["Head of Ops", "Ops Lead"], location: "London", duration: "2020 - 2024", description: "Ran the operational backbone.", outcomes: ["Cut cycle time 40%"] } },
    { id: "e2", type: "experience", visible: true, data: { company: "Beta", titles: ["Analyst"], subtitle: "Contract", location: "", duration: "2018 - 2020", description: "", outcomes: [] } },
    { id: "s", type: "skills", visible: true, data: { items: ["Stakeholder Management"] } },
    { id: "t", type: "tools", visible: true, data: { items: ["Jira", "Notion"] } },
    { id: "cert1", type: "certification", visible: true, data: { name: "PRINCE2", issuer: "Axelos", date: "2021" } },
    { id: "cert2", type: "certification", visible: true, data: { name: "Scrum Master" } },
    { id: "ed", type: "education", visible: true, data: { institution: "UCL", qualification: "BSc", field: "Economics", duration: "2014 - 2017", grade: "2:1" } },
    { id: "l", type: "languages", visible: true, data: { items: [{ name: "English", proficiency: "Native" }, { name: "French" }] } },
    { id: "x", type: "custom", visible: true, data: { heading: "Volunteering", subtype: "list", items: ["Mentor"] } },
    { id: "hidden", type: "skills", visible: false, data: { items: ["Secret skill"] } },
  ],
}

describe("cvContentToDeskMarkdown", () => {
  const markdown = cvContentToDeskMarkdown(FULL)

  it("writes Markdown the writing desk accepts as a draft, with no errors", () => {
    const result = validateDraftMarkdown(markdown)
    expect(result.issues.filter(issue => issue.severity === "error")).toEqual([])
    expect(result.ok).toBe(true)
  })

  it("never copies contact details: the header gets {{contact}}", () => {
    expect(markdown).toContain(":::header\n# Jane Doe\n## Operations Lead\n### Fintech | Scale-ups\nLondon, UK\n\n{{contact}}\n:::")
    expect(markdown).not.toMatch(/jane@example\.test|7700|linkedin\.com/)
  })

  it("groups repeated entries under one heading, in the CV's own order", () => {
    expect(markdown.match(/## Professional Experience/g)).toHaveLength(1)
    expect(markdown).toContain("### Acme\n**Head of Ops → Ops Lead** · London · 2020 - 2024\n\nRan the operational backbone.\n\n:::compact-list\n- Cut cycle time 40%\n:::")
    expect(markdown).toContain("### Beta\n**Analyst** · 2018 - 2020\n\n_Contract_")
    expect(markdown).toContain("## Certifications\n\n:::compact-list\n- **PRINCE2** — Axelos (2021)\n- **Scrum Master**\n:::")
    expect(markdown).toContain("### UCL\n**BSc, Economics** · 2014 - 2017 · 2:1")
    const headings = buildStructureGuideFromMarkdown(markdown).sections.map(s => s.heading)
    expect(headings).toEqual([
      "Header", "Professional Profile", "Core Competencies", "Professional Experience", "Skills", "Tools",
      "Certifications", "Education", "Languages", "Volunteering",
    ])
  })

  it("uses the desk's list blocks and tidies whitespace in items", () => {
    expect(markdown).toContain("## Core Competencies\n\n:::skills\n- Programme Management\n- Process Design\n:::")
    expect(markdown).toContain("## Tools\n\n:::inline-list\n- Jira\n- Notion\n:::")
    expect(markdown).toContain("## Languages\n\n:::inline-list\n- English (Native)\n- French\n:::")
    expect(markdown).toContain("## Volunteering\n\n- Mentor")
  })

  it("leaves out hidden and empty sections", () => {
    expect(markdown).not.toContain("Secret skill")
    expect(cvContentToDeskMarkdown({ version: 1, sections: [{ id: "s", type: "skills", visible: true, data: { items: [] } }] })).toBe("")
    expect(cvContentToDeskMarkdown({ version: 1, sections: [] })).toBe("")
  })
})

describe("buildStructureGuideFromMarkdown", () => {
  it("is the default structure without a master or with no sections", () => {
    expect(buildStructureGuideFromMarkdown(null).source).toBe("default")
    expect(buildStructureGuideFromMarkdown("Just text").source).toBe("default")
  })

  it("skips headings inside blocks and code fences and maps known headings to their keys", () => {
    const guide = buildStructureGuideFromMarkdown([
      ":::header", "# Jane", "## Headline inside the header", "{{contact}}", ":::",
      "", "## Professional Profile", "", "```", "## Not a section", "```", "", "## Selected Work ##",
    ].join("\n"))
    expect(guide).toEqual({
      source: "master-cv",
      sections: [
        { key: "header", heading: "Header" },
        { key: "profile", heading: "Professional Profile" },
        { key: "selected-work", heading: "Selected Work" },
      ],
    })
  })
})

describe("cvContentToDeskMarkdown with contact: keep", () => {
  it("keeps the CV's own contact line for the owner's copy, and still validates", () => {
    const markdown = cvContentToDeskMarkdown(FULL, { contact: "keep" })
    expect(markdown).toContain(":::header\n# Jane Doe\n## Operations Lead\n### Fintech | Scale-ups\nLondon, UK\n\njane@example.test | +44 7700 900123 | linkedin.com/in/jane\n:::")
    expect(markdown).not.toContain("{{contact}}")
    expect(validateDraftMarkdown(markdown).ok).toBe(true)
  })

  it("leaves the contact line out when the CV has none", () => {
    const markdown = cvContentToDeskMarkdown(
      { version: 1, sections: [{ id: "h", type: "header", visible: true, data: { name: "Jane", headline: "", contact: {} } }] },
      { contact: "keep" },
    )
    expect(markdown).toBe(":::header\n# Jane\n:::")
  })
})
