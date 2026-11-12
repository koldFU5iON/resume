import { describe, expect, it } from "vitest"
import { WritingDeskDocumentNameSchema, suggestWritingDeskDocumentName } from "./schema"

describe("suggestWritingDeskDocumentName", () => {
  it("prefills the type's label", () => {
    expect(suggestWritingDeskDocumentName("cv", [])).toBe("CV")
    expect(suggestWritingDeskDocumentName("cover-letter", [])).toBe("Cover letter")
    expect(suggestWritingDeskDocumentName("interview-prep", [])).toBe("Interview prep")
  })

  it("calls Other documents notes (Note maps to Other)", () => {
    expect(suggestWritingDeskDocumentName("other", [])).toBe("Notes")
  })

  it("numbers the name when the job already has one, ignoring case and spaces", () => {
    expect(suggestWritingDeskDocumentName("cv", ["cv "])).toBe("CV 2")
    expect(suggestWritingDeskDocumentName("cv", ["CV", "CV 2", "CV 4"])).toBe("CV 3")
    expect(suggestWritingDeskDocumentName("cover-letter", ["CV"])).toBe("Cover letter")
  })

  it("always suggests a valid name", () => {
    const names = Array.from({ length: 12 }, (_, i) => (i === 0 ? "Interview prep" : `Interview prep ${i + 1}`))
    const suggested = suggestWritingDeskDocumentName("interview-prep", names)
    expect(suggested).toBe("Interview prep 13")
    expect(WritingDeskDocumentNameSchema.safeParse(suggested).success).toBe(true)
  })
})

describe("WritingDeskDocumentNameSchema", () => {
  it("trims, and rejects empty, over-long and control-character names", () => {
    expect(WritingDeskDocumentNameSchema.parse("  Notes ")).toBe("Notes")
    expect(WritingDeskDocumentNameSchema.safeParse(" ").success).toBe(false)
    expect(WritingDeskDocumentNameSchema.safeParse("a".repeat(81)).success).toBe(false)
    expect(WritingDeskDocumentNameSchema.safeParse("Line\nbreak").success).toBe(false)
  })
})
