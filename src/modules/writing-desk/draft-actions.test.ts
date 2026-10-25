import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/session", () => ({
  requireProfile: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("./draft", () => ({
  saveDraftContent: vi.fn(),
  acceptDraft: vi.fn(),
  discardDraft: vi.fn(),
}))

import { revalidatePath } from "next/cache"
import { requireProfile } from "@/lib/session"
import { acceptDraft, discardDraft, saveDraftContent } from "./draft"
import { acceptDraftAction, discardDraftAction, saveDraftContentAction } from "./draft-actions"

const mockRequireProfile = vi.mocked(requireProfile)
const mockRevalidatePath = vi.mocked(revalidatePath)
const mockSaveDraftContent = vi.mocked(saveDraftContent)
const mockAcceptDraft = vi.mocked(acceptDraft)
const mockDiscardDraft = vi.mocked(discardDraft)

const WRITING_PAGE = "/dashboard/job-applications/view/[id]/writing"

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireProfile.mockResolvedValue({ profile: { id: "profile-1" } } as never)
})

describe("saveDraftContentAction", () => {
  it("saves as the signed-in profile with the expected draft revision and revalidates the writing page", async () => {
    mockSaveDraftContent.mockResolvedValue({ ok: true, value: { draftRevision: 5 } })

    await expect(saveDraftContentAction("desk-1", "# Edited draft", 4)).resolves.toEqual({
      ok: true,
      value: { draftRevision: 5 },
    })

    expect(mockRequireProfile).toHaveBeenCalledTimes(1)
    expect(mockSaveDraftContent).toHaveBeenCalledWith("profile-1", "desk-1", "# Edited draft", 4)
    expect(mockRevalidatePath).toHaveBeenCalledWith(WRITING_PAGE, "page")
  })

  it("passes a conflict through unchanged, current draft included, without revalidating", async () => {
    const conflict = {
      ok: false as const,
      reason: "conflict" as const,
      message: "The draft changed while this write was in progress. Re-read it and retry.",
      draft: { content: "# Agent edit", draftRevision: 7 },
    }
    mockSaveDraftContent.mockResolvedValue(conflict)

    await expect(saveDraftContentAction("desk-1", "# Stale", 4)).resolves.toBe(conflict)
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it("passes the size-limit failure through unchanged without revalidating", async () => {
    const tooLong = {
      ok: false as const,
      reason: "invalid" as const,
      message: "Draft is 500001 characters, over the 500000 limit.",
    }
    mockSaveDraftContent.mockResolvedValue(tooLong)

    await expect(saveDraftContentAction("desk-1", "x".repeat(10), 4)).resolves.toBe(tooLong)
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it("does not call the service when there is no session", async () => {
    mockRequireProfile.mockRejectedValue(new Error("Unauthorized"))

    await expect(saveDraftContentAction("desk-1", "# Draft", 1)).rejects.toThrow("Unauthorized")
    expect(mockSaveDraftContent).not.toHaveBeenCalled()
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it("ignores any extra argument that looks like a profile id", async () => {
    mockSaveDraftContent.mockResolvedValue({ ok: true, value: { draftRevision: 2 } })
    const call = saveDraftContentAction as unknown as (...args: unknown[]) => Promise<unknown>

    await call("desk-1", "# Draft", 1, "profile-attacker")

    expect(mockSaveDraftContent).toHaveBeenCalledWith("profile-1", "desk-1", "# Draft", 1)
  })
})

describe("acceptDraftAction", () => {
  it("accepts as the signed-in profile with both expected revisions and revalidates on success", async () => {
    mockAcceptDraft.mockResolvedValue({ ok: true, value: { revision: 3 } })

    await expect(acceptDraftAction("desk-1", 2, 9)).resolves.toEqual({ ok: true, value: { revision: 3 } })

    expect(mockRequireProfile).toHaveBeenCalledTimes(1)
    expect(mockAcceptDraft).toHaveBeenCalledWith("profile-1", "desk-1", 2, 9)
    expect(mockRevalidatePath).toHaveBeenCalledWith(WRITING_PAGE, "page")
  })

  it.each([
    { reason: "live_changed" as const, message: "The live document changed since this draft was reviewed. Review the new difference first." },
    { reason: "no_draft" as const, message: "This job has no draft. Create one with create_draft." },
  ])("passes $reason through unchanged without revalidating", async failure => {
    const result = { ok: false as const, ...failure }
    mockAcceptDraft.mockResolvedValue(result)

    await expect(acceptDraftAction("desk-1", 2, 9)).resolves.toBe(result)
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it("passes a draft conflict through with the current draft", async () => {
    const result = {
      ok: false as const,
      reason: "conflict" as const,
      message: "The draft changed while this write was in progress. Re-read it and retry.",
      draft: { content: "# Newer", draftRevision: 10 },
    }
    mockAcceptDraft.mockResolvedValue(result)

    await expect(acceptDraftAction("desk-1", 2, 9)).resolves.toBe(result)
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it("does not call the service when there is no session", async () => {
    mockRequireProfile.mockRejectedValue(new Error("Unauthorized"))

    await expect(acceptDraftAction("desk-1", 2, 9)).rejects.toThrow("Unauthorized")
    expect(mockAcceptDraft).not.toHaveBeenCalled()
  })

  it("ignores any extra argument that looks like a profile id", async () => {
    mockAcceptDraft.mockResolvedValue({ ok: true, value: { revision: 3 } })
    const call = acceptDraftAction as unknown as (...args: unknown[]) => Promise<unknown>

    await call("desk-1", 2, 9, "profile-attacker")

    expect(mockAcceptDraft).toHaveBeenCalledWith("profile-1", "desk-1", 2, 9)
  })
})

describe("discardDraftAction", () => {
  it("discards as the signed-in profile and revalidates on success", async () => {
    mockDiscardDraft.mockResolvedValue({ ok: true, value: {} })

    await expect(discardDraftAction("desk-1")).resolves.toEqual({ ok: true, value: {} })

    expect(mockRequireProfile).toHaveBeenCalledTimes(1)
    expect(mockDiscardDraft).toHaveBeenCalledWith("profile-1", "desk-1")
    expect(mockRevalidatePath).toHaveBeenCalledWith(WRITING_PAGE, "page")
  })

  it("passes no_draft through unchanged without revalidating", async () => {
    const result = { ok: false as const, reason: "no_draft" as const, message: "This job has no draft. Create one with create_draft." }
    mockDiscardDraft.mockResolvedValue(result)

    await expect(discardDraftAction("desk-1")).resolves.toBe(result)
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it("does not call the service when there is no session", async () => {
    mockRequireProfile.mockRejectedValue(new Error("Unauthorized"))

    await expect(discardDraftAction("desk-1")).rejects.toThrow("Unauthorized")
    expect(mockDiscardDraft).not.toHaveBeenCalled()
  })

  it("ignores any extra argument that looks like a profile id", async () => {
    mockDiscardDraft.mockResolvedValue({ ok: true, value: {} })
    const call = discardDraftAction as unknown as (...args: unknown[]) => Promise<unknown>

    await call("desk-1", "profile-attacker")

    expect(mockDiscardDraft).toHaveBeenCalledWith("profile-1", "desk-1")
  })
})
