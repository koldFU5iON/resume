import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    writingDeskDocument: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    writingDeskDraftEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    jobApplication: { findFirst: vi.fn() },
    profile: { findUnique: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}))
vi.mock("@/modules/profile/snapshot", () => ({ buildProfileSnapshot: vi.fn() }))

import { prisma } from "@/lib/db"
import { buildProfileSnapshot, type ProfileSnapshot } from "@/modules/profile/snapshot"
import { MAX_WRITING_DESK_CONTENT_LENGTH } from "./schema"
import { applySectionOp, splitSections } from "./sections"
import {
  acceptDraft,
  createDraft,
  discardDraft,
  editDraftSection,
  getDraft,
  listDraftEvents,
  saveDraftContent,
} from "./draft"

const mockJobFindFirst = vi.mocked(prisma.jobApplication.findFirst)
const mockDeskCreate = vi.mocked(prisma.writingDeskDocument.create)
const mockDeskFindMany = vi.mocked(prisma.writingDeskDocument.findMany)
const mockExecuteRaw = vi.mocked(prisma.$executeRaw)
const mockDeskUpdateMany = vi.mocked(prisma.writingDeskDocument.updateMany)
const mockDeskFindFirst = vi.mocked(prisma.writingDeskDocument.findFirst)
const mockEventCreate = vi.mocked(prisma.writingDeskDraftEvent.create)
const mockEventFindMany = vi.mocked(prisma.writingDeskDraftEvent.findMany)
const mockTransaction = vi.mocked(prisma.$transaction)
const mockSnapshot = vi.mocked(buildProfileSnapshot)
const mockProfileFindUnique = vi.mocked(prisma.profile.findUnique)

const PROFILE = "profile-1"
const TOKEN = "token-abc123"

const DRAFT = "# Jane Doe\n\n## Profile\n\nOld profile text.\n\n## Skills\n\n:::skills\n- TypeScript\n:::\n"

const EMPTY_SNAPSHOT: ProfileSnapshot = {
  name: "Jane Doe",
  email: null,
  phone: null,
  website: null,
  linkedin: null,
  location: null,
  headline: null,
  github: null,
  summary: null,
  tools: [],
  experiences: [],
  skills: [],
  educations: [],
  certifications: [],
  competencies: [],
  languages: [],
  projects: [],
}

function section(id: string, markdown = DRAFT) {
  const found = splitSections(markdown).find(s => s.id === id)
  if (!found) throw new Error(`fixture has no section ${id}`)
  return found
}

function deskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "desk-1",
    name: "CV",
    jobApplicationId: "job-1",
    documentType: "cv",
    draftContent: DRAFT,
    draftRevision: 4,
    revision: 2,
    ...overrides,
  } as never
}

function provenanceFree(content: string) {
  for (const marker of [TOKEN, "create_draft", "replace_section", "insert_section", "remove_section", "apiTokenId"]) {
    expect(content).not.toContain(marker)
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockTransaction.mockImplementation((async (fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never)
  mockSnapshot.mockResolvedValue(EMPTY_SNAPSHOT)
  mockJobFindFirst.mockResolvedValue({ id: "job-1" } as never)
  mockEventCreate.mockResolvedValue({} as never)
  // Unless a test says otherwise, a job-scoped lookup (no documentId) sees
  // whatever findFirst returns as the job's only document, so the same row
  // serves the first resolution and any retry re-read by id.
  mockDeskFindMany.mockImplementation((async (args: unknown) => {
    const row = await (mockDeskFindFirst as unknown as (a: unknown) => Promise<unknown>)(args)
    return row ? [row] : []
  }) as never)
})

function expectJobLookup(jobId = "job-1") {
  expect(mockJobFindFirst).toHaveBeenCalledWith({
    where: { id: jobId, profileId: PROFILE },
    select: { id: true },
  })
}

describe("createDraft", () => {
  it("returns job_not_found for another profile's job and writes nothing", async () => {
    mockJobFindFirst.mockResolvedValue(null)

    const result = await createDraft(PROFILE, { jobId: "job-other" }, DRAFT, { tokenId: TOKEN })

    expect(result).toMatchObject({ ok: false, reason: "job_not_found" })
    expectJobLookup("job-other")
    expect(mockDeskFindMany).not.toHaveBeenCalled()
    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
    expect(mockEventCreate).not.toHaveBeenCalled()
  })

  it("returns wrong_document_type for a desk typed cover-letter", async () => {
    mockDeskFindMany.mockResolvedValue([deskRow({ documentType: "cover-letter", draftContent: null })])

    const result = await createDraft(PROFILE, { jobId: "job-1" }, DRAFT, { tokenId: TOKEN })

    expect(result).toMatchObject({ ok: false, reason: "wrong_document_type" })
    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
    expect(mockEventCreate).not.toHaveBeenCalled()
  })

  it("returns draft_exists when the desk already has a draft", async () => {
    mockDeskFindMany.mockResolvedValue([deskRow({ draftContent: "Existing draft" })])

    const result = await createDraft(PROFILE, { jobId: "job-1" }, DRAFT, { tokenId: TOKEN })

    expect(result).toMatchObject({ ok: false, reason: "draft_exists" })
    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
    expect(mockEventCreate).not.toHaveBeenCalled()
  })

  it("returns invalid with the issues for an unknown block and writes nothing", async () => {
    const result = await createDraft(PROFILE, { jobId: "job-1" }, "# Jane\n\n:::fancy-grid\n- a\n:::\n", { tokenId: TOKEN })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("invalid")
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error", message: expect.stringContaining("fancy-grid") })]),
    )
    expect(mockDeskFindMany).not.toHaveBeenCalled()
    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
    expect(mockEventCreate).not.toHaveBeenCalled()
  })

  it("rejects an unclosed ::: fence as invalid", async () => {
    const result = await createDraft(PROFILE, { jobId: "job-1" }, "# Jane\n\n:::skills\n- a\n", { tokenId: TOKEN })

    expect(result).toMatchObject({ ok: false, reason: "invalid" })
    expect(mockDeskFindMany).not.toHaveBeenCalled()
  })

  it("on success sets documentType cv when null, guards the write and logs an event with the token id", async () => {
    mockDeskFindMany.mockResolvedValue([deskRow({ documentType: null, draftContent: null, draftRevision: 2, revision: 3 })])
    mockDeskUpdateMany.mockResolvedValue({ count: 1 } as never)

    const result = await createDraft(PROFILE, { jobId: "job-1" }, DRAFT, { tokenId: TOKEN })

    expectJobLookup()
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1)
    expect(mockDeskFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId: PROFILE, jobApplicationId: "job-1" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }))
    expect(mockDeskCreate).not.toHaveBeenCalled()
    expect(mockDeskUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "desk-1",
        profileId: PROFILE,
        draftContent: null,
        draftRevision: 2,
        OR: [{ documentType: null }, { documentType: "cv" }],
      },
      data: {
        draftContent: DRAFT,
        draftRevision: { increment: 1 },
        draftUpdatedAt: expect.any(Date),
        documentType: "cv",
      },
    })
    expect(mockEventCreate).toHaveBeenCalledWith({
      data: { writingDeskId: "desk-1", apiTokenId: TOKEN, tool: "create_draft" },
    })
    expect(mockSnapshot).toHaveBeenCalledWith(PROFILE)
    expect(result).toEqual({
      ok: true,
      value: {
        deskId: "desk-1",
        documentName: "CV",
        jobId: "job-1",
        content: DRAFT,
        draftRevision: 3,
        liveRevision: 3,
        sections: splitSections(DRAFT),
        warnings: [],
        issues: [],
      },
    })
    const written = mockDeskUpdateMany.mock.calls[0][0].data as { draftContent: string }
    expect(written.draftContent).toBe(DRAFT)
    provenanceFree(written.draftContent)
  })

  it("logs a null token id when no actor is given", async () => {
    mockDeskFindMany.mockResolvedValue([deskRow({ draftContent: null })])
    mockDeskUpdateMany.mockResolvedValue({ count: 1 } as never)

    await createDraft(PROFILE, { jobId: "job-1" }, DRAFT)

    expect(mockEventCreate).toHaveBeenCalledWith({
      data: { writingDeskId: "desk-1", apiTokenId: null, tool: "create_draft" },
    })
  })

  it("returns draft_exists without logging when a draft appears between read and write", async () => {
    mockDeskFindMany.mockResolvedValue([deskRow({ draftContent: null })])
    mockDeskUpdateMany.mockResolvedValue({ count: 0 } as never)
    mockDeskFindFirst.mockResolvedValue(deskRow({ draftContent: "Owner draft" }))

    const result = await createDraft(PROFILE, { jobId: "job-1" }, DRAFT, { tokenId: TOKEN })

    expect(result).toMatchObject({ ok: false, reason: "draft_exists" })
    expect(mockDeskFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "desk-1", profileId: PROFILE } }),
    )
    expect(mockEventCreate).not.toHaveBeenCalled()
  })
})

describe("getDraft", () => {
  it("returns job_not_found for another profile's job", async () => {
    mockJobFindFirst.mockResolvedValue(null)

    await expect(getDraft(PROFILE, { jobId: "job-other" })).resolves.toMatchObject({ ok: false, reason: "job_not_found" })
    expectJobLookup("job-other")
    expect(mockDeskFindFirst).not.toHaveBeenCalled()
  })

  it("returns no_draft when there is no desk or no draft", async () => {
    mockDeskFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(deskRow({ draftContent: null }))

    await expect(getDraft(PROFILE, { jobId: "job-1" })).resolves.toMatchObject({ ok: false, reason: "no_draft" })
    await expect(getDraft(PROFILE, { jobId: "job-1" })).resolves.toMatchObject({ ok: false, reason: "no_draft" })
  })

  it("returns the draft state filtered by profile", async () => {
    mockDeskFindFirst.mockResolvedValue(deskRow())

    const result = await getDraft(PROFILE, { jobId: "job-1" })

    expect(mockDeskFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobApplicationId: "job-1", profileId: PROFILE } }),
    )
    expect(result).toEqual({
      ok: true,
      value: {
        deskId: "desk-1",
        documentName: "CV",
        jobId: "job-1",
        content: DRAFT,
        draftRevision: 4,
        liveRevision: 2,
        sections: splitSections(DRAFT),
        warnings: [],
        issues: [],
      },
    })
  })
})

describe("editDraftSection", () => {
  const profile = section("profile")
  const replaceProfile = {
    type: "replace" as const,
    sectionId: "profile",
    expectedHash: profile.hash,
    content: "## Profile\n\nNew profile text.",
  }

  it("returns job_not_found for another profile's job", async () => {
    mockJobFindFirst.mockResolvedValue(null)

    await expect(editDraftSection(PROFILE, { jobId: "job-other" }, replaceProfile)).resolves.toMatchObject({
      ok: false,
      reason: "job_not_found",
    })
    expectJobLookup("job-other")
    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
  })

  it("returns no_draft when the desk has no draft", async () => {
    mockDeskFindFirst.mockResolvedValue(deskRow({ draftContent: null }))

    await expect(editDraftSection(PROFILE, { jobId: "job-1" }, replaceProfile)).resolves.toMatchObject({
      ok: false,
      reason: "no_draft",
    })
    expect(mockDeskFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobApplicationId: "job-1", profileId: PROFILE } }),
    )
    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
  })

  it("returns hash_mismatch with the current section for a stale hash", async () => {
    mockDeskFindFirst.mockResolvedValue(deskRow())

    const result = await editDraftSection(PROFILE, { jobId: "job-1" }, { ...replaceProfile, expectedHash: "stalehash000" })

    expect(result).toMatchObject({ ok: false, reason: "hash_mismatch", current: profile })
    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
    expect(mockEventCreate).not.toHaveBeenCalled()
  })

  it("returns section_not_found with the section list for an unknown section", async () => {
    mockDeskFindFirst.mockResolvedValue(deskRow())

    const result = await editDraftSection(PROFILE, { jobId: "job-1" }, { ...replaceProfile, sectionId: "experience" })

    expect(result).toMatchObject({ ok: false, reason: "section_not_found", sections: splitSections(DRAFT) })
    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
  })

  it("maps an invalid op to invalid with the op message", async () => {
    const withPreamble = "Intro line.\n\n## Profile\n\nText.\n"
    mockDeskFindFirst.mockResolvedValue(deskRow({ draftContent: withPreamble }))

    const result = await editDraftSection(PROFILE, { jobId: "job-1" }, {
      type: "insert",
      position: "start",
      content: "## Summary\n\nNew.",
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("invalid")
    expect(result.message).toContain("neighbouring sections")
    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
  })

  it("rejects an edit whose result has an unknown block, with the issues", async () => {
    mockDeskFindFirst.mockResolvedValue(deskRow())

    const result = await editDraftSection(PROFILE, { jobId: "job-1" }, {
      ...replaceProfile,
      content: "## Profile\n\n:::fancy-grid\n- a\n:::",
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("invalid")
    expect(result.issues?.some(i => i.severity === "error" && i.message.includes("fancy-grid"))).toBe(true)
    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
    expect(mockEventCreate).not.toHaveBeenCalled()
  })

  it("writes with a draftRevision guard, increments the revision and logs the tool name", async () => {
    mockDeskFindFirst.mockResolvedValue(deskRow())
    mockDeskUpdateMany.mockResolvedValue({ count: 1 } as never)
    const expected = applySectionOp(DRAFT, replaceProfile)
    if (!expected.ok) throw new Error("fixture op failed")

    const result = await editDraftSection(PROFILE, { jobId: "job-1" }, replaceProfile, { tokenId: TOKEN })

    expect(mockDeskUpdateMany).toHaveBeenCalledTimes(1)
    expect(mockDeskUpdateMany).toHaveBeenCalledWith({
      where: { id: "desk-1", profileId: PROFILE, draftRevision: 4, draftContent: { not: null } },
      data: { draftContent: expected.markdown, draftRevision: { increment: 1 }, draftUpdatedAt: expect.any(Date) },
    })
    expect(mockEventCreate).toHaveBeenCalledWith({
      data: {
        writingDeskId: "desk-1",
        apiTokenId: TOKEN,
        tool: "replace_section",
        detail: { sectionId: "profile" },
      },
    })
    expect(result).toMatchObject({
      ok: true,
      value: { deskId: "desk-1", jobId: "job-1", content: expected.markdown, draftRevision: 5, liveRevision: 2 },
    })
    provenanceFree(expected.markdown)
    if (result.ok) provenanceFree(result.value.content)
  })

  it.each([
    [
      "insert_section",
      { type: "insert" as const, afterSectionId: "profile", content: "## Projects\n\nA project." },
      { afterSectionId: "profile" },
    ],
    [
      "remove_section",
      { type: "remove" as const, sectionId: "profile", expectedHash: section("profile").hash },
      { sectionId: "profile" },
    ],
  ])("logs %s for the matching op", async (tool, op, detail) => {
    mockDeskFindFirst.mockResolvedValue(deskRow())
    mockDeskUpdateMany.mockResolvedValue({ count: 1 } as never)

    const result = await editDraftSection(PROFILE, { jobId: "job-1" }, op, { tokenId: TOKEN })

    expect(result.ok).toBe(true)
    expect(mockEventCreate).toHaveBeenCalledWith({
      data: { writingDeskId: "desk-1", apiTokenId: TOKEN, tool, detail },
    })
    const written = mockDeskUpdateMany.mock.calls[0][0].data as { draftContent: string }
    provenanceFree(written.draftContent)
  })

  it("re-reads and retries after a lost race, guarding each write on the revision it read", async () => {
    const newer = DRAFT.replace("- TypeScript", "- TypeScript\n- Go")
    mockDeskFindFirst
      .mockResolvedValueOnce(deskRow())
      .mockResolvedValueOnce(deskRow({ draftContent: newer, draftRevision: 5 }))
      .mockResolvedValueOnce(deskRow({ draftContent: newer, draftRevision: 6 }))
    mockDeskUpdateMany
      .mockResolvedValueOnce({ count: 0 } as never)
      .mockResolvedValueOnce({ count: 0 } as never)
      .mockResolvedValueOnce({ count: 1 } as never)

    const result = await editDraftSection(PROFILE, { jobId: "job-1" }, replaceProfile, { tokenId: TOKEN })

    expect(result).toMatchObject({ ok: true, value: { draftRevision: 7 } })
    expect(mockDeskFindFirst).toHaveBeenCalledTimes(3)
    expect(mockDeskUpdateMany).toHaveBeenCalledTimes(3)
    const guards = mockDeskUpdateMany.mock.calls.map(c => (c[0].where as { draftRevision: number }).draftRevision)
    expect(guards).toEqual([4, 5, 6])
    const finalWrite = mockDeskUpdateMany.mock.calls[2][0].data as { draftContent: string }
    expect(finalWrite.draftContent).toContain("- Go")
    expect(finalWrite.draftContent).toContain("New profile text.")
    expect(mockEventCreate).toHaveBeenCalledTimes(1)
  })

  it("returns conflict after 3 lost races and logs nothing", async () => {
    mockDeskFindFirst.mockResolvedValue(deskRow())
    mockDeskUpdateMany.mockResolvedValue({ count: 0 } as never)

    const result = await editDraftSection(PROFILE, { jobId: "job-1" }, replaceProfile, { tokenId: TOKEN })

    expect(result).toMatchObject({ ok: false, reason: "conflict" })
    expect(mockDeskUpdateMany).toHaveBeenCalledTimes(3)
    expect(mockEventCreate).not.toHaveBeenCalled()
  })
})

describe("saveDraftContent", () => {
  it("saves the whole draft guarded on the expected draft revision and logs no event", async () => {
    mockDeskUpdateMany.mockResolvedValue({ count: 1 } as never)

    const result = await saveDraftContent(PROFILE, "desk-1", "Hand edited", 4)

    expect(result).toEqual({ ok: true, value: { draftRevision: 5 } })
    expect(mockDeskUpdateMany).toHaveBeenCalledWith({
      where: { id: "desk-1", profileId: PROFILE, draftRevision: 4, draftContent: { not: null } },
      data: { draftContent: "Hand edited", draftRevision: { increment: 1 }, draftUpdatedAt: expect.any(Date) },
    })
    expect(mockEventCreate).not.toHaveBeenCalled()
  })

  it("does not block an owner save on validation errors", async () => {
    mockDeskUpdateMany.mockResolvedValue({ count: 1 } as never)

    const result = await saveDraftContent(PROFILE, "desk-1", ":::fancy-grid\n- a\n", 4)

    expect(result).toEqual({ ok: true, value: { draftRevision: 5 } })
  })

  it("returns conflict with the current draft on a stale revision", async () => {
    mockDeskUpdateMany.mockResolvedValue({ count: 0 } as never)
    mockDeskFindFirst.mockResolvedValue(deskRow({ draftContent: "Newer agent draft", draftRevision: 6 }))

    const result = await saveDraftContent(PROFILE, "desk-1", "Stale hand edit", 4)

    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      draft: { content: "Newer agent draft", draftRevision: 6 },
    })
    expect(mockDeskFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "desk-1", profileId: PROFILE } }),
    )
  })

  it("returns no_draft when the draft was accepted or discarded meanwhile", async () => {
    mockDeskUpdateMany.mockResolvedValue({ count: 0 } as never)
    mockDeskFindFirst.mockResolvedValue(deskRow({ draftContent: null, draftRevision: 5 }))

    await expect(saveDraftContent(PROFILE, "desk-1", "Late edit", 4)).resolves.toMatchObject({
      ok: false,
      reason: "no_draft",
    })
  })

  it("rejects a draft over 500,000 characters without writing", async () => {
    const result = await saveDraftContent(PROFILE, "desk-1", "a".repeat(MAX_WRITING_DESK_CONTENT_LENGTH + 1), 4)

    expect(result).toMatchObject({ ok: false, reason: "invalid" })
    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
  })
})

describe("acceptDraft", () => {
  it("moves the draft into live content in one updateMany guarded on both revisions", async () => {
    mockDeskFindFirst.mockResolvedValue(deskRow())
    mockDeskUpdateMany.mockResolvedValue({ count: 1 } as never)

    const result = await acceptDraft(PROFILE, "desk-1", 2, 4)

    expect(result).toEqual({ ok: true, value: { revision: 3 } })
    expect(mockDeskFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "desk-1", profileId: PROFILE } }),
    )
    expect(mockDeskUpdateMany).toHaveBeenCalledTimes(1)
    expect(mockDeskUpdateMany).toHaveBeenCalledWith({
      where: { id: "desk-1", profileId: PROFILE, revision: 2, draftRevision: 4, draftContent: { not: null } },
      data: {
        content: DRAFT,
        revision: { increment: 1 },
        draftContent: null,
        draftUpdatedAt: null,
        draftRevision: { increment: 1 },
      },
    })
    expect(mockEventCreate).not.toHaveBeenCalled()
  })

  it("fills {{contact}} with the profile's contact line in the accepted content only", async () => {
    const withPlaceholder = ":::header\n# Jane Doe\n{{contact}}\n:::\n"
    mockDeskFindFirst.mockResolvedValue(deskRow({ draftContent: withPlaceholder }))
    mockDeskUpdateMany.mockResolvedValue({ count: 1 } as never)
    mockProfileFindUnique.mockResolvedValue({
      email: "jane@example.test", phone: null, linkedIn: "linkedin.com/in/jane", github: null, website: null,
    } as never)

    await expect(acceptDraft(PROFILE, "desk-1", 2, 4)).resolves.toEqual({ ok: true, value: { revision: 3 } })
    expect(mockProfileFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: PROFILE } }))
    expect(mockDeskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ content: ":::header\n# Jane Doe\njane@example.test | linkedin.com/in/jane\n:::\n" }),
    }))
  })

  it("refuses an accept that filling {{contact}} would push over the length limit", async () => {
    const big = "{{contact}}\n" + "x".repeat(MAX_WRITING_DESK_CONTENT_LENGTH - 12)
    mockDeskFindFirst.mockResolvedValue(deskRow({ draftContent: big }))
    mockProfileFindUnique.mockResolvedValue({ email: "jane@example.test", phone: null, linkedIn: null, github: null, website: null } as never)

    await expect(acceptDraft(PROFILE, "desk-1", 2, 4)).resolves.toMatchObject({ ok: false, reason: "invalid" })
    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
  })

  it("skips the profile lookup when the draft has no placeholder", async () => {
    mockDeskFindFirst.mockResolvedValue(deskRow())
    mockDeskUpdateMany.mockResolvedValue({ count: 1 } as never)

    await acceptDraft(PROFILE, "desk-1", 2, 4)
    expect(mockProfileFindUnique).not.toHaveBeenCalled()
  })

  it("returns live_changed when the live revision moved", async () => {
    mockDeskFindFirst.mockResolvedValue(deskRow({ revision: 3 }))

    await expect(acceptDraft(PROFILE, "desk-1", 2, 4)).resolves.toMatchObject({ ok: false, reason: "live_changed" })
    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
  })

  it("returns conflict with the current draft when the draft revision moved", async () => {
    mockDeskFindFirst.mockResolvedValue(deskRow({ draftRevision: 5, draftContent: "Newer draft" }))

    await expect(acceptDraft(PROFILE, "desk-1", 2, 4)).resolves.toMatchObject({
      ok: false,
      reason: "conflict",
      draft: { content: "Newer draft", draftRevision: 5 },
    })
    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
  })

  it("returns no_draft when there is no draft or the desk is not owned", async () => {
    mockDeskFindFirst.mockResolvedValueOnce(deskRow({ draftContent: null })).mockResolvedValueOnce(null)

    await expect(acceptDraft(PROFILE, "desk-1", 2, 4)).resolves.toMatchObject({ ok: false, reason: "no_draft" })
    await expect(acceptDraft(PROFILE, "desk-other", 2, 4)).resolves.toMatchObject({ ok: false, reason: "no_draft" })
    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
  })

  it("classifies a lost race after the read from a fresh read", async () => {
    mockDeskFindFirst.mockResolvedValueOnce(deskRow()).mockResolvedValueOnce(deskRow({ revision: 3 }))
    mockDeskUpdateMany.mockResolvedValue({ count: 0 } as never)

    await expect(acceptDraft(PROFILE, "desk-1", 2, 4)).resolves.toMatchObject({ ok: false, reason: "live_changed" })
  })
})

describe("discardDraft", () => {
  it("clears the owned draft", async () => {
    mockDeskUpdateMany.mockResolvedValue({ count: 1 } as never)

    await expect(discardDraft(PROFILE, "desk-1")).resolves.toEqual({ ok: true, value: {} })
    expect(mockDeskUpdateMany).toHaveBeenCalledWith({
      where: { id: "desk-1", profileId: PROFILE, draftContent: { not: null } },
      data: { draftContent: null, draftUpdatedAt: null, draftRevision: { increment: 1 } },
    })
  })

  it("returns no_draft when nothing was cleared", async () => {
    mockDeskUpdateMany.mockResolvedValue({ count: 0 } as never)

    await expect(discardDraft(PROFILE, "desk-1")).resolves.toMatchObject({ ok: false, reason: "no_draft" })
  })
})

describe("listDraftEvents", () => {
  it("lists recent events for an owned desk, newest first", async () => {
    const rows = [{ tool: "replace_section", createdAt: new Date("2026-10-24T10:00:00Z"), apiTokenId: TOKEN }]
    mockEventFindMany.mockResolvedValue(rows as never)

    await expect(listDraftEvents(PROFILE, "desk-1")).resolves.toEqual(rows)
    expect(mockEventFindMany).toHaveBeenCalledWith({
      where: { writingDeskId: "desk-1", writingDesk: { profileId: PROFILE } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { tool: true, createdAt: true, apiTokenId: true },
    })
  })

  it("honours an explicit limit", async () => {
    mockEventFindMany.mockResolvedValue([] as never)

    await listDraftEvents(PROFILE, "desk-1", 5)

    expect(mockEventFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }))
  })
})

describe("agent document resolution (#370)", () => {
  const replaceProfile = {
    type: "replace" as const,
    sectionId: "profile",
    expectedHash: section("profile").hash,
    content: "## Profile\n\nNew profile text.",
  }
  const cvA = () => deskRow({ id: "desk-a", name: "CV for recruiters", draftContent: null })
  const cvB = () => deskRow({ id: "desk-b", name: "CV short", draftContent: DRAFT })
  const note = () => deskRow({ id: "desk-n", name: "Notes", documentType: "other", draftContent: null })

  it("refuses every agent call without documentId when the job has several documents, and writes nothing", async () => {
    mockDeskFindMany.mockResolvedValue([cvA(), cvB(), note()])

    for (const result of [
      await createDraft(PROFILE, { jobId: "job-1" }, DRAFT, { tokenId: TOKEN }),
      await getDraft(PROFILE, { jobId: "job-1" }),
      await editDraftSection(PROFILE, { jobId: "job-1" }, replaceProfile, { tokenId: TOKEN }),
    ]) {
      expect(result).toMatchObject({ ok: false, reason: "document_required" })
      if (result.ok) continue
      expect(result.message).toContain('desk-a: "CV for recruiters" (CV)')
      expect(result.message).toContain('desk-b: "CV short" (CV, has a draft)')
      expect(result.message).toContain('desk-n: "Notes" (Other)')
    }
    expect(mockDeskCreate).not.toHaveBeenCalled()
    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
    expect(mockEventCreate).not.toHaveBeenCalled()
  })

  it("writes to exactly the document given by documentId, scoped to the profile and the job", async () => {
    mockDeskFindFirst.mockResolvedValue(cvA())
    mockDeskUpdateMany.mockResolvedValue({ count: 1 } as never)

    const result = await createDraft(PROFILE, { jobId: "job-1", documentId: "desk-a" }, DRAFT, { tokenId: TOKEN })

    expect(result).toMatchObject({ ok: true, value: { deskId: "desk-a", documentName: "CV for recruiters" } })
    expect(mockDeskFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "desk-a", profileId: PROFILE, jobApplicationId: "job-1" },
    }))
    expect(mockDeskFindMany).not.toHaveBeenCalled()
    expect(mockDeskUpdateMany.mock.calls[0][0].where).toMatchObject({ id: "desk-a", profileId: PROFILE })
    expect(mockEventCreate).toHaveBeenCalledWith({
      data: { writingDeskId: "desk-a", apiTokenId: TOKEN, tool: "create_draft" },
    })
  })

  it("edits only the chosen document, even when the job has several", async () => {
    mockDeskFindFirst.mockResolvedValue(cvB())
    mockDeskUpdateMany.mockResolvedValue({ count: 1 } as never)

    const result = await editDraftSection(PROFILE, { jobId: "job-1", documentId: "desk-b" }, replaceProfile, { tokenId: TOKEN })

    expect(result).toMatchObject({ ok: true, value: { deskId: "desk-b" } })
    expect(mockDeskUpdateMany.mock.calls[0][0].where).toMatchObject({ id: "desk-b", profileId: PROFILE })
  })

  it("re-reads the same document by id on a lost race, never re-resolving to another", async () => {
    mockDeskFindMany.mockResolvedValue([cvB()])
    mockDeskFindFirst.mockResolvedValue(cvB())
    mockDeskUpdateMany.mockResolvedValueOnce({ count: 0 } as never).mockResolvedValueOnce({ count: 1 } as never)

    const result = await editDraftSection(PROFILE, { jobId: "job-1" }, replaceProfile, { tokenId: TOKEN })

    expect(result).toMatchObject({ ok: true, value: { deskId: "desk-b" } })
    expect(mockDeskFindMany).toHaveBeenCalledTimes(1)
    expect(mockDeskFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "desk-b", profileId: PROFILE } }))
  })

  it("returns document_not_found for another job's or another profile's document id", async () => {
    mockDeskFindFirst.mockResolvedValue(null)

    for (const result of [
      await createDraft(PROFILE, { jobId: "job-1", documentId: "foreign" }, DRAFT, { tokenId: TOKEN }),
      await getDraft(PROFILE, { jobId: "job-1", documentId: "foreign" }),
      await editDraftSection(PROFILE, { jobId: "job-1", documentId: "foreign" }, replaceProfile),
    ]) {
      expect(result).toMatchObject({ ok: false, reason: "document_not_found" })
    }
    expect(mockDeskFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "foreign", profileId: PROFILE, jobApplicationId: "job-1" },
    }))
    expect(mockDeskCreate).not.toHaveBeenCalled()
    expect(mockDeskUpdateMany).not.toHaveBeenCalled()
  })

  it("creates the job's first document, named CV, under the job's lock when it has none", async () => {
    mockDeskFindMany.mockResolvedValue([])
    mockDeskCreate.mockResolvedValue(deskRow({ id: "desk-new", documentType: null, draftContent: null, draftRevision: 0, revision: 1 }))
    mockDeskUpdateMany.mockResolvedValue({ count: 1 } as never)

    const result = await createDraft(PROFILE, { jobId: "job-1" }, DRAFT, { tokenId: TOKEN })

    expect(result).toMatchObject({ ok: true, value: { deskId: "desk-new" } })
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1)
    expect(mockExecuteRaw.mock.invocationCallOrder[0]).toBeLessThan(mockDeskFindMany.mock.invocationCallOrder[0])
    expect(mockDeskCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: { profileId: PROFILE, jobApplicationId: "job-1", name: "CV" },
    }))
  })

  it("never creates a document for a read", async () => {
    mockDeskFindMany.mockResolvedValue([])

    await expect(getDraft(PROFILE, { jobId: "job-1" })).resolves.toMatchObject({ ok: false, reason: "no_draft" })
    expect(mockDeskCreate).not.toHaveBeenCalled()
    expect(mockExecuteRaw).not.toHaveBeenCalled()
  })
})
