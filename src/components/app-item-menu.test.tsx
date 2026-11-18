import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { legacyDocumentLinks } from "./app-item-menu"

describe("job menu: the writing desk replaces Generate CV and Create Cover Letter", () => {
  it("offers no way to generate: nothing for a job with no legacy documents", () => {
    expect(legacyDocumentLinks({})).toEqual([])
    expect(legacyDocumentLinks({ cvDocumentId: null, coverLetterDocumentId: null })).toEqual([])
  })

  it("keeps links to documents the legacy editors already made", () => {
    expect(legacyDocumentLinks({ cvDocumentId: "cv1", coverLetterDocumentId: "cl1" })).toEqual([
      { label: "View CV", href: "/dashboard/cv-builder/cv1" },
      { label: "View Cover Letter", href: "/dashboard/cover-letters/cl1" },
    ])
  })

  it("no job list or menu file links to the old generation routes or takes the generate callbacks", () => {
    const dir = "src/app/dashboard/job-applications/_components/"
    for (const f of ["src/components/app-item-menu.tsx", `${dir}job-row.tsx`, `${dir}job-row-card.tsx`, `${dir}job-group.tsx`, `${dir}job-list.tsx`]) {
      const src = readFileSync(f, "utf8")
      expect(src, f).not.toMatch(/cv-builder\/new|cover-letters\/new|onGenerateCV|onCreateCoverLetter|Generating CV/)
    }
  })
})
