import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/session", () => ({ requireProfile: vi.fn().mockResolvedValue({ profile: { id: "profile-1" } }) }))
vi.mock("@/modules/writing-desk/documents", () => ({ getPrimaryWritingDeskId: vi.fn() }))
vi.mock("@/modules/writing-desk/queries", () => ({ getWritingDeskDocument: vi.fn() }))
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])) }))
vi.mock("@/app/components/writing-desk-pdf-document", () => ({ WritingDeskPDFDocument: () => null }))

import type { NextRequest } from "next/server"
import { getPrimaryWritingDeskId } from "@/modules/writing-desk/documents"
import { getWritingDeskDocument } from "@/modules/writing-desk/queries"
import { GET as legacyGET } from "./[jobId]/pdf/route"
import { GET as documentGET } from "./[jobId]/documents/[documentId]/pdf/route"

const request = {} as NextRequest
const desk = (name: string) => ({
  id: "desk-b",
  name,
  content: "# CV",
  documentType: "cv",
  jobApplication: { id: "job-1", title: "Lead PM", company: "Acme", jobDescription: null },
})

beforeEach(() => vi.clearAllMocks())

describe("PDF export by document id", () => {
  it("exports the addressed document, scoped to the profile and job, named after it", async () => {
    vi.mocked(getWritingDeskDocument).mockResolvedValue(desk("CV short") as never)

    const res = await documentGET(request, { params: Promise.resolve({ jobId: "job-1", documentId: "desk-b" }) })

    expect(getWritingDeskDocument).toHaveBeenCalledWith("profile-1", "job-1", "desk-b")
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="CV-short-Lead-PM.pdf"')
  })

  it("is 404 for another profile's document or another job's", async () => {
    vi.mocked(getWritingDeskDocument).mockResolvedValue(null)

    const res = await documentGET(request, { params: Promise.resolve({ jobId: "job-1", documentId: "foreign" }) })
    expect(res.status).toBe(404)
  })
})

describe("job-scoped PDF URL (compatibility, #370)", () => {
  it("exports the job's primary (oldest) document", async () => {
    vi.mocked(getPrimaryWritingDeskId).mockResolvedValue("desk-original")
    vi.mocked(getWritingDeskDocument).mockResolvedValue(desk("CV") as never)

    const res = await legacyGET(request, { params: Promise.resolve({ jobId: "job-1" }) })

    expect(getPrimaryWritingDeskId).toHaveBeenCalledWith("profile-1", "job-1")
    expect(getWritingDeskDocument).toHaveBeenCalledWith("profile-1", "job-1", "desk-original")
    expect(res.status).toBe(200)
  })

  it("is 404 when the job has no document (or isn't the profile's), and creates nothing", async () => {
    vi.mocked(getPrimaryWritingDeskId).mockResolvedValue(null)

    const res = await legacyGET(request, { params: Promise.resolve({ jobId: "job-other" }) })
    expect(res.status).toBe(404)
    expect(getWritingDeskDocument).not.toHaveBeenCalled()
  })
})
