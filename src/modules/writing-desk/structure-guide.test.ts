import { describe, expect, it } from "vitest"
import type { CVDocumentContent } from "@/modules/cv/schema"
import { buildStructureGuide, DEFAULT_CV_STRUCTURE } from "./structure-guide"

describe("buildStructureGuide", () => {
  it("returns the default for a null master", () => {
    expect(buildStructureGuide(null)).toEqual({ source: "default", sections: DEFAULT_CV_STRUCTURE })
  })

  it("returns the default for an empty master", () => {
    expect(buildStructureGuide({ sections: [] } as unknown as CVDocumentContent).source).toBe("default")
  })

  it("default lists the standard headings in order", () => {
    expect(DEFAULT_CV_STRUCTURE.map(s => s.heading)).toEqual([
      "Header", "Professional Profile", "Core Competencies", "Professional Experience",
      "Tools", "Skills", "Certifications", "Education", "Languages",
    ])
  })

  it("maps visible master sections in order, using custom headings", () => {
    const master = {
      sections: [
        { id: "1", type: "capabilities", visible: true, data: {} },
        { id: "2", type: "education", visible: false, data: {} },
        { id: "3", type: "custom", visible: true, data: { heading: "Publications" } },
      ],
    } as unknown as CVDocumentContent
    expect(buildStructureGuide(master)).toEqual({
      source: "master-cv",
      sections: [
        { key: "capabilities", heading: "Capabilities" },
        { key: "custom", heading: "Publications" },
      ],
    })
  })
})
