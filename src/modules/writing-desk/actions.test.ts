import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/session", () => ({
  requireProfile: vi.fn().mockResolvedValue({ profile: { id: "profile-1" } }),
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    writingDeskDocument: {
      create: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
    },
    jobApplication: { findFirst: vi.fn() },
    cVDocument: { findFirst: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
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
  createWritingDeskDocumentAction,
  setWritingDeskDocumentType,
  setWritingDeskSource,
  updateWritingDeskContent,
} from "./actions"

const mockDeskCreate = vi.mocked(prisma.writingDeskDocument.create)
const mockDeskCount = vi.mocked(prisma.writingDeskDocument.count)
const mockTransaction = vi.mocked(prisma.$transaction)
const mockDeskUpdateMany = vi.mocked(prisma.writingDeskDocument.updateMany)
const mockDeskFindFirst = vi.mocked(prisma.writingDeskDocument.findFirst)
const mockJobFindFirst = vi.mocked(prisma.jobApplication.findFirst)
const mockCVFindFirst = vi.mocked(prisma.cVDocument.findFirst)
const mockParseCVContent = vi.mocked(parseCVContent)
const mockToMarkdown = vi.mocked(toMarkdown)
const mockRevalidatePath = vi.mocked(revalidatePath)

describe("createWritingDeskDocumentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTransaction.mockImplementation((async (fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never)
  })

  it("creates on the signed-in profile's job and refreshes the job's document tabs", async () => {
    mockJobFindFirst.mockResolvedValue({ id: "job-1" } as never)
    mockDeskCount.mockResolvedValue(2)
    mockDeskCreate.mockResolvedValue({ id: "desk-3" } as never)

    await expect(createWritingDeskDocumentAction({ jobId: "job-1", name: "Second CV", documentType: "cv" }))
      .resolves.toEqual({ ok: true, id: "desk-3" })

    expect(mockJobFindFirst).toHaveBeenCalledWith({ where: { id: "job-1", profileId: "profile-1" }, select: { id: true } })
    expect(mockDeskCreate.mock.calls[0][0].data).toMatchObject({ profileId: "profile-1", jobApplicationId: "job-1", name: "Second CV" })
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/job-applications/view/[id]", "layout")
  })

  it("refuses another profile's job without creating or revalidating", async () => {
    mockJobFindFirst.mockResolvedValue(null)

    await expect(createWritingDeskDocumentAction({ jobId: "job-other", name: "CV" }))
      .resolves.toMatchObject({ ok: false, reason: "job_not_found" })
    expect(mockDeskCreate).not.toHaveBeenCalled()
    expect(mockRevalidatePath).not.toHaveBeenCalled()
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
      select: { id: true, revision: true, content: true },
    })
  })
})

describe("setWritingDeskDocumentType", () => {
  beforeEach(() => vi.clearAllMocks())

  it("updates an owned document type with its expected revision and revalidates the job's tabs", async () => {
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
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/job-applications/view/[id]", "layout")
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
