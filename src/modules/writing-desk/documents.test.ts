import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    writingDeskDocument: { create: vi.fn(), count: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    jobApplication: { findFirst: vi.fn() },
    cVDocument: { findFirst: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}))
vi.mock("@/modules/cv/schema", () => ({ parseCVContent: vi.fn() }))
vi.mock("@/modules/cv/export", () => ({ toMarkdown: vi.fn() }))

import { prisma } from "@/lib/db"
import { toMarkdown } from "@/modules/cv/export"
import {
  createWritingDeskDocument,
  ensurePrimaryWritingDesk,
  getPrimaryWritingDeskId,
  jobDocumentsLockKey,
  renameWritingDeskDocument,
} from "./documents"
import { MAX_WRITING_DESK_DOCUMENTS_PER_JOB } from "./schema"

const mockJob = vi.mocked(prisma.jobApplication.findFirst)
const mockCv = vi.mocked(prisma.cVDocument.findFirst)
const mockCreate = vi.mocked(prisma.writingDeskDocument.create)
const mockCount = vi.mocked(prisma.writingDeskDocument.count)
const mockFindFirst = vi.mocked(prisma.writingDeskDocument.findFirst)
const mockUpdateMany = vi.mocked(prisma.writingDeskDocument.updateMany)
const mockExecuteRaw = vi.mocked(prisma.$executeRaw)
const mockTransaction = vi.mocked(prisma.$transaction)

const PROFILE = "profile-1"
const ORDER = [{ createdAt: "asc" }, { id: "asc" }]

beforeEach(() => {
  vi.resetAllMocks()
  mockTransaction.mockImplementation((async (fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never)
  mockJob.mockResolvedValue({ id: "job-1" } as never)
  mockCount.mockResolvedValue(0)
  mockCreate.mockResolvedValue({ id: "desk-new" } as never)
})

function lockedJobKeys(): string[] {
  return mockExecuteRaw.mock.calls.map(call => call.slice(1).join(""))
}

describe("createWritingDeskDocument", () => {
  it("adds a blank named document beside the job's others, under the job's lock", async () => {
    mockCount.mockResolvedValue(2)

    await expect(createWritingDeskDocument(PROFILE, { jobId: "job-1", name: "  Notes  ", documentType: "other" }))
      .resolves.toEqual({ ok: true, id: "desk-new" })

    expect(mockJob).toHaveBeenCalledWith({ where: { id: "job-1", profileId: PROFILE }, select: { id: true } })
    expect(lockedJobKeys()).toEqual([jobDocumentsLockKey("job-1")])
    expect(mockCount).toHaveBeenCalledWith({ where: { profileId: PROFILE, jobApplicationId: "job-1" } })
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        profileId: PROFILE,
        jobApplicationId: "job-1",
        name: "Notes",
        documentType: "other",
        sourceType: "blank",
        sourceCvDocumentId: null,
        sourceLabel: "Blank document",
      },
      select: { id: true },
    })
  })

  it("starts from one of the profile's CVs, copying its content and recording the source", async () => {
    mockCv.mockResolvedValue({
      id: "cv-1",
      generatedContent: "{}",
      jobApplicationId: "job-0",
      careerVerticalId: null,
      jobTitle: "Lead PM",
      company: "Acme",
      updatedAt: new Date("2026-03-01T00:00:00Z"),
    } as never)
    vi.mocked(toMarkdown).mockReturnValue("# From CV")

    await createWritingDeskDocument(PROFILE, { jobId: "job-1", name: "CV for Acme", documentType: "cv", sourceCvId: "cv-1" })

    expect(mockCv).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "cv-1", profileId: PROFILE } }))
    expect(mockCreate.mock.calls[0][0].data).toMatchObject({
      name: "CV for Acme",
      documentType: "cv",
      content: "# From CV",
      sourceType: "previous-cv",
      sourceCvDocumentId: "cv-1",
      sourceLabel: "CV - Lead PM at Acme",
    })
  })

  it("refuses another profile's job: nothing is read from its documents or created", async () => {
    mockJob.mockResolvedValue(null)

    await expect(createWritingDeskDocument(PROFILE, { jobId: "job-other", name: "CV" }))
      .resolves.toMatchObject({ ok: false, reason: "job_not_found" })
    expect(mockCount).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("refuses a source CV that isn't the profile's", async () => {
    mockCv.mockResolvedValue(null)

    await expect(createWritingDeskDocument(PROFILE, { jobId: "job-1", name: "CV", sourceCvId: "cv-other" }))
      .resolves.toMatchObject({ ok: false, reason: "source_not_found" })
    expect(mockCv).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "cv-other", profileId: PROFILE } }))
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it.each([
    ["an empty name", { jobId: "job-1", name: "   " }],
    ["an overlong name", { jobId: "job-1", name: "x".repeat(81) }],
    ["a control character", { jobId: "job-1", name: "CV\u0007" }],
    ["an unknown type", { jobId: "job-1", name: "CV", documentType: "memo" }],
    ["a missing job id", { name: "CV" }],
    ["a non-object", "CV"],
  ])("validates at the boundary: refuses %s without touching the database", async (_label, input) => {
    await expect(createWritingDeskDocument(PROFILE, input)).resolves.toMatchObject({ ok: false, reason: "invalid" })
    expect(mockJob).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("holds the per-job cap", async () => {
    mockCount.mockResolvedValue(MAX_WRITING_DESK_DOCUMENTS_PER_JOB)

    await expect(createWritingDeskDocument(PROFILE, { jobId: "job-1", name: "One more" }))
      .resolves.toMatchObject({ ok: false, reason: "limit" })
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe("primary document (job-scoped URL compatibility)", () => {
  it("is the oldest document by (createdAt, id), scoped to the profile and job", async () => {
    mockFindFirst.mockResolvedValue({ id: "desk-original" } as never)

    await expect(getPrimaryWritingDeskId(PROFILE, "job-1")).resolves.toBe("desk-original")
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { profileId: PROFILE, jobApplicationId: "job-1" },
      orderBy: ORDER,
      select: { id: true },
    })
  })

  it("opens the existing primary document without locking or creating", async () => {
    mockFindFirst.mockResolvedValue({ id: "desk-original" } as never)

    await expect(ensurePrimaryWritingDesk(PROFILE, "job-1")).resolves.toEqual({ id: "desk-original" })
    expect(mockExecuteRaw).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("creates one blank, unnamed document under the lock when the job has none", async () => {
    mockFindFirst.mockResolvedValue(null)

    await expect(ensurePrimaryWritingDesk(PROFILE, "job-1")).resolves.toEqual({ id: "desk-new" })
    expect(lockedJobKeys()).toEqual([jobDocumentsLockKey("job-1")])
    expect(mockCreate).toHaveBeenCalledWith({
      data: { profileId: PROFILE, jobApplicationId: "job-1", name: "Untitled document" },
      select: { id: true },
    })
  })

  it("re-checks under the lock, so a concurrent first visit can't create a second document", async () => {
    mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "desk-raced" } as never)

    await expect(ensurePrimaryWritingDesk(PROFILE, "job-1")).resolves.toEqual({ id: "desk-raced" })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("returns null for another profile's job and creates nothing", async () => {
    mockJob.mockResolvedValue(null)

    await expect(ensurePrimaryWritingDesk(PROFILE, "job-other")).resolves.toBeNull()
    expect(mockFindFirst).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe("renameWritingDeskDocument", () => {
  it("stores the trimmed name on the profile's own document without bumping its revision", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 })

    await expect(renameWritingDeskDocument(PROFILE, { documentId: "desk-1", name: "  CV for recruiters  " }))
      .resolves.toEqual({ ok: true, name: "CV for recruiters" })

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: "desk-1", profileId: PROFILE },
      data: { name: "CV for recruiters" },
    })
  })

  it("refuses another profile's document (or a missing one) without changing anything", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 })

    await expect(renameWritingDeskDocument(PROFILE, { documentId: "someone-elses", name: "Mine now" }))
      .resolves.toMatchObject({ ok: false, reason: "not_found" })
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "someone-elses", profileId: PROFILE } }))
  })

  it.each([
    ["an empty name", "   "],
    ["a name over 80 characters", "x".repeat(81)],
    ["control characters", "CV\u0007"],
    ["a non-string name", 42],
  ])("rejects %s without writing", async (_label, name) => {
    await expect(renameWritingDeskDocument(PROFILE, { documentId: "desk-1", name }))
      .resolves.toMatchObject({ ok: false, reason: "invalid" })
    expect(mockUpdateMany).not.toHaveBeenCalled()
  })

  it("accepts exactly 80 characters", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 })
    await expect(renameWritingDeskDocument(PROFILE, { documentId: "desk-1", name: "x".repeat(80) }))
      .resolves.toEqual({ ok: true, name: "x".repeat(80) })
  })
})

describe("createWritingDeskDocument from the + dialog", () => {
  it("refuses an empty or over-long name without touching the job or creating", async () => {
    for (const name of ["", "   ", "y".repeat(81)]) {
      await expect(createWritingDeskDocument(PROFILE, { jobId: "job-1", name, documentType: "cv" }))
        .resolves.toMatchObject({ ok: false, reason: "invalid" })
    }
    expect(mockJob).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("only reads the source CV (scoped to the profile), so importing leaves it unchanged", async () => {
    mockCv.mockResolvedValue({
      id: "cv-1",
      generatedContent: "{}",
      jobApplicationId: null,
      careerVerticalId: "v-1",
      jobTitle: null,
      company: null,
      updatedAt: new Date("2026-03-01T00:00:00Z"),
    } as never)
    vi.mocked(toMarkdown).mockReturnValue("# Me")

    await expect(createWritingDeskDocument(PROFILE, { jobId: "job-1", name: "CV 2", documentType: "cv", sourceCvId: "cv-1" }))
      .resolves.toEqual({ ok: true, id: "desk-new" })

    expect(mockCv).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "cv-1", profileId: PROFILE } }))
    // The prisma mock exposes no CV writes at all; the copy lands only on the new document.
    expect(Object.keys(prisma.cVDocument)).toEqual(["findFirst"])
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: "CV 2", content: "# Me", sourceType: "master-cv", sourceCvDocumentId: "cv-1" }),
    }))
  })

  it("refuses the eleventh document on a job", async () => {
    mockCount.mockResolvedValue(MAX_WRITING_DESK_DOCUMENTS_PER_JOB)
    expect(MAX_WRITING_DESK_DOCUMENTS_PER_JOB).toBe(10)
    await expect(createWritingDeskDocument(PROFILE, { jobId: "job-1", name: "One more", documentType: "other" }))
      .resolves.toMatchObject({ ok: false, reason: "limit" })
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
