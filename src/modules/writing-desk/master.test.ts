import { beforeEach, describe, expect, it, vi } from "vitest"
import { Prisma } from "@prisma/client"

const tx = {
  writingDeskDocument: { updateMany: vi.fn() },
  writingDeskDraftEvent: { create: vi.fn() },
}
vi.mock("@/lib/db", () => ({
  prisma: {
    writingDeskDocument: { findUnique: vi.fn(), create: vi.fn() },
    cVDocument: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}))

import { prisma } from "@/lib/db"
import { ensureMasterCvDesk, getMasterCvMarkdown, landMasterCvDraft } from "./master"

const mockFindUnique = vi.mocked(prisma.writingDeskDocument.findUnique)
const mockCreate = vi.mocked(prisma.writingDeskDocument.create)
const mockLegacy = vi.mocked(prisma.cVDocument.findFirst)

const LEGACY = {
  id: "old-master",
  generatedContent: JSON.stringify({
    version: 1,
    sections: [{ id: "h", type: "header", visible: true, data: { name: "Jane Doe", headline: "Ops", contact: { email: "jane@example.test" } } }],
  }),
}

const VALID = ":::header\n# Jane Doe\n{{contact}}\n:::\n\n## Professional Profile\n\nText."

beforeEach(() => {
  vi.clearAllMocks()
  mockFindUnique.mockResolvedValue(null)
  mockLegacy.mockResolvedValue(null)
})

describe("ensureMasterCvDesk", () => {
  it("returns the existing master without creating one", async () => {
    mockFindUnique.mockResolvedValue({ id: "desk-1", profileId: "profile-1" } as never)
    await expect(ensureMasterCvDesk("profile-1")).resolves.toBe("desk-1")
    expect(mockFindUnique.mock.calls[0][0]).toMatchObject({ where: { masterOfProfileId: "profile-1" } })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("copies the old CV Builder master in, as desk Markdown with no contact details", async () => {
    mockLegacy.mockResolvedValue(LEGACY as never)
    mockCreate.mockResolvedValue({ id: "desk-new" } as never)

    await expect(ensureMasterCvDesk("profile-1")).resolves.toBe("desk-new")

    expect(mockLegacy.mock.calls[0][0]).toMatchObject({
      where: { profileId: "profile-1", jobApplicationId: null, careerVerticalId: { not: null } },
    })
    const data = mockCreate.mock.calls[0][0].data
    expect(data).toMatchObject({
      profileId: "profile-1",
      jobApplicationId: null,
      masterOfProfileId: "profile-1",
      name: "Master CV",
      documentType: "cv",
      sourceType: "master-cv",
      sourceCvDocumentId: "old-master",
    })
    expect(data.content).toContain(":::header\n# Jane Doe\n## Ops\n{{contact}}\n:::")
    expect(data.content).not.toContain("jane@example.test")
  })

  it("creates a blank master when there is no old one", async () => {
    mockCreate.mockResolvedValue({ id: "desk-new" } as never)
    await ensureMasterCvDesk("profile-1")
    expect(mockCreate.mock.calls[0][0].data).toMatchObject({ content: "", sourceType: "blank", sourceCvDocumentId: null })
  })

  it("re-reads the winner when a concurrent first visit created it", async () => {
    mockFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "desk-raced", profileId: "profile-1" } as never)
    mockCreate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" }))
    await expect(ensureMasterCvDesk("profile-1")).resolves.toBe("desk-raced")
  })
})

describe("getMasterCvMarkdown", () => {
  it("reads the desk master's live content and never the old one when it exists", async () => {
    mockFindUnique.mockResolvedValue({ profileId: "profile-1", content: "# Desk master" } as never)
    await expect(getMasterCvMarkdown("profile-1")).resolves.toBe("# Desk master")
    expect(mockLegacy).not.toHaveBeenCalled()
  })

  it("is null for an empty desk master (a waiting draft is not the master yet)", async () => {
    mockFindUnique.mockResolvedValue({ profileId: "profile-1", content: "  " } as never)
    await expect(getMasterCvMarkdown("profile-1")).resolves.toBeNull()
  })

  it("falls back to the old master, converted, and null with neither", async () => {
    mockLegacy.mockResolvedValue(LEGACY as never)
    await expect(getMasterCvMarkdown("profile-1")).resolves.toContain("# Jane Doe")
    mockLegacy.mockResolvedValue(null)
    await expect(getMasterCvMarkdown("profile-1")).resolves.toBeNull()
  })
})

describe("landMasterCvDraft", () => {
  beforeEach(() => {
    mockFindUnique.mockResolvedValue({ id: "desk-1", profileId: "profile-1" } as never)
  })

  it("writes a draft, never the live content, and starts the draft's history", async () => {
    tx.writingDeskDocument.updateMany.mockResolvedValue({ count: 1 })

    await expect(landMasterCvDraft("profile-1", VALID)).resolves.toEqual({ ok: true, deskId: "desk-1" })

    const { where, data } = tx.writingDeskDocument.updateMany.mock.calls[0][0]
    expect(where).toEqual({ id: "desk-1", profileId: "profile-1", draftContent: null })
    expect(data).toMatchObject({ draftContent: VALID, draftRevision: { increment: 1 } })
    expect(data).not.toHaveProperty("content")
    expect(tx.writingDeskDraftEvent.create).toHaveBeenCalledWith({ data: { writingDeskId: "desk-1", apiTokenId: null, tool: "create_draft" } })
  })

  it("never replaces a draft that is already waiting", async () => {
    tx.writingDeskDocument.updateMany.mockResolvedValue({ count: 0 })
    await expect(landMasterCvDraft("profile-1", VALID)).resolves.toMatchObject({ ok: false, reason: "draft_exists", deskId: "desk-1" })
    expect(tx.writingDeskDraftEvent.create).not.toHaveBeenCalled()
  })

  it("refuses Markdown the desk can't hold, before touching the database", async () => {
    await expect(landMasterCvDraft("profile-1", ":::header\n# Jane")).resolves.toMatchObject({ ok: false, reason: "invalid" })
    expect(mockFindUnique).not.toHaveBeenCalled()
  })
})
