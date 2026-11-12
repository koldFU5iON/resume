import { describe, it, expect } from "vitest"
import {
  activeJobDocument,
  isJobDeepDivePath,
  jobDocumentCreateLinks,
  jobDocumentLinks,
  nextCompactState,
  withCurrentDocument,
  type JobDocumentAssets,
} from "./workspace-nav"

const none: JobDocumentAssets = {
  jobId: "job1",
  cvDocumentId: null,
  coverLetterDocumentId: null,
  interviewPrepSessionId: null,
  writingDeskType: null,
}
const all: JobDocumentAssets = {
  ...none,
  cvDocumentId: "cv1",
  coverLetterDocumentId: "cl1",
  interviewPrepSessionId: "prep1",
  writingDeskType: "cv",
}

describe("jobDocumentLinks", () => {
  it("always starts with the Job Description and the Writing Desk", () => {
    expect(jobDocumentLinks(none).map((l) => l.kind)).toEqual(["description", "writing-desk"])
  })

  it("keeps the agreed order and the existing editor routes", () => {
    const links = jobDocumentLinks(all)
    expect(links.map((l) => l.kind)).toEqual(["description", "writing-desk", "cv", "cover-letter", "interview-prep"])
    expect(links.map((l) => l.href)).toEqual([
      "/dashboard/job-applications/view/job1",
      "/dashboard/job-applications/view/job1/writing",
      "/dashboard/cv-builder/cv1",
      "/dashboard/cover-letters/cl1",
      "/dashboard/interview-prep/prep1",
    ])
    expect(links[1].detail).toBe("CV")
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
    expect(activeJobDocument("/dashboard/job-applications/view/job1/writing", links)).toBe("writing-desk")
    expect(activeJobDocument("/dashboard/cover-letters/cl1/guide", links)).toBe("cover-letter")
    expect(activeJobDocument("/dashboard/cv-builder/cv1", links)).toBe("cv")
  })

  it("does not match a different document with a shared id prefix", () => {
    expect(activeJobDocument("/dashboard/cv-builder/cv10", links)).toBeNull()
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
