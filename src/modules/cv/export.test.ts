import { describe, expect, it } from "vitest"
import { toMarkdown, toText, sectionToPlainText } from "./export"
import type { CVDocumentContent, CVSection } from "./schema"

const doc: CVDocumentContent = {
  version: 1,
  sections: [
    {
      id: "h", type: "header", visible: true,
      data: { name: "Devon Stanton", headline: "Senior PM", contact: { email: "d@d.com", phone: "+44 7700" } },
    },
    {
      id: "p", type: "profile", visible: true,
      data: { content: "**Experienced** PM with 15+ years." },
    },
    {
      id: "e1", type: "experience", visible: true,
      data: { company: "Unity", titles: ["Senior PM", "PM"], location: "Remote", duration: "2019–2023", description: "Led delivery.", outcomes: ["40% faster cycles", "Saved $2M"] },
    },
    {
      id: "lang", type: "languages", visible: false,
      data: { items: [{ name: "English", proficiency: "native" }] },
    },
  ],
}

describe("toMarkdown", () => {
  it("includes name from header", () => {
    expect(toMarkdown(doc)).toContain("Devon Stanton")
  })

  it("includes experience company", () => {
    expect(toMarkdown(doc)).toContain("Unity")
  })

  it("includes promotion chain in titles", () => {
    expect(toMarkdown(doc)).toContain("Senior PM → PM")
  })

  it("prefixes outcomes with arrow", () => {
    expect(toMarkdown(doc)).toContain("→ 40% faster cycles")
  })

  it("includes the optional experience subtitle", () => {
    const doc: CVDocumentContent = {
      version: 1,
      sections: [{
        id: "e1", type: "experience", visible: true,
        data: { company: "Unity", titles: ["Senior PM", "PM"], location: "Remote", duration: "2019–2023", description: "Led delivery.", outcomes: [], subtitle: "Promoted to Senior PM in 2021" },
      }],
    }
    expect(toMarkdown(doc)).toContain("Promoted to Senior PM in 2021")
  })

  it("omits the subtitle line when absent", () => {
    const section: CVSection = {
      id: "e", type: "experience", visible: true,
      data: { company: "Acme", titles: ["PM"], location: "London", duration: "2020–2022", description: "Ran projects.", outcomes: [] },
    }
    expect(sectionToPlainText(section)).not.toContain("Promoted")
  })

  it("excludes hidden sections", () => {
    expect(toMarkdown(doc)).not.toContain("English")
  })
})

describe("toText", () => {
  it("strips markdown bold markers", () => {
    const text = toText(doc)
    expect(text).not.toContain("**")
    expect(text).toContain("Experienced PM")
  })
})

describe("sectionToPlainText", () => {
  it("serialises a competencies section", () => {
    const section: CVSection = {
      id: "c", type: "competencies", visible: true,
      data: { items: ["Stakeholder management", "Risk governance"] },
    }
    const text = sectionToPlainText(section)
    expect(text).toContain("Stakeholder management")
    expect(text).toContain("Risk governance")
  })
})

describe("toMarkdown — location line", () => {
  it('includes location between sub-headline and contact', () => {
    const doc: CVDocumentContent = {
      version: 1,
      sections: [{
        id: '1',
        type: 'header',
        visible: true,
        data: {
          name: 'Ada Lovelace',
          headline: 'Engineer',
          subHeadline: 'PhD',
          location: 'London · Willing to relocate',
          contact: { email: 'ada@example.com', phone: null, linkedin: null, website: null },
        },
      }],
    }
    const md = toMarkdown(doc)
    const lines = md.split('\n')
    const locationIdx = lines.findIndex(l => l.includes('London'))
    const contactIdx = lines.findIndex(l => l.includes('ada@example.com'))
    expect(locationIdx).toBeGreaterThan(-1)
    expect(locationIdx).toBeLessThan(contactIdx)
  })
})

describe("toMarkdown — custom sections", () => {
  it('serialises a custom text section to markdown', () => {
    const doc: CVDocumentContent = {
      version: 1,
      sections: [{
        id: '1',
        type: 'custom',
        visible: true,
        data: { heading: 'Publications', subtype: 'text', content: 'My paper on ML.', items: null },
      }],
    }
    const md = toMarkdown(doc)
    expect(md).toContain('## Publications')
    expect(md).toContain('My paper on ML.')
  })

  it('serialises a custom list section to markdown', () => {
    const doc: CVDocumentContent = {
      version: 1,
      sections: [{
        id: '2',
        type: 'custom',
        visible: true,
        data: { heading: 'Tools', subtype: 'list', content: null, items: ['Figma', 'Notion'] },
      }],
    }
    const md = toMarkdown(doc)
    expect(md).toContain('## Tools')
    expect(md).toContain('- Figma')
    expect(md).toContain('- Notion')
  })

  it('serialises a custom list section with empty items to markdown', () => {
    const doc: CVDocumentContent = {
      version: 1,
      sections: [{
        id: '3',
        type: 'custom',
        visible: true,
        data: { heading: 'Awards', subtype: 'list', content: null, items: [] },
      }],
    }
    const md = toMarkdown(doc)
    expect(md).toContain('## Awards')
  })
})

describe("sectionToPlainText — additional sections", () => {
  it("renders education", () => {
    const section: CVSection = {
      id: "edu", type: "education", visible: true,
      data: { institution: "Oxford", qualification: "BA", field: "History", duration: "2005–2008", grade: "First" },
    }
    const text = sectionToPlainText(section)
    expect(text).toContain("Oxford")
    expect(text).toContain("History")
    expect(text).toContain("First")
  })

  it("renders certification", () => {
    const section: CVSection = {
      id: "cert", type: "certification", visible: true,
      data: { name: "PMP", issuer: "PMI", date: "2021" },
    }
    const text = sectionToPlainText(section)
    expect(text).toContain("PMP")
    expect(text).toContain("PMI")
    expect(text).toContain("2021")
  })

  it("renders skills as comma-separated list", () => {
    const section: CVSection = {
      id: "sk", type: "skills", visible: true,
      data: { items: ["Stakeholder management", "Agile"] },
    }
    expect(sectionToPlainText(section)).toContain("Stakeholder management")
  })

  it("renders tools", () => {
    const section: CVSection = {
      id: "tools", type: "tools", visible: true,
      data: { items: ["Jira", "Confluence"] },
    }
    expect(sectionToPlainText(section)).toContain("Jira")
  })

  it("renders languages with proficiency", () => {
    const section: CVSection = {
      id: "lang", type: "languages", visible: true,
      data: { items: [{ name: "French", proficiency: "fluent" }] },
    }
    expect(sectionToPlainText(section)).toContain("French")
    expect(sectionToPlainText(section)).toContain("fluent")
  })

  it("experience with no outcomes produces no trailing blank line", () => {
    const section: CVSection = {
      id: "e", type: "experience", visible: true,
      data: { company: "Acme", titles: ["PM"], location: "London", duration: "2020–2022", description: "Ran projects.", outcomes: [] },
    }
    const md = sectionToPlainText(section)
    expect(md.endsWith("Ran projects.")).toBe(true)
  })
})
