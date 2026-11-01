import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    writingDeskDocument: { findFirst: vi.fn() },
    cVDocument: { findMany: vi.fn() },
    jobApplication: { findMany: vi.fn() },
  },
}))
vi.mock("@/modules/profile/snapshot", () => ({ buildProfileSnapshot: vi.fn() }))
vi.mock("./draft", () => ({ listDraftEvents: vi.fn() }))
vi.mock("./fact-check", () => ({ checkFacts: vi.fn() }))
vi.mock("./validate", () => ({ validateDraftMarkdown: vi.fn() }))

import { prisma } from "@/lib/db"
import { buildProfileSnapshot } from "@/modules/profile/snapshot"
import { listDraftEvents } from "./draft"
import { checkFacts } from "./fact-check"
import { validateDraftMarkdown } from "./validate"
import { getWritingDesk, listWritingDeskJobs, listWritingDeskSourceCVs } from "./queries"

const mockDeskFindFirst = vi.mocked(prisma.writingDeskDocument.findFirst)
const mockCVFindMany = vi.mocked(prisma.cVDocument.findMany)
const mockJobFindMany = vi.mocked(prisma.jobApplication.findMany)
const mockBuildProfileSnapshot = vi.mocked(buildProfileSnapshot)
const mockListDraftEvents = vi.mocked(listDraftEvents)
const mockCheckFacts = vi.mocked(checkFacts)
const mockValidateDraftMarkdown = vi.mocked(validateDraftMarkdown)

const DESK_ROW = {
  id: "desk-1",
  content: "# Live",
  revision: 3,
  documentType: "cv",
  sourceType: null,
  sourceCvDocumentId: null,
  sourceLabel: null,
  draftContent: null,
  draftRevision: 0,
  draftUpdatedAt: null,
  updatedAt: new Date("2026-10-20T00:00:00Z"),
  jobApplication: { id: "job-1", title: "Engineer", company: "Acme", jobDescription: null },
}

describe("getWritingDesk", () => {
  beforeEach(() => vi.clearAllMocks())

  it("looks up a desk by both profile and job application", async () => {
    mockDeskFindFirst.mockResolvedValue(null)

    await expect(getWritingDesk("profile-1", "job-1")).resolves.toBeNull()

    expect(mockDeskFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId: "profile-1", jobApplicationId: "job-1" },
    }))
  })

  it("returns a null draft and skips fact-checking when the desk has no draft", async () => {
    mockDeskFindFirst.mockResolvedValue(DESK_ROW as never)

    const desk = await getWritingDesk("profile-1", "job-1")

    expect(desk).toEqual({
      id: "desk-1",
      content: "# Live",
      revision: 3,
      documentType: "cv",
      sourceType: null,
      sourceCvDocumentId: null,
      sourceLabel: null,
      jobApplication: { id: "job-1", title: "Engineer", company: "Acme", jobDescription: null },
      draft: null,
    })
    expect(mockBuildProfileSnapshot).not.toHaveBeenCalled()
    expect(mockListDraftEvents).not.toHaveBeenCalled()
  })

  it("fills the pending draft with fact-check warnings, structural issues and recent events", async () => {
    const draftUpdatedAt = new Date("2026-10-23T10:00:00Z")
    const eventAt = new Date("2026-10-23T09:59:00Z")
    const snapshot = { experience: [] }
    const warnings = [{ kind: "employer", message: "Globex is not in your profile.", excerpt: "Globex" }]
    const issues = [{ severity: "warning", message: "Missing profile section." }]
    mockDeskFindFirst.mockResolvedValue({
      ...DESK_ROW,
      draftContent: "# Draft",
      draftRevision: 4,
      draftUpdatedAt,
    } as never)
    mockBuildProfileSnapshot.mockResolvedValue(snapshot as never)
    mockCheckFacts.mockReturnValue(warnings as never)
    mockValidateDraftMarkdown.mockReturnValue({ ok: true, issues } as never)
    mockListDraftEvents.mockResolvedValue([{ tool: "replace_section", createdAt: eventAt, apiTokenId: "token-1" }])

    const desk = await getWritingDesk("profile-1", "job-1")

    expect(desk?.draft).toEqual({
      content: "# Draft",
      draftRevision: 4,
      updatedAt: draftUpdatedAt,
      warnings,
      issues,
      events: [{ tool: "replace_section", createdAt: eventAt }],
    })
    expect(mockBuildProfileSnapshot).toHaveBeenCalledWith("profile-1")
    expect(mockCheckFacts).toHaveBeenCalledWith("# Draft", snapshot)
    expect(mockValidateDraftMarkdown).toHaveBeenCalledWith("# Draft")
    expect(mockListDraftEvents).toHaveBeenCalledWith("profile-1", "desk-1", expect.any(Number))
  })

  it("lists only the pending draft's events, stopping at the create_draft that started it", async () => {
    const at = (minute: number) => new Date(`2026-10-23T10:${String(minute).padStart(2, "0")}:00Z`)
    mockDeskFindFirst.mockResolvedValue({ ...DESK_ROW, draftContent: "# Draft", draftRevision: 9, draftUpdatedAt: at(30) } as never)
    mockBuildProfileSnapshot.mockResolvedValue({} as never)
    mockCheckFacts.mockReturnValue([])
    mockValidateDraftMarkdown.mockReturnValue({ ok: true, issues: [] })
    mockListDraftEvents.mockResolvedValue([
      { tool: "remove_section", createdAt: at(30), apiTokenId: "token-1" },
      { tool: "create_draft", createdAt: at(20), apiTokenId: "token-1" },
      { tool: "replace_section", createdAt: at(10), apiTokenId: "token-1" },
      { tool: "create_draft", createdAt: at(5), apiTokenId: "token-1" },
    ])

    const desk = await getWritingDesk("profile-1", "job-1")

    expect(desk?.draft?.events).toEqual([
      { tool: "remove_section", createdAt: at(30) },
      { tool: "create_draft", createdAt: at(20) },
    ])
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

  it("lists non-archived jobs, treating a typed desk as started even before content is written", async () => {
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
        writingDesk: { documentType: "cover-letter", content: "", updatedAt: new Date("2026-03-03T00:00:00Z") },
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
        deskUpdatedAt: new Date("2026-03-05T00:00:00Z"),
      },
      {
        id: "job-2",
        title: "Engineer",
        company: null,
        status: "applied",
        documentType: "cover-letter",
        deskUpdatedAt: new Date("2026-03-03T00:00:00Z"),
      },
      {
        id: "job-3",
        title: "Designer",
        company: "Globex",
        status: "not started",
        documentType: null,
        deskUpdatedAt: null,
      },
    ])

    expect(mockJobFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId: "profile-1", archivedAt: null },
      orderBy: { lastUpdated: "desc" },
    }))
  })
})
