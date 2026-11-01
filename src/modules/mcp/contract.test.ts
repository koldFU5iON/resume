import { describe, expect, it } from "vitest"
import { BLOCK_LIST } from "@/modules/writing-desk/markdown"
import { buildStructureGuide } from "@/modules/writing-desk/structure-guide"
import { buildWritingContract } from "./contract"

describe("buildWritingContract", () => {
  const contract = buildWritingContract(buildStructureGuide(null))

  it("includes every registered block id, label, description and example", () => {
    for (const block of BLOCK_LIST) {
      expect(contract).toContain(block.id)
      expect(contract).toContain(block.label)
      expect(contract).toContain(block.description)
      expect(contract).toContain(block.example)
    }
  })

  it("explicitly allows adding, dropping and reordering sections when justified", () => {
    expect(contract).toMatch(/adding, dropping and reordering sections is allowed when justified/i)
  })

  it("reflects a master CV's sections in the structure guide", () => {
    const guide = buildStructureGuide({
      sections: [
        { id: "1", type: "header", visible: true, data: {} },
        { id: "2", type: "capabilities", visible: true, data: {} },
      ],
    } as never)
    const text = buildWritingContract(guide)
    expect(text).toContain("Capabilities")
    expect(text).not.toContain("Core Competencies")
  })

  it("states the writing guidance, the supported-claims rule and block rejection", () => {
    expect(contract).toMatch(/3 to 5 lines/)
    expect(contract).toMatch(/reverse-chronological/i)
    expect(contract).toMatch(/categorised skills/i)
    expect(contract).toMatch(/only .*supported by the profile/i)
    expect(contract).toMatch(/unsupported .*:::.* blocks? (is|are) rejected/i)
  })
})
