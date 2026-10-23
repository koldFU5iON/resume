import { describe, expect, it } from "vitest"
import { BLOCK_LIST } from "./registry"
import { parseWritingDeskMarkdown } from "./parse"
import { profileForDocumentType } from "./types"

describe("block registry", () => {
  it.each(BLOCK_LIST)("$id has a canonical example that parses as itself", definition => {
    const children = parseWritingDeskMarkdown(definition.example)
    expect(children).toHaveLength(1)
    expect(children[0]).toMatchObject({
      type: "writingDeskBlock",
      blockId: definition.id,
    })
  })

  it.each(BLOCK_LIST)("$id has complete presentation metadata", definition => {
    expect(definition.label.trim()).not.toBe("")
    expect(definition.description.trim()).not.toBe("")
    expect(definition.preview.renderer).toBeTruthy()
    expect(definition.pdf.cv.renderer).toBeTruthy()
    expect(definition.pdf.general.renderer).toBeTruthy()
    expect(definition.plainText).toBeTruthy()
    expect(definition.ats.safe).toBe(true)
    expect(definition.ats.note?.trim()).not.toBe("")
  })

  it("maps document types to presentation profiles", () => {
    expect(profileForDocumentType("cv")).toBe("cv")
    expect(profileForDocumentType("cover-letter")).toBe("general")
    expect(profileForDocumentType("interview-prep")).toBe("general")
    expect(profileForDocumentType("other")).toBe("general")
    expect(profileForDocumentType(null)).toBe("general")
  })
})
