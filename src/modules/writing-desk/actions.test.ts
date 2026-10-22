import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/session", () => ({
  requireProfile: vi.fn().mockResolvedValue({ profile: { id: "profile-1" } }),
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    writingDeskDocument: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
    },
    jobApplication: { findFirst: vi.fn() },
    cVDocument: { findFirst: vi.fn() },
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/modules/cv/schema", () => ({ parseCVContent: vi.fn() }))
vi.mock("@/modules/cv/export", () => ({ toMarkdown: vi.fn() }))

import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { parseCVContent } from "@/modules/cv/schema"
import { toMarkdown } from "@/modules/cv/export"
import {
  getOrCreateWritingDesk,
  setWritingDeskDocumentType,
  setWritingDeskSource,
  updateWritingDeskContent,
} from "./actions"

const mockDeskUpsert = vi.mocked(prisma.writingDeskDocument.upsert)
const mockDeskUpdateMany = vi.mocked(prisma.writingDeskDocument.updateMany)
const mockDeskFindFirst = vi.mocked(prisma.writingDeskDocument.findFirst)
const mockJobFindFirst = vi.mocked(prisma.jobApplication.findFirst)
const mockCVFindFirst = vi.mocked(prisma.cVDocument.findFirst)
const mockParseCVContent = vi.mocked(parseCVContent)
const mockToMarkdown = vi.mocked(toMarkdown)
const mockRevalidatePath = vi.mocked(revalidatePath)

describe("getOrCreateWritingDesk", () => {
  beforeEach(() => vi.clearAllMocks())

  it("creates or retrieves a desk only after finding the owned job", async () => {
    mockJobFindFirst.mockResolvedValue({ id: "job-1" } as never)
    mockDeskUpsert.mockResolvedValue({ id: "desk-1" } as never)

    await expect(getOrCreateWritingDesk("job-1")).resolves.toEqual({ id: "desk-1" })

    expect(mockJobFindFirst).toHaveBeenCalledWith({
      where: { id: "job-1", profileId: "profile-1" },
      select: { id: true },
    })
    expect(mockDeskUpsert).toHaveBeenCalledWith({
      where: { jobApplicationId: "job-1" },
      update: {},
      create: { profileId: "profile-1", jobApplicationId: "job-1" },
      select: { id: true },
    })
  })

  it("does not create a desk for another profile's or missing job", async () => {
    mockJobFindFirst.mockResolvedValue(null)

    await expect(getOrCreateWritingDesk("job-other-profile")).rejects.toThrow("Job not found")

    expect(mockDeskUpsert).not.toHaveBeenCalled()
  })
})

describe("updateWritingDeskContent", () => {
  beforeEach(() => vi.clearAllMocks())

  it("saves content only when the owned document revision matches", async () => {
    mockDeskUpdateMany.mockResolvedValue({ count: 1 } as never)

    await expect(updateWritingDeskContent("desk-1", "Updated draft", 4)).resolves.toEqual({
      ok: true,
      revision: 5,
    })

    expect(mockDeskUpdateMany).toHaveBeenCalledWith({
      where: { id: "desk-1", profileId: "profile-1", revision: 4 },
      data: { content: "Updated draft", revision: { increment: 1 } },
    })
  })

  it("returns the current owned content and revision on a stale save", async () => {
    mockDeskUpdateMany.mockResolvedValue({ count: 0 } as never)
    mockDeskFindFirst.mockResolvedValue({
      id: "desk-1",
      jobApplicationId: "job-1",
      revision: 6,
      content: "Newer saved draft",
    } as never)

    await expect(updateWritingDeskContent("desk-1", "Stale draft", 5)).resolves.toEqual({
      ok: false,
      reason: "conflict",
      revision: 6,
      content: "Newer saved draft",
    })

    expect(mockDeskFindFirst).toHaveBeenCalledWith({
      where: { id: "desk-1", profileId: "profile-1" },
      select: { id: true, jobApplicationId: true, revision: true, content: true },
    })
  })
})

describe("setWritingDeskDocumentType", () => {
  beforeEach(() => vi.clearAllMocks())

  it("updates an owned document type with its expected revision and revalidates its job", async () => {
    mockDeskUpdateMany.mockResolvedValue({ count: 1 } as never)
    mockDeskFindFirst.mockResolvedValue({
      id: "desk-1",
      jobApplicationId: "job-1",
      revision: 3,
      content: "",
    } as never)

    await expect(setWritingDeskDocumentType("desk-1", "cover-letter", 2)).resolves.toEqual({
      ok: true,
      revision: 3,
    })

    expect(mockDeskUpdateMany).toHaveBeenCalledWith({
      where: { id: "desk-1", profileId: "profile-1", revision: 2 },
      data: { documentType: "cover-letter", revision: { increment: 1 } },
    })
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/job-applications/view/job-1/writing")
  })

  it("does not write an invalid document type", async () => {
    await expect(setWritingDeskDocumentType("desk-1", "memo" as never, 2)).rejects.toThrow()

    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
  })
})

describe("setWritingDeskSource", () => {
  beforeEach(() => vi.clearAllMocks())

  it("copies an owned master CV and records its provenance", async () => {
    const cvContent = { version: 1, sections: [] }
    mockCVFindFirst.mockResolvedValue({
      id: "cv-master",
      generatedContent: "stored-cv-content",
      jobApplicationId: null,
      careerVerticalId: "vertical-1",
      jobTitle: "Operations Lead",
      company: "Acme",
      updatedAt: new Date("2026-03-04T00:00:00Z"),
    } as never)
    mockParseCVContent.mockReturnValue(cvContent as never)
    mockToMarkdown.mockReturnValue("# Copied master CV")
    mockDeskUpdateMany.mockResolvedValue({ count: 1 } as never)

    await expect(setWritingDeskSource("desk-1", "cv-master", 7)).resolves.toEqual({
      ok: true,
      revision: 8,
    })

    expect(mockCVFindFirst).toHaveBeenCalledWith({
      where: { id: "cv-master", profileId: "profile-1" },
      select: {
        id: true,
        generatedContent: true,
        jobApplicationId: true,
        careerVerticalId: true,
        jobTitle: true,
        company: true,
        updatedAt: true,
      },
    })
    expect(mockParseCVContent).toHaveBeenCalledWith("stored-cv-content")
    expect(mockToMarkdown).toHaveBeenCalledWith(cvContent)
    expect(mockDeskUpdateMany).toHaveBeenCalledWith({
      where: { id: "desk-1", profileId: "profile-1", revision: 7 },
      data: {
        content: "# Copied master CV",
        sourceType: "master-cv",
        sourceCvDocumentId: "cv-master",
        sourceLabel: "Master CV",
        revision: { increment: 1 },
      },
    })
  })

  it("rejects a source CV outside the current profile without modifying the desk", async () => {
    mockCVFindFirst.mockResolvedValue(null)

    await expect(setWritingDeskSource("desk-1", "cv-other-profile", 1)).rejects.toThrow("Source CV not found")

    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
  })

  it("returns a conflict when a source change loses the revision race", async () => {
    mockDeskUpdateMany.mockResolvedValue({ count: 0 } as never)
    mockDeskFindFirst.mockResolvedValue({
      id: "desk-1",
      jobApplicationId: "job-1",
      revision: 2,
      content: "A concurrent edit",
    } as never)

    await expect(setWritingDeskSource("desk-1", null, 1)).resolves.toEqual({
      ok: false,
      reason: "conflict",
      revision: 2,
      content: "A concurrent edit",
    })
    expect(mockDeskUpdateMany).toHaveBeenCalledWith({
      where: { id: "desk-1", profileId: "profile-1", revision: 1 },
      data: {
        sourceType: "blank",
        sourceCvDocumentId: null,
        sourceLabel: "Blank document",
        revision: { increment: 1 },
      },
    })
  })
})
