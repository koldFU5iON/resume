import { describe, expect, it } from "vitest"
import { CVDocumentContentSchema, parseCVContent, mergeSectionData } from "./schema"

const headerSection = {
  id: "header",
  type: "header" as const,
  visible: true,
  data: { name: "Devon", headline: "Senior PM", contact: {} },
}

describe("CVDocumentContentSchema", () => {
  it("parses a minimal valid document", () => {
    const doc = { version: 1, sections: [] }
    expect(CVDocumentContentSchema.parse(doc)).toEqual(doc)
  })

  it("parses a document with a header section", () => {
    const doc = { version: 1, sections: [headerSection] }
    expect(CVDocumentContentSchema.parse(doc).sections).toHaveLength(1)
  })

  it("header accepts subHeadline when present", () => {
    const withSub = { ...headerSection, data: { ...headerSection.data, subHeadline: "AI & Product" } }
    expect(() => CVDocumentContentSchema.parse({ version: 1, sections: [withSub] })).not.toThrow()
  })

  it("rejects version 2", () => {
    expect(() => CVDocumentContentSchema.parse({ version: 2, sections: [] })).toThrow()
  })

  it("rejects an unknown section type", () => {
    const bad = { version: 1, sections: [{ id: "x", type: "unknown", visible: true, data: {} }] }
    expect(() => CVDocumentContentSchema.parse(bad)).toThrow()
  })

  it("parses an experience section with multiple titles", () => {
    const doc = {
      version: 1,
      sections: [{
        id: "e1", type: "experience", visible: true,
        data: { company: "Unity", titles: ["Senior PM", "PM"], location: "Remote", duration: "2019–2023", description: "Led delivery.", outcomes: ["40% faster"] },
      }],
    }
    expect(CVDocumentContentSchema.parse(doc).sections[0].type).toBe("experience")
  })

  it("experience subtitle is optional and preserved when present", () => {
    const doc = {
      version: 1,
      sections: [{
        id: "e1", type: "experience", visible: true,
        data: { company: "Unity", titles: ["Senior PM"], location: "Remote", duration: "2019–2023", description: "Led delivery.", outcomes: [], subtitle: "Promoted in 2021" },
      }],
    }
    const parsed = CVDocumentContentSchema.parse(doc)
    if (parsed.sections[0].type === 'experience') {
      expect(parsed.sections[0].data.subtitle).toBe("Promoted in 2021")
    }
  })
})

describe("parseCVContent", () => {
  it("returns empty doc for empty object string", () => {
    expect(parseCVContent("{}")).toEqual({ version: 1, sections: [] })
  })

  it("returns empty doc for invalid JSON", () => {
    expect(parseCVContent("not-json")).toEqual({ version: 1, sections: [] })
  })

  it("parses a valid serialised document", () => {
    const doc = { version: 1, sections: [headerSection] }
    expect(parseCVContent(JSON.stringify(doc)).sections).toHaveLength(1)
  })

  it('parses a custom text section', () => {
    const raw = JSON.stringify({
      version: 1,
      sections: [{
        id: 'abc',
        type: 'custom',
        visible: true,
        data: { heading: 'Publications', subtype: 'text', content: 'My paper.', items: null },
      }],
    })
    const result = parseCVContent(raw)
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0].type).toBe('custom')
  })

  it('parses a custom list section', () => {
    const raw = JSON.stringify({
      version: 1,
      sections: [{
        id: 'xyz',
        type: 'custom',
        visible: true,
        data: { heading: 'Tools', subtype: 'list', content: null, items: ['Figma', 'Notion'] },
      }],
    })
    const result = parseCVContent(raw)
    expect(result.sections[0].type).toBe('custom')
    if (result.sections[0].type === 'custom') {
      expect(result.sections[0].data.items).toEqual(['Figma', 'Notion'])
    }
  })

  it('salvages valid sections when one section is corrupt (coach wrote invalid data)', () => {
    const raw = JSON.stringify({
      version: 1,
      sections: [
        headerSection,
        { id: 'exp', type: 'experience', visible: true, data: { company: 'X', titles: [], location: '', duration: '', description: '' } },
      ],
    })
    const result = parseCVContent(raw)
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0].id).toBe('header')
  })
})

describe("mergeSectionData", () => {
  const exp = {
    id: 'exp',
    type: 'experience' as const,
    visible: true,
    data: {
      company: 'Acme',
      titles: ['PM'],
      location: 'Remote',
      duration: '2020–2024',
      description: 'Built things.',
      outcomes: ['Shipped 10x'],
    },
  }

  it('fills missing declared fields from the existing section (no data loss)', () => {
    // The LLM often proposes only the field it changed, omitting required arrays.
    const merged = mergeSectionData(exp, { description: 'Rebuilt everything.' })
    expect(merged.data).toMatchObject({
      company: 'Acme',
      description: 'Rebuilt everything.',
      outcomes: ['Shipped 10x'],
    })
    expect(merged.data).toBeTypeOf('object')
  })

  it('throws instead of persisting malformed proposals', () => {
    expect(() => mergeSectionData(exp, { outcomes: 'not-an-array' })).toThrow()
  })

  it('preserves id, type and visible from the existing section', () => {
    const merged = mergeSectionData(exp, { description: 'New.' })
    expect(merged.id).toBe('exp')
    expect(merged.type).toBe('experience')
    expect(merged.visible).toBe(true)
  })
})
