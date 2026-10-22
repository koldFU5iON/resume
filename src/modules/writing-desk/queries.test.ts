import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    writingDeskDocument: { findFirst: vi.fn() },
    cVDocument: { findMany: vi.fn() },
    jobApplication: { findMany: vi.fn() },
  },
}))

import { prisma } from "@/lib/db"
import { getWritingDesk, listWritingDeskJobs, listWritingDeskSourceCVs } from "./queries"

const mockDeskFindFirst = vi.mocked(prisma.writingDeskDocument.findFirst)
const mockCVFindMany = vi.mocked(prisma.cVDocument.findMany)
const mockJobFindMany = vi.mocked(prisma.jobApplication.findMany)

describe("getWritingDesk", () => {
  beforeEach(() => vi.clearAllMocks())

  it("looks up a desk by both profile and job application", async () => {
    mockDeskFindFirst.mockResolvedValue(null)

    await expect(getWritingDesk("profile-1", "job-1")).resolves.toBeNull()

    expect(mockDeskFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId: "profile-1", jobApplicationId: "job-1" },
    }))
  })
})

describe("listWritingDeskSourceCVs", () => {
  beforeEach(() => vi.clearAllMocks())

  it("excludes generating CVs at the database boundary and preserves source provenance", async () => {
    mockCVFindMany.mockResolvedValue([
      {
        id: "master-cv",
        jobApplicationId: null,
        careerVerticalId: "vertical-1",
        jobTitle: "Ignored for master CV",
        company: "Acme",
        updatedAt: new Date("2026-03-04T00:00:00Z"),
      },
      {
        id: "previous-cv",
        jobApplicationId: "job-1",
        careerVerticalId: null,
        jobTitle: "Staff Engineer",
        company: "Acme",
        updatedAt: new Date("2026-03-03T00:00:00Z"),
      },
    ] as never)

    await expect(listWritingDeskSourceCVs("profile-1")).resolves.toEqual([
      { id: "master-cv", label: "Master CV", sourceType: "master-cv" },
      { id: "previous-cv", label: "CV - Staff Engineer at Acme", sourceType: "previous-cv" },
    ])

    expect(mockCVFindMany).toHaveBeenCalledWith({
      where: { profileId: "profile-1", status: { not: "generating" } },
      select: {
        id: true,
        jobApplicationId: true,
        careerVerticalId: true,
        jobTitle: true,
        company: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    })
  })
})

describe("listWritingDeskJobs", () => {
  beforeEach(() => vi.clearAllMocks())

  it("lists non-archived jobs with a summary of each desk", async () => {
    mockJobFindMany.mockResolvedValue([
      {
        id: "job-1",
        title: "Staff Engineer",
        company: "Acme",
        status: "in-progress",
        lastUpdated: new Date("2026-03-04T00:00:00Z"),
        writingDesk: {
          documentType: "cv",
          content: "# Jane Doe",
          updatedAt: new Date("2026-03-05T00:00:00Z"),
        },
      },
      {
        id: "job-2",
        title: "Engineer",
        company: null,
        status: "applied",
        lastUpdated: new Date("2026-03-03T00:00:00Z"),
        writingDesk: { documentType: null, content: "", updatedAt: new Date("2026-03-03T00:00:00Z") },
      },
      {
        id: "job-3",
        title: "Designer",
        company: "Globex",
        status: "not started",
        lastUpdated: new Date("2026-03-02T00:00:00Z"),
        writingDesk: null,
      },
    ] as never)

    await expect(listWritingDeskJobs("profile-1")).resolves.toEqual([
      {
        id: "job-1",
        title: "Staff Engineer",
        company: "Acme",
        status: "in-progress",
        documentType: "cv",
        hasContent: true,
        deskUpdatedAt: new Date("2026-03-05T00:00:00Z"),
      },
      {
        id: "job-2",
        title: "Engineer",
        company: null,
        status: "applied",
        documentType: null,
        hasContent: false,
        deskUpdatedAt: new Date("2026-03-03T00:00:00Z"),
      },
      {
        id: "job-3",
        title: "Designer",
        company: "Globex",
        status: "not started",
        documentType: null,
        hasContent: false,
        deskUpdatedAt: null,
      },
    ])

    expect(mockJobFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId: "profile-1", archivedAt: null },
      orderBy: { lastUpdated: "desc" },
    }))
  })
})
