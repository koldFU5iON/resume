import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/session", () => ({ requireProfile: vi.fn().mockResolvedValue({ profile: { id: "profile-1" } }) }))
vi.mock("@/modules/writing-desk/documents", () => ({ ensurePrimaryWritingDesk: vi.fn() }))
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { url }) }),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
}))

import { notFound, redirect } from "next/navigation"
import { ensurePrimaryWritingDesk } from "@/modules/writing-desk/documents"
import WritingDeskPage from "./page"

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => vi.clearAllMocks())

describe("job-scoped /writing URL (compatibility, #370)", () => {
  it("redirects to the job's primary document by id", async () => {
    vi.mocked(ensurePrimaryWritingDesk).mockResolvedValue({ id: "desk-original" })

    await expect(WritingDeskPage(params("job-1"))).rejects.toThrow("NEXT_REDIRECT")

    expect(ensurePrimaryWritingDesk).toHaveBeenCalledWith("profile-1", "job-1")
    expect(redirect).toHaveBeenCalledWith("/dashboard/job-applications/view/job-1/writing/desk-original")
  })

  it("is not found for another profile's job", async () => {
    vi.mocked(ensurePrimaryWritingDesk).mockResolvedValue(null)

    await expect(WritingDeskPage(params("job-other"))).rejects.toThrow("NEXT_NOT_FOUND")
    expect(notFound).toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })
})
