import { describe, it, expect } from "vitest"
import {
  activeJobDocument,
  isJobDeepDivePath,
  jobDocumentCreateLinks,
  jobDocumentLinks,
  jobWritingDeskHref,
  nextCompactState,
  withCurrentDocument,
  writingDeskDocumentHref,
  writingDeskPdfHref,
  type JobDocumentAssets,
} from "./workspace-nav"

const none: JobDocumentAssets = {
  jobId: "job1",
  cvDocumentId: null,
  coverLetterDocumentId: null,
  interviewPrepSessionId: null,
  writingDesks: [],
}
const all: JobDocumentAssets = {
  ...none,
  cvDocumentId: "cv1",
  coverLetterDocumentId: "cl1",
  interviewPrepSessionId: "prep1",
  writingDesks: [{ id: "desk1", name: "CV", documentType: "cv" }],
}
const several: JobDocumentAssets = {
  ...none,
  writingDesks: [
    { id: "deskA", name: "CV for recruiters", documentType: "cv" },
    { id: "deskB", name: "CV", documentType: "cv" },
    { id: "deskN", name: "Interview notes", documentType: "other" },
    { id: "deskU", name: "Untitled document", documentType: null },
  ],
}

describe("jobDocumentLinks", () => {
  it("always starts with the Job Description and a Writing Desk entry", () => {
    expect(jobDocumentLinks(none).map((l) => l.kind)).toEqual(["description", "writing-desk"])
  })

  it("points a job with no document at the job-scoped URL, which creates its first", () => {
    const desk = jobDocumentLinks(none)[1]
    expect(desk).toMatchObject({ key: "writing-desk", label: "Writing Desk", href: jobWritingDeskHref("job1") })
    expect(desk.href).toBe("/dashboard/job-applications/view/job1/writing")
  })

  it("gives each named document its own tab, in the given (oldest-first) order, at its stable URL", () => {
    const desks = jobDocumentLinks(several).filter((l) => l.kind === "writing-desk")
    expect(desks.map((l) => l.label)).toEqual(["CV for recruiters", "CV", "Interview notes", "Untitled document"])
    expect(desks.map((l) => l.href)).toEqual([
      "/dashboard/job-applications/view/job1/writing/deskA",
      "/dashboard/job-applications/view/job1/writing/deskB",
      "/dashboard/job-applications/view/job1/writing/deskN",
      "/dashboard/job-applications/view/job1/writing/deskU",
    ])
    expect(new Set(jobDocumentLinks(several).map((l) => l.key)).size).toBe(5)
  })

  it("adds the type as detail only when the name doesn't already say it", () => {
    const desks = jobDocumentLinks(several).filter((l) => l.kind === "writing-desk")
    expect(desks.map((l) => l.detail)).toEqual(["CV", undefined, "Other", undefined])
  })

  it("keeps the agreed order and the existing editor routes", () => {
    const links = jobDocumentLinks(all)
    expect(links.map((l) => l.kind)).toEqual(["description", "writing-desk", "cv", "cover-letter", "interview-prep"])
    expect(links.map((l) => l.href)).toEqual([
      "/dashboard/job-applications/view/job1",
      "/dashboard/job-applications/view/job1/writing/desk1",
      "/dashboard/cv-builder/cv1",
      "/dashboard/cover-letters/cl1",
      "/dashboard/interview-prep/prep1",
    ])
    expect(links[1].label).toBe("CV")
    expect(links[1].detail).toBeUndefined()
  })
})

describe("jobDocumentCreateLinks", () => {
  it("offers the existing creation flows only for missing assets", () => {
    expect(jobDocumentCreateLinks(none).map((l) => l.href)).toEqual([
      "/dashboard/cv-builder/new?jobId=job1",
      "/dashboard/cover-letters/new?jobId=job1",
      "/dashboard/interview-prep/new?jobId=job1",
    ])
    expect(jobDocumentCreateLinks(all)).toEqual([])
  })
})

describe("activeJobDocument", () => {
  const links = jobDocumentLinks(all)

  it("matches the hub only exactly", () => {
    expect(activeJobDocument("/dashboard/job-applications/view/job1", links)).toBe("description")
    expect(activeJobDocument("/dashboard/job-applications/view/job1/", links)).toBe("description")
    expect(activeJobDocument("/dashboard/job-applications/view/job1/deep-dive", links)).toBeNull()
  })

  it("matches documents and their sub-routes", () => {
    expect(activeJobDocument("/dashboard/job-applications/view/job1/writing/desk1", links)).toBe("writing-desk:desk1")
    expect(activeJobDocument("/dashboard/cover-letters/cl1/guide", links)).toBe("cover-letter")
    expect(activeJobDocument("/dashboard/cv-builder/cv1", links)).toBe("cv")
  })

  it("does not match a different document with a shared id prefix", () => {
    expect(activeJobDocument("/dashboard/cv-builder/cv10", links)).toBeNull()
    expect(activeJobDocument("/dashboard/job-applications/view/job1/writing/desk10", links)).toBeNull()
  })

  it("marks exactly the open document when the job has several", () => {
    const many = jobDocumentLinks(several)
    expect(activeJobDocument("/dashboard/job-applications/view/job1/writing/deskB", many)).toBe("writing-desk:deskB")
    expect(activeJobDocument("/dashboard/job-applications/view/job1/writing/deskN/", many)).toBe("writing-desk:deskN")
  })

  it("marks the Writing Desk entry on the job-scoped URL of a job with no document", () => {
    expect(activeJobDocument("/dashboard/job-applications/view/job1/writing", jobDocumentLinks(none))).toBe("writing-desk")
  })
})

describe("isJobDeepDivePath", () => {
  it("matches the report and its runs", () => {
    expect(isJobDeepDivePath("/dashboard/job-applications/view/job1/deep-dive", "job1")).toBe(true)
    expect(isJobDeepDivePath("/dashboard/job-applications/view/job1", "job1")).toBe(false)
  })
})

describe("nextCompactState", () => {
  const room = 2000

  it("compacts only past the upper threshold", () => {
    expect(nextCompactState(false, { scrollTop: 60, maxScroll: room, pinned: false })).toBe(false)
    expect(nextCompactState(false, { scrollTop: 90, maxScroll: room, pinned: false })).toBe(true)
  })

  it("stays compact between the thresholds (no jitter)", () => {
    expect(nextCompactState(true, { scrollTop: 50, maxScroll: room, pinned: false })).toBe(true)
    expect(nextCompactState(true, { scrollTop: 20, maxScroll: room, pinned: false })).toBe(false)
  })

  it("doesn't compact content too short to stay past the threshold", () => {
    expect(nextCompactState(false, { scrollTop: 100, maxScroll: 150, pinned: false })).toBe(false)
  })

  it("keeps the controls open after an explicit expand", () => {
    expect(nextCompactState(false, { scrollTop: 400, maxScroll: room, pinned: true })).toBe(false)
  })
})

describe("withCurrentDocument", () => {
  it("points the current kind's tab at the document on screen, not the newest", () => {
    const assets = withCurrentDocument(all, { kind: "cv", id: "old-cv" })
    const links = jobDocumentLinks(assets)
    const cv = links.find((l) => l.kind === "cv")
    expect(cv?.href).toBe("/dashboard/cv-builder/old-cv")
    expect(activeJobDocument("/dashboard/cv-builder/old-cv", links)).toBe("cv")
    expect(assets.coverLetterDocumentId).toBe(all.coverLetterDocumentId)
  })
  it("is a no-op without a current document", () => {
    expect(withCurrentDocument(all)).toBe(all)
  })
})

describe("Writing Desk document URLs", () => {
  it("address documents by id, under their job", () => {
    expect(writingDeskDocumentHref("job1", "deskA")).toBe("/dashboard/job-applications/view/job1/writing/deskA")
    expect(writingDeskPdfHref("job1", "deskA")).toBe("/api/writing-desk/job1/documents/deskA/pdf")
  })
})
