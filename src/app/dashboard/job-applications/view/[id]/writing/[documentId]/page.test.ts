import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/session", () => ({ requireProfile: vi.fn().mockResolvedValue({ profile: { id: "profile-1" } }) }))
vi.mock("@/modules/writing-desk/queries", () => ({
  getWritingDeskDocument: vi.fn(),
  listWritingDeskSourceCVs: vi.fn().mockResolvedValue([]),
}))
vi.mock("../_components/writing-desk", () => ({ WritingDesk: () => null }))
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND") }) }))

import { getWritingDeskDocument } from "@/modules/writing-desk/queries"
import WritingDeskDocumentPage from "./page"

const params = (id: string, documentId: string) => ({ params: Promise.resolve({ id, documentId }) })

beforeEach(() => vi.clearAllMocks())

describe("Writing Desk document page", () => {
  it("loads exactly the addressed document, scoped to the profile and the job in the URL", async () => {
    vi.mocked(getWritingDeskDocument).mockResolvedValue({ id: "desk-b" } as never)

    const element = await WritingDeskDocumentPage(params("job-1", "desk-b"))

    expect(getWritingDeskDocument).toHaveBeenCalledWith("profile-1", "job-1", "desk-b")
    expect(element.props.desk).toEqual({ id: "desk-b" })
  })

  it("is not found for another profile's document or another job's", async () => {
    vi.mocked(getWritingDeskDocument).mockResolvedValue(null)

    await expect(WritingDeskDocumentPage(params("job-1", "desk-foreign"))).rejects.toThrow("NEXT_NOT_FOUND")
  })
})
